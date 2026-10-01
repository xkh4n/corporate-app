import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import {
  getUserByUsername,
  getUserByIdOrThrow,
  changePassword as changeUserPassword,
} from "../services/mssql/user.service";
import { getRoleByIdOrThrow } from "../services/postgres/role.service";
import { getEffectivePermissionsForRole } from "../services/postgres/permission.service";
import { getMenuTreeForRole } from "../services/postgres/menuItem.service";
import { getPersonByIdOrThrow } from "../services/mssql/person.service";
import { comparePassword } from "../library/password";
import { verifyRefreshToken } from "../library/jwt";
import {
  isRefreshTokenValid,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  invalidateUserSessions,
} from "../services/redis/session.service";
import { AppError, BadRequestError, ForbiddenError, UnauthorizedError } from "../library/errors";
import { env } from "../library/env";
import { readSecretFromEnv } from "../library/secrets";
import { sendOk, sendNoContent } from "../library/response";
import type { AuthenticatedUser } from "../types/auth.types";
import { completeLogin, issueTokenPair, regenerateSession } from "../library/authSession";
import { availableMethods, countFactors, getMfaFactors } from "../services/mssql/mfa.service";
import { createPending, deletePending, isUserLocked, type MfaStage } from "../services/redis/mfa.service";

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  // Opt-in, default false: el SPA (corporate-front) solo usa la cookie de
  // sesion y descarta accessToken/refreshToken si llegan (ver
  // AuthContext.tsx), asi que emitirlos siempre era exponer mas material
  // sensible del necesario en cada login (hallazgo de auditoria de
  // seguridad 2026-08-12, ligado al hallazgo de logging: mientras mas se
  // emite, mas puede terminar filtrado si algo como esa fuga vuelve a
  // pasar). Reservado para un futuro cliente no-browser (mobile/integracion)
  // que si necesite el par de tokens.
  issueTokens: z.boolean().optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

// Plan 015: la password por defecto nunca habilita la API, aunque la cuenta no tenga
// mustChangePassword (p. ej. alguien que la eligio antes de que existiera este chequeo).
// Se lee una vez (mismo criterio que los secrets JWT): evita un readFileSync en cada login.
let defaultPassword: string | undefined;
function isDefaultPassword(password: string): boolean {
  defaultPassword ??= readSecretFromEnv(env.users.defaultPasswordFileVar);
  return password === defaultPassword;
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { username, password, issueTokens } = req.body as z.infer<typeof loginSchema>;

    // Mensaje generico en ambos casos (usuario inexistente vs password
    // incorrecta): no darle a un atacante una forma de enumerar usuarios.
    const user = await getUserByUsername(username);
    if (!user || !user.isActive) {
      throw new UnauthorizedError("Credenciales invalidas");
    }

    const passwordMatches = await comparePassword(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedError("Credenciales invalidas");
    }

    const role = await getRoleByIdOrThrow(user.roleId);
    // Mismo mensaje generico que el resto de este bloque: un rol desactivado
    // no debe distinguirse de credenciales invalidas ante el cliente.
    if (!role.isActive) {
      throw new UnauthorizedError("Credenciales invalidas");
    }
    const authUser: AuthenticatedUser = {
      userId: user.id,
      personId: user.personId,
      username: user.username,
      roleId: role.id,
      roleName: role.name,
    };
    // Marca de cambio obligatorio (ver authenticate.ts): se fija aca y dura lo que dure la sesion.
    const mustChangePassword = user.mustChangePassword || isDefaultPassword(password);

    // Plan 017: con un factor enrolado, la password sola no autentica: queda un login a medio camino
    // (sin req.session.user) hasta POST /auth/mfa/verify. Si MFA es obligatorio y la cuenta no tiene
    // factores (primer ingreso con la password temporal compartida, cuentas anteriores al plan o
    // despues de un reset administrativo), se exige antes un codigo al correo de la persona: la
    // password sola nunca alcanza para enrolar el primer factor (revision de seguridad 2026-10-01).
    const factors = await getMfaFactors(user);
    const enrolled = countFactors(factors) > 0;
    let stage: MfaStage | null = null;
    if (enrolled) stage = "MFA";
    else if (env.mfa.required) stage = "EMAIL_VERIFY";

    if (stage) {
      const methods = stage === "MFA" ? availableMethods(factors) : ["email"];
      // Solo passkeys registradas con el metodo apagado por config y sin codigos de recuperacion:
      // no hay forma de terminar el login. Lo resuelve un reset administrativo del MFA.
      if (methods.length === 0) {
        throw new ForbiddenError(
          "Su cuenta no tiene un segundo factor disponible. Pida a un administrador que lo restablezca.",
          { reason: "mfa_unavailable" },
        );
      }
      // Cuenta bloqueada por fallos de segundo factor: no se abre otro login a medio camino.
      if (await isUserLocked(user.id)) {
        throw new AppError(429, "Demasiados intentos fallidos de segundo factor. Intente mas tarde.", { reason: "mfa_locked" });
      }
      // Fixation: el id de sesion anonimo nunca pasa a identificar un login, ni siquiera a medias.
      await regenerateSession(req);
      const pendingId = await createPending({
        userId: user.id,
        stage,
        issueTokens: issueTokens === true,
        mustChangePassword,
      });
      if (req.session) req.session.mfaPendingId = pendingId;
      // mfaToken solo para clientes solo-token (issueTokens): el SPA sigue solo con la cookie.
      sendOk(
        res,
        { next: stage, methods, ...(issueTokens ? { mfaToken: pendingId } : {}) },
        stage === "MFA" ? "Se requiere el segundo factor" : "Se requiere verificar su correo",
      );
      return;
    }

    // Aca solo llegan cuentas sin factores con MFA opcional: nada que enrolar a la fuerza.
    const mfaEnrollmentRequired = false;
    const tokens = await completeLogin(req, authUser, {
      mustChangePassword,
      mfaEnrollmentRequired,
      issueTokens: issueTokens === true,
    });

    sendOk(
      res,
      { user: authUser, next: mfaEnrollmentRequired ? "MFA_ENROLL" : null, ...tokens },
      "Login exitoso",
    );
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
    const payload = verifyRefreshToken(refreshToken);

    if (!payload.jti || !(await isRefreshTokenValid(payload.jti, payload.sub))) {
      throw new UnauthorizedError("Refresh token invalido o revocado");
    }

    // Plan 015: la marca se relee de la BD, asi un refresh emitido antes de que existiera (o antes de
    // un reset administrativo) no la esquiva. Una cuenta desactivada tampoco renueva.
    const user = await getUserByIdOrThrow(payload.sub);
    if (!user.isActive) throw new UnauthorizedError("Refresh token invalido");
    const mustChangePassword = payload.mustChangePassword === true || user.mustChangePassword;
    // Plan 017: se relee de la BD, igual que la marca de password: si ya enrolo, el token nuevo sale
    // limpio; si MFA paso a ser obligatorio despues de emitirlo, el token nuevo ya lo exige.
    const mfaEnrollmentRequired = env.mfa.required && countFactors(await getMfaFactors(user)) === 0;

    // Rotacion: el jti usado se invalida de inmediato, se emite un par nuevo.
    await revokeRefreshToken(payload.jti, payload.sub);
    const tokens = await issueTokenPair({
      userId: payload.sub,
      personId: payload.personId,
      username: payload.username,
      roleId: payload.roleId,
      roleName: payload.roleName,
    }, { mustChangePassword, mfaEnrollmentRequired });

    sendOk(res, tokens, "Tokens renovados exitosamente");
  } catch (err) {
    next(err instanceof UnauthorizedError ? err : new UnauthorizedError("Refresh token invalido"));
  }
}

// Body opcional: un cliente puede llamar a logout sin refreshToken (solo
// quiere limpiar su cookie de sesion).
export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string };
    let userId: number | undefined;

    if (refreshToken) {
      try {
        const payload = verifyRefreshToken(refreshToken);
        userId = payload.sub;
        if (payload.jti) await revokeRefreshToken(payload.jti, payload.sub);
      } catch {
        // Token ya invalido/expirado: no hay nada que revocar, no es un error de logout.
      }
    }

    if (req.session?.user) {
      userId = userId ?? req.session.user.userId;
    }
    // Plan 017: "cancelar" en la pantalla del segundo factor descarta el login a medio camino.
    if (req.session?.mfaPendingId) {
      await deletePending(req.session.mfaPendingId);
    }

    if (req.session) {
      await new Promise<void>((resolve, reject) => {
        req.session.destroy((err) => (err ? reject(err) : resolve()));
      });
    }

    if (userId !== undefined) {
      await invalidateUserSessions(userId, "logout");
    }

    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

// Incluye los permisos del propio rol (aplanados "resource:action") ademas
// del usuario: es el unico endpoint que un no-admin tiene para saber que
// puede hacer -GET /roles/:id/permissions exige "roles:read" (admin-only),
// asi que el frontend arma su navegacion a partir de esto. "admin" tiene
// bypass hardcodeado en authorize() (ver middlewares/authorize.ts), no
// depende de este array para tener acceso real.
export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      sendOk(res, { user: null, permissions: [] }, "Usuario actual obtenido exitosamente");
      return;
    }

    // firstName/lastName solo para mostrar el nombre completo en el front
    // (ver DashboardPage). Se busca aca, no en AuthenticatedUser/JWT/sesion:
    // personId sale de la sesion ya autenticada, no de un input del cliente,
    // asi que consultar su propia persona es autoservicio -no exige
    // "persons:read" (RBAC, PII), igual que changePassword no exige
    // "users:update" para la propia contraseña.
    const [permissions, person, fullUser] = await Promise.all([
      getEffectivePermissionsForRole(req.user.roleId).then((rows) => rows.map((p) => `${p.resource}:${p.action}`)),
      getPersonByIdOrThrow(req.user.personId),
      getUserByIdOrThrow(req.user.userId),
    ]);
    const factors = await getMfaFactors(fullUser);
    // mustChangePassword sale de una lectura fresca de la BD (no de la
    // sesion/JWT, que solo tienen lo que habia al momento del login) -asi
    // que un PATCH /auth/change-password exitoso se refleja de inmediato en
    // la siguiente llamada a /auth/me sin depender de reinicio de sesion.
    const user = {
      ...req.user,
      firstName: person.firstName,
      lastName: person.lastName,
      // La marca de la sesion tambien cuenta: entro con la password por defecto sin tener el flag.
      mustChangePassword: fullUser.mustChangePassword || req.passwordChangePending === true,
      // Plan 017: lectura fresca, igual que mustChangePassword (la marca de la sesion o del token
      // queda vieja apenas se confirma el primer factor).
      mfaEnrollmentRequired: env.mfa.required && countFactors(factors) === 0,
      // Al menos un factor activo, sea o no obligatorio (el front lo muestra en la barra superior).
      mfaEnrolled: countFactors(factors) > 0,
    };
    sendOk(res, { user, permissions }, "Usuario actual obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

// Arbol de navegacion ya podado a lo que el rol del usuario puede ver (ver
// getMenuTreeForRole en services/postgres/menuItem.service.ts). Separado de
// "me" a proposito: ese es liviano y se llama seguido (chequeo de sesion al
// montar la app), armar el arbol completo es mas trabajo y no siempre hace
// falta en el mismo momento.
export async function menu(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      sendOk(res, { menu: [] }, "Menu obtenido exitosamente");
      return;
    }

    const tree = await getMenuTreeForRole(req.user.roleId, req.user.roleName === "admin");
    sendOk(res, { menu: tree }, "Menu obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

// Auto-servicio: cualquier usuario autenticado cambia SU PROPIA contraseña,
// a diferencia de PATCH /users/:id/password (requiere permiso "users:update"
// -uso administrativo, no valida contraseña actual). Por eso aca si se exige
// currentPassword antes de delegar a userService.changePassword.
export async function changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const userId = req.user!.userId;

    const user = await getUserByIdOrThrow(userId);
    const passwordMatches = await comparePassword(currentPassword, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedError("Contraseña actual incorrecta");
    }
    if (isDefaultPassword(newPassword)) {
      throw new BadRequestError("No puede usar la contraseña por defecto", { field: "newPassword" });
    }

    // Auto-servicio: el propio dueño de la cuenta eligio la password nueva
    // -a diferencia del reset administrativo, esto SI cierra el ciclo de
    // mustChangePassword (ver createUser/reset admin en user.service.ts).
    await changeUserPassword(userId, newPassword, { mustChangePassword: false });

    // Mismo criterio que el cambio administrativo (ver user.controller.ts):
    // invalida todas las sesiones/refresh tokens, incluida la que hizo este
    // request -el cliente debe iniciar sesion de nuevo con la contraseña
    // nueva.
    await revokeAllRefreshTokens(userId);
    await invalidateUserSessions(userId, "password_changed");

    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}
