// Los roles se crean como "<codigo de centro de costo>-<nombre>" (pantalla Nuevo Rol) y el usuario
// recibe el rol por su cargo: el prefijo del rol es su centro de costo.
// Seguridad (revision 2026-09-28, M1): como el privilegio sale del nombre, solo un administrador crea o
// renombra roles de Sistemas, y un no-admin no edita su propio rol (role.controller.ts).
export const SYSTEMS_COST_CENTER_CODE = "1110";

// El codigo tal cual aparece en el nombre (sin convertir a numero: "01110-x" no es Sistemas).
export function costCenterCodeOfRole(roleName: string | null | undefined): string | null {
  const match = /^(\d+)-/.exec(roleName ?? "");
  return match ? match[1]! : null;
}

// Personal de Sistemas (centro de costo 1110).
export function isSystemsRole(roleName: string | null | undefined): boolean {
  return costCenterCodeOfRole(roleName) === SYSTEMS_COST_CENTER_CODE;
}
