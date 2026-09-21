import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, BadRequestError } from "./errors";

// Saneado REAL de un PDF antes de aceptarlo como guia de despacho, con qpdf
// (https://qpdf.sourceforge.io). Reemplaza a la inspeccion heuristica por regex:
//
//  1. `qpdf --json` entrega el arbol de objetos tal como lo interpreta un lector
//     de PDF (incluye los de object streams, ya descifrados y sin la
//     desalineacion que un /Length falso provoca en una busqueda de texto). Se
//     recorre y se rechaza cualquier contenido activo.
//  2. Lo que se GUARDA es la reescritura de qpdf del mismo archivo, no lo subido:
//     estructura y xref reconstruidos, sin basura antes/despues (polyglots) ni
//     cifrado. Como es el mismo analisis, lo revisado es lo entregado.
//
// OJO con las zip bombs: --json-stream-data=none evita volcar los datos de los flujos normales, pero para
// listar y reescribir los objetos que viven en un object stream qpdf tiene que descomprimirlo ENTERO en memoria
// (medido: 82 KB de PDF -> 137 MB de RSS; 5 MB -> varios GB) y qpdf 12 no trae un limite de tamano descomprimido.
// Por eso cada qpdf corre con limites del sistema operativo (ulimit: memoria virtual y tamano de archivo
// escrito): una bomba hace fallar a qpdf (bad_alloc / SIGXFSZ) y la subida se rechaza, sin tocar al resto del
// contenedor. Los limites solo aplican donde hay /bin/sh (Linux: contenedores); en Windows (desarrollo) no.
// Sin qpdf disponible la subida se rechaza (falla cerrada): nunca se guarda un PDF sin verificar.

// Claves de diccionario que habilitan contenido activo: JavaScript, archivos
// incrustados, multimedia, formularios XFA y saltos a otros archivos.
// /OpenAction NO se bloquea (los PDF normales lo usan para el zoom inicial): si
// apunta a una accion peligrosa, esa accion cae en las reglas de abajo.
const ACTIVE_KEYS = new Set([
  "/JS",
  "/JavaScript",
  "/EF",
  "/EmbeddedFiles",
  "/RichMedia",
  "/XFA",
  "/Launch",
  "/GoToR",
  "/GoToE",
]);

// Nombres que, como VALOR (p. ej. /S /JavaScript o /Subtype /FileAttachment),
// identifican una accion o anotacion activa.
const ACTIVE_VALUES = new Set([
  "/JavaScript",
  "/Launch",
  "/GoToR",
  "/GoToE",
  "/SubmitForm",
  "/ImportData",
  "/Rendition",
  "/URI",
  "/Named",
  "/ResetForm",
  "/GoToDp",
  "/SetOCGState",
  "/Movie",
  "/Sound",
  "/RichMedia",
  "/3D",
  "/FileAttachment",
  "/EmbeddedFile",
  "/XFA",
]);

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_DEPTH = 200;
const QPDF_TIMEOUT_MS = 15_000;
// Un solo qpdf a la vez por replica (contenedor de 512 MB) y espera acotada: mas alla, 429.
const MAX_CONCURRENT_QPDF = 1;
const QUEUE_WAIT_MS = 10_000;
// Limites por proceso qpdf: memoria virtual (KB) y tamano de archivo escrito (bloques de 512 B = 32 MB).
const QPDF_ADDRESS_SPACE_KB = 196_608;
const QPDF_MAX_FILE_BLOCKS = 65_536;

const ACTIVE_REASON = "El PDF contiene contenido activo (JavaScript, archivos incrustados u otros)";

// Recorre el JSON de `qpdf --json` (sin depender de su esquema exacto: cualquier clave o
// nombre PDF en cualquier lugar del arbol). En el JSON v2 los nombres PDF son cadenas
// que empiezan con "/" y las cadenas PDF llevan el prefijo "u:" o "b:", asi que un
// texto cualquiera no se confunde con un nombre. Devuelve el motivo o null.
export function findActiveContent(node: unknown, depth = 0): string | null {
  if (depth > MAX_DEPTH) return "El PDF tiene una estructura demasiado profunda para verificarlo";
  if (typeof node === "string") return ACTIVE_VALUES.has(node) ? ACTIVE_REASON : null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const reason = findActiveContent(item, depth + 1);
      if (reason) return reason;
    }
    return null;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (ACTIVE_KEYS.has(key)) return ACTIVE_REASON;
      const reason = findActiveContent(value, depth + 1);
      if (reason) return reason;
    }
  }
  return null;
}

function qpdfBinary(): string {
  return process.env.QPDF_BIN?.trim() || "qpdf";
}

class QpdfUnavailableError extends Error {
  constructor() {
    super("qpdf no esta disponible");
  }
}

interface QpdfResult {
  code: number;
  stdout: string;
}

function runQpdf(args: string[]): Promise<QpdfResult> {
  // En Linux qpdf se lanza via /bin/sh con ulimit (ver el comentario de arriba); "exec" lo reemplaza, asi que
  // el proceso que recibe el timeout/SIGKILL es el propio qpdf.
  const limited = process.platform !== "win32";
  const file = limited ? "/bin/sh" : qpdfBinary();
  const argv = limited
    ? ["-c", `ulimit -v ${QPDF_ADDRESS_SPACE_KB}; ulimit -f ${QPDF_MAX_FILE_BLOCKS}; exec "$0" "$@"`, qpdfBinary(), ...args]
    : args;
  return new Promise((resolve, reject) => {
    execFile(
      file,
      argv,
      {
        timeout: QPDF_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: MAX_JSON_BYTES,
        encoding: "utf8",
        windowsHide: true,
        // Entorno minimo: qpdf no necesita nada mas que el PATH.
        env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" },
      },
      (err, stdout, stderr) => {
        // Con el limite de memoria qpdf NO falla: atrapa el bad_alloc al descomprimir un flujo, avisa (WARNING, codigo
        // 3) y sigue sin ese contenido. Lo que se guarda ya no traeria la carga, pero un PDF que no se pudo leer entero
        // no se acepta: se rechaza explicitamente en vez de guardar uno incompleto.
        if (/bad_alloc|error decoding stream data/i.test(stderr)) {
          reject(new BadRequestError("El PDF es demasiado complejo o pesado para verificarlo"));
          return;
        }
        if (!err) {
          resolve({ code: 0, stdout });
          return;
        }
        const failure = err as Error & { code?: string | number; killed?: boolean };
        // 127 = el shell no encontro el binario de qpdf.
        if (failure.code === "ENOENT" || failure.code === 127) {
          reject(new QpdfUnavailableError());
          return;
        }
        if (failure.killed || failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
          reject(new BadRequestError("El PDF es demasiado complejo para verificarlo"));
          return;
        }
        // Codigo 3 = qpdf pudo procesar el archivo pero con advertencias (p. ej.
        // reconstruyo una tabla xref danada): la salida es valida.
        resolve({ code: typeof failure.code === "number" ? failure.code : 2, stdout });
      },
    );
  });
}

// Cola: cada qpdf es un proceso aparte y el contenedor tiene 512 MB. Al liberar, el cupo pasa DIRECTO al
// siguiente en espera (running no cambia), asi nunca hay mas de MAX_CONCURRENT_QPDF. Una espera larga se
// rechaza con 429 en vez de dejar subidas colgadas.
let running = 0;
const waiting: { grant: () => void }[] = [];

async function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT_QPDF) {
    running += 1;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const entry = {
      grant: () => {
        clearTimeout(timer);
        resolve();
      },
    };
    const timer = setTimeout(() => {
      const index = waiting.indexOf(entry);
      if (index >= 0) waiting.splice(index, 1);
      reject(new AppError(429, "Hay demasiadas verificaciones de PDF en curso, intente nuevamente en unos segundos"));
    }, QUEUE_WAIT_MS);
    waiting.push(entry);
  });
}

function releaseSlot(): void {
  const next = waiting.shift();
  if (next) next.grant();
  else running -= 1;
}

async function withQpdfSlot<T>(task: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await task();
  } finally {
    releaseSlot();
  }
}

// Arbol de objetos del archivo (qpdf --json) -> motivo de rechazo o null.
async function inspectFile(source: string): Promise<string | null> {
  const json = await runQpdf(["--json=2", "--json-stream-data=none", "--decrypt", source]);
  if (json.code !== 0 && json.code !== 3) {
    throw new BadRequestError("El PDF está dañado, protegido con contraseña o no se puede verificar");
  }
  let tree: unknown;
  try {
    tree = JSON.parse(json.stdout);
  } catch {
    throw new BadRequestError("El PDF no se puede verificar");
  }
  return findActiveContent(tree);
}

export async function sanitizePdf(input: Buffer): Promise<Buffer> {
  return withQpdfSlot(async () => {
    const dir = await mkdtemp(join(tmpdir(), `pdf-${randomUUID()}-`));
    try {
      const source = join(dir, "in.pdf");
      const output = join(dir, "out.pdf");
      await writeFile(source, input, { mode: 0o600 });

      // 1) Arbol de objetos (sin datos de flujo) para inspeccionar.
      const reason = await inspectFile(source);
      if (reason) throw new BadRequestError(`${reason}: no se acepta`);

      // 2) Reescritura: es lo que se guarda.
      const rewrite = await runQpdf(["--decrypt", "--object-streams=disable", source, output]);
      if (rewrite.code !== 0 && rewrite.code !== 3) {
        throw new BadRequestError("El PDF está dañado o no se puede procesar");
      }
      // 3) Defensa en profundidad: lo que se va a guardar se inspecciona igual que lo subido.
      const reasonAfter = await inspectFile(output);
      if (reasonAfter) throw new BadRequestError(`${reasonAfter}: no se acepta`);
      const clean = await readFile(output);
      if (clean.subarray(0, 5).toString("latin1") !== "%PDF-") {
        throw new BadRequestError("El PDF no se puede procesar");
      }
      return clean;
    } catch (err) {
      if (err instanceof QpdfUnavailableError) {
        // Falla cerrada: sin qpdf no se acepta ningun PDF. Import diferido: el logger exige variables de entorno.
        void import("./logger.js").then(({ logger }) => logger.error({ err }, "qpdf no esta disponible: no se puede sanear el PDF"));
        throw new AppError(503, "El servicio de verificación de PDF no está disponible");
      }
      throw err;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}
