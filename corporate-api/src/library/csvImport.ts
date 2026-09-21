import { BadRequestError } from "./errors";

// Carga masiva de activos por CSV (plan 005). Este modulo es PURO (sin BD ni Redis): parsea el archivo
// y valida cada fila de forma sintactica; la resolucion contra Mongo/MSSQL/Postgres (producto, centro de
// costo, usuario, series existentes) vive en services/postgres/assetImport.service.ts.

export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;
// Tope por celda: ningun dato valido de la carga se acerca; acota el costo de una celda gigante.
const MAX_CELL_LENGTH = 300;
const MAX_COLUMNS_PER_RECORD = 32;

export const IMPORT_COLUMNS = [
  "serial_number",
  "product",
  "category",
  "cost_center_code",
  "status",
  "assigned_username",
  "assigned_rut",
  "warranty_expires_at",
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

const REQUIRED_COLUMNS: readonly ImportColumn[] = ["serial_number", "product", "cost_center_code"];

// DECOMMISSIONED queda fuera a proposito: dar de baja escribe un WRITE_OFF en el Kardex y estos activos nacen sin valor.
export const IMPORT_STATUS_CODES = ["AVAILABLE", "ASSIGNED", "SUPPORT", "DAMAGED"] as const;
export type ImportStatusCode = (typeof IMPORT_STATUS_CODES)[number];

export interface ParsedImportRow {
  // Numero de fila como lo ve quien abre el CSV en una planilla (la cabecera es la 1).
  row: number;
  serialNumber: string;
  product: string;
  category: string | null;
  costCenterCode: number;
  statusCode: ImportStatusCode;
  assignedUsername: string | null;
  assignedRut: string | null;
  warrantyExpiresAt: string | null;
}

export interface ImportIssue {
  row: number;
  column: string;
  message: string;
}

// Un archivo que no se puede ni leer (comillas sin cerrar, cabecera invalida, demasiadas filas) se rechaza
// completo: no tiene sentido validar fila por fila algo cuya estructura es incierta.
export class CsvFormatError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "CsvFormatError";
  }
}

// Coma o punto y coma (Excel en espanol exporta con ";"): gana el que mas aparece FUERA de comillas en la primera linea.
function detectDelimiter(text: string): "," | ";" {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (char === "\n" || char === "\r") break;
      if (char === ",") commas++;
      else if (char === ";") semicolons++;
    }
  }
  return semicolons > commas ? ";" : ",";
}

// Parser RFC 4180: comillas dobles, "" como comilla literal, saltos de linea dentro de comillas, CRLF/LF/CR.
// Ignora las lineas totalmente vacias. Devuelve registros (arreglos de celdas).
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let inQuotes = false;
  let cellStarted = false;

  const endCell = (): void => {
    // Un registro con miles de celdas (2 MB de comas) gasta memoria sin aportar nada: las columnas validas son 8.
    if (record.length >= MAX_COLUMNS_PER_RECORD) throw new CsvFormatError(`Un registro tiene más de ${MAX_COLUMNS_PER_RECORD} columnas (registro ${records.length + 1})`);
    if (cell.length > MAX_CELL_LENGTH) throw new CsvFormatError(`Una celda supera ${MAX_CELL_LENGTH} caracteres (registro ${records.length + 1})`);
    record.push(cell);
    cell = "";
    cellStarted = false;
  };
  const endRecord = (): void => {
    endCell();
    if (!(record.length === 1 && record[0]!.trim() === "")) {
      records.push(record);
      if (records.length > IMPORT_MAX_ROWS + 1) {
        throw new CsvFormatError(`El archivo supera el maximo de ${IMPORT_MAX_ROWS} filas`);
      }
    }
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
        if (cell.length > MAX_CELL_LENGTH + 1) throw new CsvFormatError(`Una celda supera ${MAX_CELL_LENGTH} caracteres (registro ${records.length + 1})`);
      }
      continue;
    }
    if (char === '"' && !cellStarted) {
      inQuotes = true;
      cellStarted = true;
    } else if (char === delimiter) {
      endCell();
    } else if (char === "\n") {
      endRecord();
    } else if (char === "\r") {
      if (text[i + 1] === "\n") i++;
      endRecord();
    } else {
      if (char === '"') throw new CsvFormatError(`Comilla inesperada dentro de una celda (registro ${records.length + 1}); enciérrela entre comillas`);
      cell += char;
      cellStarted = true;
    }
  }
  if (inQuotes) throw new CsvFormatError("El archivo tiene una celda con comillas sin cerrar");
  if (cellStarted || cell.length > 0 || record.length > 0) endRecord();
  return records;
}

// Cabecera obligatoria: columnas conocidas, sin repetir y con las obligatorias presentes.
function readHeader(headerRecord: string[]): ImportColumn[] {
  const known = new Set<string>(IMPORT_COLUMNS);
  const seen = new Set<string>();
  const header = headerRecord.map((name) => name.trim().toLowerCase());
  for (const name of header) {
    if (!known.has(name)) {
      throw new CsvFormatError(`Columna desconocida en la cabecera: '${name.slice(0, 40)}'. Columnas validas: ${IMPORT_COLUMNS.join(", ")}`);
    }
    if (seen.has(name)) throw new CsvFormatError(`La columna '${name}' está repetida en la cabecera`);
    seen.add(name);
  }
  const missing = REQUIRED_COLUMNS.filter((column) => !seen.has(column));
  if (missing.length > 0) throw new CsvFormatError(`Faltan columnas obligatorias: ${missing.join(", ")}`);
  return header as ImportColumn[];
}

const SERIAL_PATTERN = /^[A-Za-z0-9._/ -]{1,100}$/;
const COST_CENTER_PATTERN = /^\d{1,9}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// Una celda que una planilla interpretaria como formula (CSV injection) se rechaza al entrar.
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function isRealDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Valida sintacticamente el archivo completo. Lanza CsvFormatError si la estructura es invalida; los errores
// por fila se devuelven en `issues` (no cortan el resto). La clave de duplicado de serie es lower+trim, la misma
// normalizacion que usa la base (findAssetsBySerial).
export function validateImportCsv(text: string): { rows: ParsedImportRow[]; issues: ImportIssue[]; totalRows: number } {
  const records = parseCsv(text);
  if (records.length === 0) throw new CsvFormatError("El archivo está vacío");
  const header = readHeader(records[0]!);
  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) throw new CsvFormatError("El archivo no tiene filas de datos");

  const rows: ParsedImportRow[] = [];
  const issues: ImportIssue[] = [];
  const firstRowBySerial = new Map<string, number>();

  dataRecords.forEach((record, index) => {
    const rowNumber = index + 2;
    if (record.length > header.length) {
      issues.push({ row: rowNumber, column: "-", message: `La fila tiene ${record.length} celdas y la cabecera ${header.length}` });
      return;
    }
    const cells = {} as Record<ImportColumn, string>;
    for (const column of IMPORT_COLUMNS) cells[column] = "";
    header.forEach((column, position) => {
      cells[column] = (record[position] ?? "").trim();
    });

    const rowIssues: ImportIssue[] = [];
    const fail = (column: ImportColumn, message: string): void => {
      rowIssues.push({ row: rowNumber, column, message });
    };

    for (const column of IMPORT_COLUMNS) {
      if (cells[column] && FORMULA_PREFIX.test(cells[column])) {
        fail(column, "No puede comenzar con =, +, - o @");
      }
    }

    const serial = cells.serial_number;
    if (!serial) fail("serial_number", "La serie es obligatoria");
    else if (!SERIAL_PATTERN.test(serial)) fail("serial_number", "Serie inválida: solo letras, números y . _ / - (máximo 100)");
    else {
      const key = serial.toLowerCase();
      const first = firstRowBySerial.get(key);
      if (first !== undefined) fail("serial_number", `Serie repetida en el archivo (ya está en la fila ${first})`);
      else firstRowBySerial.set(key, rowNumber);
    }

    if (!cells.product) fail("product", "El producto es obligatorio");

    let costCenterCode = 0;
    if (!cells.cost_center_code) fail("cost_center_code", "El código de centro de costo es obligatorio");
    else if (!COST_CENTER_PATTERN.test(cells.cost_center_code)) fail("cost_center_code", "El código de centro de costo debe ser un entero");
    else costCenterCode = Number(cells.cost_center_code);

    const rawStatus = cells.status.toUpperCase();
    let statusCode: ImportStatusCode = "AVAILABLE";
    if (rawStatus) {
      if ((IMPORT_STATUS_CODES as readonly string[]).includes(rawStatus)) statusCode = rawStatus as ImportStatusCode;
      else fail("status", `Estado inválido. Valores permitidos: ${IMPORT_STATUS_CODES.join(", ")}`);
    }

    const username = cells.assigned_username || null;
    const rut = cells.assigned_rut || null;
    if (statusCode === "ASSIGNED") {
      if (!username && !rut) fail("assigned_username", "Un equipo ASSIGNED requiere assigned_username o assigned_rut");
      if (username && rut) fail("assigned_rut", "Indique solo uno: assigned_username o assigned_rut");
    } else if (username || rut) {
      fail(username ? "assigned_username" : "assigned_rut", "El usuario asignado solo aplica al estado ASSIGNED");
    }

    let warranty: string | null = null;
    if (cells.warranty_expires_at) {
      if (isRealDate(cells.warranty_expires_at)) warranty = cells.warranty_expires_at;
      else fail("warranty_expires_at", "Fecha inválida: use el formato AAAA-MM-DD");
    }

    if (rowIssues.length > 0) {
      issues.push(...rowIssues);
      return;
    }
    rows.push({
      row: rowNumber,
      serialNumber: serial,
      product: cells.product,
      category: cells.category || null,
      costCenterCode,
      statusCode,
      assignedUsername: username,
      assignedRut: rut,
      warrantyExpiresAt: warranty,
    });
  });

  return { rows, issues, totalRows: dataRecords.length };
}

// Celda de un CSV de SALIDA: un valor que una planilla leeria como formula se antepone con ' y las comillas se
// duplican. Los mensajes de error pueden incluir texto que puso quien subio el archivo.
// En la salida tambien cuentan los espacios y saltos de linea antes del signo (una planilla los ignora al evaluar).
const OUTPUT_FORMULA_PREFIX = /^[\s ]*[=+\-@]/u;

export function toCsvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (OUTPUT_FORMULA_PREFIX.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsvLine(values: (string | number | null | undefined)[]): string {
  return values.map(toCsvCell).join(",");
}
