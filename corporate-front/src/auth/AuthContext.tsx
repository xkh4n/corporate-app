import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiFetch, setUnauthorizedHandler } from "../lib/apiClient";
import type { AuthUser, LoginResponse, MeResponse, PermissionKey } from "../types/auth";
import type { MenuNode, MenuResponse } from "../types/menu";
import { AuthContext, type AuthContextValue, type AuthStatus } from "./context";

// Espeja INVALIDATION_MESSAGES de corporate-api/src/middlewares/authenticate.ts.
const SESSION_INVALIDATION_MESSAGES: Record<string, string> = {
  role_changed: "Su sesion expiro porque se actualizo su rol. Inicie sesion nuevamente.",
  password_changed: "Su sesion expiro porque se actualizo su contraseña. Inicie sesion nuevamente.",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<PermissionKey[]>([]);
  const [menu, setMenu] = useState<MenuNode[]>([]);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const me = await apiFetch<MeResponse>("/auth/me");
      if (me.user) {
        setUser(me.user);
        setPermissions(me.permissions);
        // Secuencial y solo con sesion confirmada: /auth/menu exige
        // authenticate, pedirlo antes (o en paralelo con /auth/me fallando)
        // daria un 401 que no esta en SILENT_401_PATHS y dispararia el
        // unauthorizedHandler de pura casualidad de timing. Se resuelve
        // ANTES de marcar "authenticated" para que el sidebar no parpadee
        // vacio en el primer render.
        const { menu: tree } = await apiFetch<MenuResponse>("/auth/menu");
        setMenu(tree);
        setStatus("authenticated");
      } else {
        setUser(null);
        setPermissions([]);
        setMenu([]);
        setStatus("anonymous");
      }
    } catch {
      setUser(null);
      setPermissions([]);
      setMenu([]);
      setStatus("anonymous");
    }
  }, []);

  // La cookie de sesion es httpOnly: esta llamada es la unica forma de saber,
  // al cargar la app, si ya hay una sesion viva (por ejemplo tras un F5).
  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const login = useCallback(async (username: string, password: string) => {
    // accessToken/refreshToken del body se descartan a proposito: el
    // transporte de sesion es la cookie que el backend ya seteo en esta
    // misma respuesta (ver corporate-api/src/controllers/auth.controller.ts).
    await apiFetch<LoginResponse>("/auth/login", { method: "POST", body: { username, password } });
    setSessionNotice(null);
    await loadMe();
  }, [loadMe]);

  const logout = useCallback(async () => {
    try {
      await apiFetch<void>("/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setPermissions([]);
      setMenu([]);
      setSessionNotice(null);
      setStatus("anonymous");
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await apiFetch<void>("/auth/change-password", { method: "PATCH", body: { currentPassword, newPassword } });
    // El backend invalida TODAS las sesiones del usuario al cambiar su
    // propia password (mismo watermark que un cambio de rol, ver
    // authenticate.ts) -incluida esta misma, asi que no tiene sentido
    // intentar seguir autenticado: se corta el estado local ya mismo y el
    // usuario vuelve a /login a entrar con la password nueva.
    setUser(null);
    setPermissions([]);
    setMenu([]);
    setSessionNotice(null);
    setStatus("anonymous");
  }, []);

  // Se dispara cuando CUALQUIER request autenticada (fuera de /auth/me y
  // /auth/login) vuelve 401 -por ejemplo, a alguien le cambian el rol
  // mientras tiene la app abierta. authenticate.ts distingue "role_changed" y
  // "password_changed" en details.reason; cualquier otro motivo usa un
  // mensaje generico.
  useEffect(() => {
    setUnauthorizedHandler((details) => {
      const reason = (details as { reason?: string } | undefined)?.reason;
      setSessionNotice(
        (reason && SESSION_INVALIDATION_MESSAGES[reason]) ?? "Su sesion ha expirado. Inicie sesion nuevamente.",
      );
      setUser(null);
      setPermissions([]);
      setMenu([]);
      setStatus("anonymous");
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Replica el bypass de admin en authorize() (corporate-api) a proposito: no
  // depende de que el catalogo de permisos del rol admin este completo.
  const can = useCallback(
    (key: PermissionKey) => user?.roleName === "admin" || permissions.includes(key),
    [user, permissions],
  );

  const value: AuthContextValue = {
    status,
    user,
    permissions,
    menu,
    sessionNotice,
    login,
    logout,
    changePassword,
    can,
    refreshSession: loadMe,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
