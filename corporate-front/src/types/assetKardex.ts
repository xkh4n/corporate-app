// Espejo de corporate-api/src/models/postgres/assetKardexEntry.model.ts (AssetKardexEntryAttributes).
// CAPITALIZATION / DEPRECIATION / DEPRECIATION_REVERSAL: gestion contable (plan 007).
export type AssetKardexEntryType =
  | "ACQUISITION"
  | "ADJUSTMENT"
  | "WRITE_OFF"
  | "CAPITALIZATION"
  | "DEPRECIATION"
  | "DEPRECIATION_REVERSAL";

export interface AssetKardexEntry {
  id: number;
  assetId: number;
  productId: string | null;
  entryType: AssetKardexEntryType;
  entryDate: string;
  unitCost: string;
  amount: string;
  balance: string;
  reference: string | null;
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
}

// Solo ADJUSTMENT/WRITE_OFF: ACQUISITION nace exclusivamente de la recepcion
// (createAssetsFromReceipt), nunca via este endpoint.
export interface CreateManualKardexEntryInput {
  assetId: number;
  entryType: "ADJUSTMENT" | "WRITE_OFF";
  amount?: number;
  reference?: string;
  notes?: string;
}

export interface ProductKardexBalance {
  productId: string;
  balance: string;
  entryCount: number;
}
