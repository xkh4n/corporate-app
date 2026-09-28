// Los roles se crean como "<codigo de centro de costo>-<nombre>" (pantalla Nuevo Rol) y el usuario
// recibe el rol por su cargo: el prefijo del rol es su centro de costo.
export const SYSTEMS_COST_CENTER_CODE = 1110;

export function costCenterCodeOfRole(roleName: string | null | undefined): number | null {
  const match = /^(\d+)-/.exec(roleName ?? "");
  return match ? Number(match[1]) : null;
}

// Personal de Sistemas (centro de costo 1110).
export function isSystemsRole(roleName: string | null | undefined): boolean {
  return costCenterCodeOfRole(roleName) === SYSTEMS_COST_CENTER_CODE;
}
