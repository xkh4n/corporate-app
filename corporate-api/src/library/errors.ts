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
  constructor(message = "No autenticado") {
    super(401, message);
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
