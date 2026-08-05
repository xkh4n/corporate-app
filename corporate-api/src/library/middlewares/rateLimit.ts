import rateLimit from "express-rate-limit";

// Freno de fuerza bruta sobre /auth/login. No distingue por usuario, solo
// por IP (default de express-rate-limit): suficiente como primera capa;
// bloqueo por usuario/lockout queda para un pase futuro si hace falta.
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de inicio de sesion, intenta mas tarde" },
});
