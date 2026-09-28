// Los roles se crean como "<codigo de centro de costo>-<nombre>" (Nuevo Rol): el prefijo es el centro de
// costo del usuario. Mismo criterio que corporate-api/src/library/roleCostCenter.ts; la API es la que manda.
export const SYSTEMS_COST_CENTER_CODE = "1110";

export function isSystemsRole(roleName: string | null | undefined): boolean {
  const match = /^(\d+)-/.exec(roleName ?? "");
  return match !== null && match[1] === SYSTEMS_COST_CENTER_CODE;
}
