// Codigo de una devolucion de activos y, a la vez, nombre base de su guia de
// despacho: DEV + codigo numerico del centro de costo (sin relleno) +
// aaaammddHHmmssSSS en hora LOCAL del servidor. Ej.: centro 5802 el 2026-09-21
// a las 11:32:54.862 -> DEV580220260921113254862. Solo usa digitos y "DEV": nunca
// texto del cliente, asi que es seguro como nombre de archivo (ver
// sanitizeFilenameSegment en documentStorage.ts para lo que si es texto libre).
const pad = (value: number, length: number) => String(value).padStart(length, "0");

export function buildAssetReturnCode(costCenterCode: number, date: Date): string {
  const stamp =
    pad(date.getFullYear(), 4) +
    pad(date.getMonth() + 1, 2) +
    pad(date.getDate(), 2) +
    pad(date.getHours(), 2) +
    pad(date.getMinutes(), 2) +
    pad(date.getSeconds(), 2) +
    pad(date.getMilliseconds(), 3);
  return `DEV${costCenterCode}${stamp}`;
}
