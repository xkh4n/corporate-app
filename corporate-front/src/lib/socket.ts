import { io, type Socket } from "socket.io-client";

// Singleton: una sola conexion para toda la app (mismo criterio que
// apiFetch en apiClient.ts). Mismo origen que la SPA -sin URL explicita, el
// cliente conecta a window.location.origin, que nginx-frontdev ya proxea a
// "/api/socket.io" hacia nginx-apidev (ver nginx.conf.template).
//
// transports:["websocket"], upgrade:false: sin long-polling, el upstream de
// nginx-apidev balancea round-robin SIN sticky sessions (ver
// library/realtime/socketServer.ts en corporate-api para el detalle).
// withCredentials:true: la autenticacion viaja por la cookie de sesion
// httpOnly, igual que apiFetch.
// autoConnect:false: NotificationsProvider decide cuando conectar (recien
// con sesion confirmada) y desconecta al hacer logout.
export const socket: Socket = io({
  path: "/api/socket.io",
  transports: ["websocket"],
  upgrade: false,
  withCredentials: true,
  autoConnect: false,
});
