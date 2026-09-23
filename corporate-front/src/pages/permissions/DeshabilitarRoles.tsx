import { RequirePermissions } from "../../components/RequirePermissions";
import { RoleBrowser } from "../personas/RoleBrowser";

// Misma vista que "Ver Rol" + boton Deshabilitar (DELETE /roles/:id, que
// exige "roles:delete"). "roles:read" sigue haciendo falta para el listado.
// "admin" no se puede deshabilitar desde aca (ver RoleBrowser/role.service.ts).
const REQUIRED_PERMISSIONS = ["roles:read", "roles:delete"] as const;

export default function DeshabilitarRoles() {
    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <RoleBrowser title="Deshabilitar Roles" mode="deactivate" />
        </RequirePermissions>
    );
}
