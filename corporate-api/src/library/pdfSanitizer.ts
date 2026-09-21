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
// qpdf no descomprime los flujos (--json-stream-data=none) ni escribe archivos
// grandes: una zip bomb no le cuesta memoria ni disco. Sin qpdf disponible la
// subida se rechaza (falla cerrada): nunca se guarda un PDF sin verificar.

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
  "/Movie",
  "/Sound",
  "/RichMedia",
  "/3D",
  "/FileAttachment",
  "/EmbeddedFile",
  "/XFA",
]);

const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 200;
const QPDF_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_QPDF = 2;

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
  return new Promise((resolve, reject) => {
    execFile(
      qpdfBinary(),
      args,
      {
        timeout: QPDF_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: MAX_JSON_BYTES,
        encoding: "utf8",
        windowsHide: true,
        // Entorno minimo: qpdf no necesita nada mas que el PATH.
        env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" },
      },
      (err, stdout) => {
        if (!err) {
          resolve({ code: 0, stdout });
          return;
        }
        const failure = err as NodeJS.ErrnoException & { code?: string | number; killed?: boolean };
        if (failure.code === "ENOENT") {
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

// Cola simple: cada qpdf es un proceso aparte y el contenedor tiene 512 MB.
let running = 0;
const waiting: (() => void)[] = [];

async function withQpdfSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT_QPDF) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  running += 1;
  try {
    return await task();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

export async function sanitizePdf(input: Buffer): Promise<Buffer> {
  return withQpdfSlot(async () => {
    const dir = await mkdtemp(join(tmpdir(), `pdf-${randomUUID()}-`));
    try {
      const source = join(dir, "in.pdf");
      const output = join(dir, "out.pdf");
      await writeFile(source, input, { mode: 0o600 });

      // 1) Arbol de objetos (sin datos de flujo) para inspeccionar.
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
      const reason = findActiveContent(tree);
      if (reason) throw new BadRequestError(`${reason}: no se acepta`);

      // 2) Reescritura: es lo que se guarda.
      const rewrite = await runQpdf(["--decrypt", "--object-streams=disable", source, output]);
      if (rewrite.code !== 0 && rewrite.code !== 3) {
        throw new BadRequestError("El PDF está dañado o no se puede procesar");
      }
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
