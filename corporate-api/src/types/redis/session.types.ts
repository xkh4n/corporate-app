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
  // Plan 015: mientras sea true, authenticate.ts solo deja pasar /auth/me, /auth/menu y el cambio de
  // password. Se fija en el login y no se actualiza: cambiar la password invalida la sesion entera.
  mustChangePassword?: boolean;
  // Plan 017: MFA obligatorio y la cuenta todavia no enrolo ningun factor. Mismo bloqueo que
  // mustChangePassword, pero se libera en la misma sesion al confirmar el primer factor.
  mfaEnrollmentRequired?: boolean;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUserData;
    // Plan 017: login con la password ya validada pero sin el segundo factor (o sin verificar el
    // correo en el primer ingreso). El estado vive en Redis (services/redis/mfa.service.ts); aca solo
    // el id opaco. Nunca coexiste con "user": la sesion se regenera al pasar de uno al otro.
    mfaPendingId?: string;
  }
}
