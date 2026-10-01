import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { RequestHandler } from "express";
import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { redis } from "../../databases/redis/connection";
import { getUserInvalidation } from "../../services/redis/session.service";
import { env } from "../env";
import { logger } from "../logger";
import type { SessionUserData } from "../../types/redis/session.types";

let io: SocketIOServer | null = null;

// @types/express-session (esta version) solo declara el merge de ".session"
// sobre Express.Request (declare global { namespace Express {...} }), no
// sobre http.IncomingMessage -alcanza para REST (donde req YA es un
// express.Request), pero socket.request (Socket.IO) es un IncomingMessage
// crudo, sin ese merge. En runtime SI tiene ".session" (express-session lo
// asigna directo sobre el objeto request, no depende de los tipos de
// Express) -io.engine.use(sessionMiddleware) corre exactamente el mismo
// middleware que REST, ver initSocketServer mas abajo. Este tipo local
// documenta esa forma real sin depender del merge que este paquete no da.
interface RequestWithSession extends IncomingMessage {
  session?: { user?: SessionUserData };
}

// Solo websocket, sin long-polling (transports:["websocket"] tambien del
// lado del cliente, ver corporate-front/src/lib/socket.ts): el upstream
// "api_backend" en nginx.conf.template balancea round-robin SIN ip_hash, y
// el long-polling de Socket.IO exige que todas las requests de una sesion
// lleguen a la misma replica -con solo-websocket, el GET con Upgrade elige
// una replica una sola vez y la conexion persiste ahi toda la sesion, sin
// necesitar sticky sessions (ver seccion B.1 del plan de implementacion).
//
// Auth de conexion: reusa la MISMA sesion Redis que REST (io.engine.use
// corre sessionMiddleware sobre el handshake HTTP, soportado desde Socket.IO
// 4.6), sin token nuevo -la SPA es cookie-only hoy (AuthContext nunca
// guarda un token).
//
// Fan-out entre las 3 replicas: @socket.io/redis-adapter sobre 2 conexiones
// Redis dedicadas (pub/sub no puede compartirse con comandos normales) -asi
// io.to("user:X").emit(...) llega al socket de X sin importar en que
// replica este conectado.
export async function initSocketServer(
  httpServer: HttpServer,
  sessionMiddleware: RequestHandler,
): Promise<SocketIOServer> {
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);

  // Mismo allowlist CORS_ORIGIN que Express (ver api.ts) -sin esto,
  // engine.io deja su default inseguro (cors:false, sin validar Origin) para
  // el unico endpoint de upgrade WebSocket del servidor (hallazgo de
  // auditoria de seguridad 2026-09-17, CSWSH).
  const allowedOrigins = env.corsOrigin === "*" ? "*" : env.corsOrigin.split(",").map((origin) => origin.trim());
  io = new SocketIOServer(httpServer, {
    path: "/api/socket.io",
    transports: ["websocket"],
    adapter: createAdapter(pubClient, subClient),
    cors: { origin: allowedOrigins, credentials: env.corsOrigin !== "*" },
  });

  io.engine.use(sessionMiddleware);

  io.use(async (socket, next) => {
    const user = (socket.request as RequestWithSession).session?.user;
    if (!user) {
      next(new Error("No autenticado"));
      return;
    }

    // Mismo watermark que middlewares/authenticate.ts: si el rol/password
    // cambio o el usuario fue desactivado DESPUES de este login, se corta
    // tambien el socket, no solo REST.
    const invalidation = await getUserInvalidation(user.userId);
    const issuedAt = Math.floor(new Date(user.loginAt).getTime() / 1000);
    if (invalidation && issuedAt <= invalidation.validAfter) {
      next(new Error("Sesion invalidada"));
      return;
    }

    // Plan 015: sin socket mientras la password por defecto no se haya cambiado.
    if (user.mustChangePassword) {
      next(new Error("Debe cambiar su contraseña"));
      return;
    }

    // Plan 017: tampoco mientras falte enrolar el segundo factor obligatorio. Las sesiones a medio
    // login (mfaPendingId) ni llegan aca: no tienen "user".
    if (user.mfaEnrollmentRequired) {
      next(new Error("Debe configurar un segundo factor"));
      return;
    }

    socket.data.userId = user.userId;
    socket.data.personId = user.personId;
    next();
  });

  io.on("connection", (socket) => {
    void socket.join(`user:${socket.data.userId as number}`);
  });

  logger.info("Socket.IO inicializado (adapter Redis, solo websocket)");
  return io;
}

export function getIo(): SocketIOServer | null {
  return io;
}
