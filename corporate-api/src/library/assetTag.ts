// Plan 018: solo los activos comprados (tag ACT, productType COMPRA) pasan por Contabilidad. Los
// arriendos (ARR) y servicios (SRV) se devuelven al proveedor: salen del estado de pago, sin
// clasificacion, valorizacion ni baja contable. El prefijo lo fija generateAssetTag segun el
// productType y no cambia nunca, por eso basta mirar el tag.
export const ACCOUNTING_TAG_PREFIX = "ACT";

export function isAccountingTag(tag: string): boolean {
  return tag.startsWith(ACCOUNTING_TAG_PREFIX);
}

// Para filtrar en SQL: `a.tag LIKE :accountingTagPattern`.
export const ACCOUNTING_TAG_LIKE = `${ACCOUNTING_TAG_PREFIX}%`;
