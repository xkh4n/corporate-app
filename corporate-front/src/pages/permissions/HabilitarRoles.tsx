import { RequirePermissions } from "../../components/RequirePermissions";
import { RoleBrowser } from "../personas/RoleBrowser";

// Misma vista que "Ver Rol" + boton Habilitar en los roles inactivos.
// PATCH /roles/:id/activate exige AMBOS "roles:update" y "roles:activate"
// (ver role.routes.ts): activate se otorga solo a usuarios puntuales.
// "roles:read" hace falta para el listado. "admin" no se toca desde aca.
const REQUIRED_PERMISSIONS = ["roles:read", "roles:update", "roles:activate"] as const;

export default function HabilitarRoles() {
    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <RoleBrowser title="Habilitar Roles" mode="activate" />
        </RequirePermissions>
    );
}
