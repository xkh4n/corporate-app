export class AppError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Solicitud invalida", details?: unknown) {
    super(400, message, details);
    this.name = "BadRequestError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "No autenticado", details?: unknown) {
    super(401, message, details);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "No autorizado") {
    super(403, message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Recurso no encontrado") {
    super(404, message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "El recurso ya existe", details?: unknown) {
    super(409, message, details);
    this.name = "ConflictError";
  }
}

// Las 3 replicas de la API arrancan en paralelo y cada una corre su propio
// seed de "primer arranque" (ver src/databases/seed.ts): sin este chequeo,
// dos replicas pueden pasar el "count() === 0" al mismo tiempo e intentar
// insertar la misma data de referencia dos veces, chocando contra una
// UNIQUE constraint. Sequelize normaliza esa violacion al mismo nombre de
// error sin importar el motor (Postgres o MSSQL).
export function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && err.name === "SequelizeUniqueConstraintError";
}

// Mismo problema que isUniqueConstraintError pero para DDL: Postgres no
// tiene "ADD CONSTRAINT IF NOT EXISTS", asi que con las 3 replicas
// corriendo DROP+ADD (o, en un restart normal, el mismo ADD reintentado
// porque no hay guard previo -ver migrateMenuItems) en paralelo, una
// replica puede dejar el objeto ya creado antes de que otra llegue al suyo.
// Dos SQLSTATE distintos cubren "esto ya existe" segun el tipo de objeto:
// 42710 (duplicate_object) para constraints sin indice propio (ej. el CHECK
// de permissions_action_allowed), 42P07 (duplicate_table) para lo que crea
// una relacion fisica -un UNIQUE/PK agrega un indice implicito con ese
// nombre, y ESE es el que choca (ver uq_menu_items_label mas abajo). Ninguno
// de los dos es un error real, es "otra corrida ya lo dejo en el estado
// correcto".
export function isDuplicateObjectError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { parent?: { code?: string }; original?: { code?: string } }).parent?.code
    ?? (err as { original?: { code?: string } }).original?.code;
  return code === "42710" || code === "42P07";
}

// Mismo problema que isDuplicateObjectError pero para MSSQL: el patron
// "IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = ...) BEGIN CREATE
// TABLE ... END" (MSSQL no tiene "CREATE TABLE IF NOT EXISTS") no es atomico
// -el SELECT y el CREATE son statements separados-, asi que con las 3
// replicas migrando en paralelo contra una base recien creada (instalacion
// limpia), dos pueden pasar el IF NOT EXISTS a la vez y una choca al crear
// (error 2714, "There is already an object named X"). El mismo hueco existe
// para los INSERT guardados con "IF NOT EXISTS (SELECT 1 FROM ... WHERE ...)
// INSERT ..." (ver document_numbering en databases/mssql/migrate.ts), que en
// vez de 2714 chocan contra la PK/UNIQUE (error 2627) -no es un error real,
// es "otra replica ya dejo la tabla/fila en el estado correcto".
// tedious representa un error de un statement simple (DDL, insert de 1 fila)
// como {parent: {number}}, pero un bulkCreate (INSERT multi-fila) lo envuelve
// en un AggregateError nativo -tedious hace "new AggregateError(this.errors)"
// (ver node_modules/tedious/lib/token/handler.js)-, cuya propiedad real es
// ".errors" (spec de AggregateError), NO ".aggregateErrors". Ese nombre solo
// existe en el JSON que pino imprime al loguear el error (pino-std-serializers
// renombra ".errors" a "aggregateErrors" en su salida, ver err.js de ese
// paquete) -el chequeo original leyo el campo del LOG en vez del objeto real,
// asi que nunca hizo match: se encontro en un clean install real (2026-08-18,
// Testing) con 3 replicas corriendo seedCountries en paralelo contra una
// tabla countries recien creada -el guard debia tragarse el 2627 y no lo
// hizo, tumbando el arranque de las 3 replicas pese a "estar ya arreglado".
function extractMssqlErrorNumber(err: unknown): number | undefined {
  if (!(err instanceof Error)) return undefined;
  const parent = (err as { parent?: unknown; original?: unknown }).parent
    ?? (err as { original?: unknown }).original;
  if (!parent || typeof parent !== "object") return undefined;

  const direct = (parent as { number?: number }).number;
  if (typeof direct === "number") return direct;

  const aggregateErrors = (parent as { errors?: Array<{ number?: number }> }).errors;
  return aggregateErrors?.find((entry) => typeof entry.number === "number")?.number;
}

// 1913 ("...an index or statistics with name '%.*ls' already exists on
// table...") es el numero real que tira MSSQL para un CREATE INDEX que
// choca -distinto de 2714 (objetos con nombre propio: tablas/constraints) y
// 2627 (violacion de PK/UNIQUE al insertar). Encontrado en un restart real
// de las 3 replicas (2026-08-21, Development): con el guard "IF NOT EXISTS"
// no atomico de siempre (ver el comentario largo mas arriba), dos replicas
// corriendo CREATE INDEX ix_purchase_requests_approver_id en paralelo
// contra una base donde el indice ya se habia creado en un restart previo
// -pero recien en ESTE restart una replica ganaba la carrera del "IF NOT
// EXISTS" y la otra chocaba con 1913, sin que isDuplicateMssqlObjectError
// lo reconociera-. Sin este numero cubierto, el guard fallaba exactamente
// para lo que existe: "otra replica ya dejo el indice en el estado
// correcto" no es un error real.
export function isDuplicateMssqlObjectError(err: unknown): boolean {
  const number = extractMssqlErrorNumber(err);
  return number === 2714 || number === 2627 || number === 1913;
}
