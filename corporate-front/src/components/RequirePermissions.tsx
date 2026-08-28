import type { ReactNode } from "react";
import { useAuth } from "../auth/useAuth";
import type { PermissionKey } from "../types/auth";
import { ForbiddenPage } from "../pages/forbidden/ForbiddenPage";

// Gate para una vista que exige VARIOS permisos a la vez (a diferencia del
// menu, que ya poda por UN permiso por nodo -ver GET /auth/menu). Hace falta
// cuando una pantalla orquesta varios recursos en un solo formulario (ej.
// crear BusinessPartner + Address + Supplier a la vez): ninguno de esos
// permisos por separado alcanza para saber si el usuario puede completar el
// flujo entero, asi que se exige la lista completa.
export function RequirePermissions({ all, children }: { all: PermissionKey[]; children: ReactNode }) {
  const { can } = useAuth();

  if (!all.every((key) => can(key))) {
    return <ForbiddenPage />;
  }

  return <>{children}</>;
}
