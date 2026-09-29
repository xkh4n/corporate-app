// RUT tal como se guarda en persons.document_id (Nuevo Ingreso): sin puntos ni espacios, con guion y
// digito verificador en mayuscula ("12345678-K"). Se aplica al guardar y al buscar para que
// "12.345.678-k" y "12345678-K" sean el mismo RUT. Solo normaliza: no valida el digito.
export function normalizeRut(value: string): string {
  const compact = value.replace(/[.\s]/g, "").toUpperCase();
  if (compact.includes("-") || compact.length < 2) return compact;
  return `${compact.slice(0, -1)}-${compact.slice(-1)}`;
}
