// Forma de los datos guardados en Redis bajo la sesion HTTP (connect-redis
// persiste esto serializado en la key "sess:<sid>"). No confundir con
// AuthenticatedUser (auth.types.ts): esto es lo que vive en Redis, aquello es
// lo que queda colgado de req.user en cada request ya autenticado.
export interface SessionUserData {
  userId: number;
  personId: number;
  username: string;
  roleId: number;
  roleName: string;
  loginAt: string;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUserData;
  }
}
