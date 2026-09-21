// Espejo de corporate-api/src/services/postgres/assetValuation.service.ts.

// Activo sin valor pendiente de valorizar (value NULL, no dado de baja ni devaluado).
export interface PendingValuationAsset {
  id: number;
  tag: string;
  serialNumber: string | null;
  status: { code: string; name: string };
  costCenter: { id: number; code: number; name: string } | null;
  productName: string | null;
  createdAt: string;
}

export interface ValuationItem {
  assetId: number;
  // > 0: el 0 esta reservado a DEVALUATED.
  value: number;
}

// Resultado por activo del lote: un fallo no aborta el resto.
export interface ValuationResult {
  assetId: number;
  ok: boolean;
  tag?: string;
  error?: string;
}
