import { RequirePermissions } from "../../components/RequirePermissions";
import { RoleBrowser } from "./RoleBrowser";

// GET /roles y GET /roles/:id/permissions exigen ambos "roles:read" (ver
// role.routes.ts en corporate-api). Vista de solo lectura: asignar o quitar
// permisos se hace desde Permisos > "Modificar Permisos", deshabilitar desde
// Gerencia de TI > "Deshabilitar Roles".
const REQUIRED_PERMISSIONS = ["roles:read"] as const;

export default function ListarRole() {
    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <RoleBrowser title="Ver Rol / Función" />
        </RequirePermissions>
    );
}
