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
// corriendo "DROP CONSTRAINT IF EXISTS" + "ADD CONSTRAINT" en paralelo
// (ver migratePermissions en databases/postgres/migrate.ts), una replica
// puede dropear-y-agregar antes de que otra llegue a agregar la suya,
// que entonces choca con SQLSTATE 42710 (duplicate_object) -no es un error
// real, es "otra replica ya la dejo en el estado correcto".
export function isDuplicateObjectError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { parent?: { code?: string }; original?: { code?: string } }).parent?.code
    ?? (err as { original?: { code?: string } }).original?.code;
  return code === "42710";
}
