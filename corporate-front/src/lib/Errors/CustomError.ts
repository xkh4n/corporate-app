// Unico origen que le corresponde de verdad al FRONT: una validacion que
// corta el submit antes de mandar cualquier request. Autenticacion/
// autorizacion/404/500 no son errores que el front "cree" -son la respuesta
// real del backend, y ya llegan tipados con su status real como ApiError
// (ver lib/apiClient.ts). Tener ademas un CustomError con
// AUTHENTICATION/AUTHORIZATION/etc. era una segunda fuente de verdad para lo
// mismo (un 403 "de mentira" vs uno real), que es justo la confusion que se
// busca evitar clasificando el origen del error -ver handleError en ./index.
export enum ErrorType {
  VALIDATION = 'VALIDATION_ERROR',
}

export interface ErrorResponse {
  type: ErrorType;
  message: string;
  code: number;
  details?: unknown;
}

export class CustomError extends Error {
  public type: ErrorType;
  public code: number;
  public details?: unknown;

  constructor(type: ErrorType, message: string, code: number = 400, details?: unknown) {
    super(message);
    this.type = type;
    this.code = code;
    this.details = details;
    this.name = 'CustomError';
  }

  public toJSON(): ErrorResponse {
    return {
      type: this.type,
      message: this.message,
      code: this.code,
      details: this.details
    };
  }
}

export const createValidationError = (message: string, details?: unknown) => {
  return new CustomError(ErrorType.VALIDATION, message, 400, details);
};