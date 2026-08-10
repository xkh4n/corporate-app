import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import type { PermissionKey } from "../types/auth";

// Se anida DENTRO de ProtectedRoute (la sesion ya esta garantizada). Oculta
// el item de menu no alcanza si alguien escribe la URL a mano -por eso este
// guard existe ademas del filtro en el sidebar (config/navigation.ts). No es
// el control de acceso real: el backend sigue gateando cada endpoint con
// authorize() (corporate-api/src/middlewares/authorize.ts); esto es UX.
export function PermissionRoute({ permission }: { permission: PermissionKey }) {
  const { can } = useAuth();

  if (!can(permission)) {
    return <Navigate to="/403" replace />;
  }

  return <Outlet />;
}
