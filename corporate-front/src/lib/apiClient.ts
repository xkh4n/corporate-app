import type { ApiEnvelope } from "../types/api";

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
}

// Notifica a AuthContext cuando una request YA AUTENTICADA vuelve 401 (rol
// cambiado, password cambiada, sesion invalidada del lado del servidor -ver
// middlewares/authenticate.ts en corporate-api) para que limpie el estado y
// redirija a /login. /auth/me y /auth/login quedan afuera: un 401 ahi es
// flujo normal (chequeo de sesion al montar, credenciales invalidas), no una
// sesion que se cae en medio del uso.
type UnauthorizedHandler = (details: unknown) => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

const SILENT_401_PATHS = new Set(["/auth/me", "/auth/login"]);

// Cubre las dos formas de error que emite el backend: la estandar
// {codigo, message, details?} de errorHandler.ts, y la del rate limiter de
// login, que responde 429 con {error: string} sin "codigo" -ver
// middlewares/rateLimit.ts en corporate-api.
async function parseErrorBody(res: Response): Promise<{ message: string; details?: unknown }> {
  try {
    const body = (await res.json()) as { codigo?: number; message?: string; error?: string; details?: unknown };
    return { message: body.message ?? body.error ?? res.statusText, details: body.details };
  } catch {
    return { message: res.statusText };
  }
}

// Todas las llamadas van con credentials:"include" -la autenticacion viaja
// por la cookie de sesion httpOnly (sid), no por un token en JS. Ver
// vite.config.ts: el dev server proxea /api al backend para que el
// navegador vea un solo origen y la cookie no quede bloqueada por CORS.
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  if (!res.ok) {
    const { message, details } = await parseErrorBody(res);
    if (res.status === 401 && !SILENT_401_PATHS.has(path)) {
      unauthorizedHandler?.(details);
    }
    throw new ApiError(res.status, message, details);
  }

  const envelope = (await res.json()) as ApiEnvelope<T>;
  return envelope.data;
}
