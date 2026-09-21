// Claves de Redis de la carga masiva de activos por CSV (plan 005; los datos viven bajo `imp:{jobId}:`).
//   meta   hash    cabecera del trabajo (estado, contadores, cursor)
//   rows   string  JSON con las filas ya resueltas que procesara el worker
//   issues string  JSON con los problemas de validacion (acotado)
//   res    hash    indice de fila -> resultado ({ok, tag} | {ok:false, error})
//   lease  string  id del worker que lo procesa (SET NX PX; vence solo si el worker muere)
export const IMPORT_JOB_PARTS = ["meta", "rows", "issues", "res"] as const;
export type ImportJobPart = (typeof IMPORT_JOB_PARTS)[number] | "lease";

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// El id llega en la URL: solo se usa como parte de una clave si es un UUID (nada de patrones ni separadores).
export function isImportJobId(value: string): boolean {
  return JOB_ID_PATTERN.test(value);
}

export function importJobKey(jobId: string, part: ImportJobPart): string {
  return `imp:${jobId}:${part}`;
}

// Un trabajo en curso por usuario: guarda el id del trabajo activo.
export function importActiveJobKey(userId: number): string {
  return `imp:user:${userId}:active`;
}

// Un borrador (carga VALIDATED sin iniciar) por usuario: guarda el id del ultimo. Al validar otro archivo se borra el
// anterior, asi el espacio en Redis que puede ocupar un usuario con borradores esta acotado.
export function importDraftKey(userId: number): string {
  return `imp:user:${userId}:draft`;
}

// Cuenta las identidades (usuario / RUT) que NO se resolvieron al validar, por usuario y hora: un enumerador falla
// casi todas y un archivo legitimo casi ninguna.
export function importIdentityMissKey(userId: number): string {
  return `imp:user:${userId}:idmiss`;
}

export const IMPORT_META_SCAN_PATTERN = "imp:*:meta";
