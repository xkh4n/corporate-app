import type { AssetKardexEntryType } from "../../models/postgres/assetKardexEntry.model";

export interface AssetKardexEntryAttributes {
  id: number;
  assetId: number;
  productId: string | null;
  entryType: AssetKardexEntryType;
  entryDate: Date;
  unitCost: string;
  amount: string;
  balance: string;
  reference: string | null;
  notes: string | null;
  createdBy: number | null;
  createdAt: Date;
}

// entryDate/balance/productId nunca son input del cliente: entryDate es
// "ahora" (mismo motivo que PurchaseOrder.issuedAt, ver
// feedback_sequelize_allownull_false_needs_explicit_value), balance se
// calcula server-side (getNextBalance) y productId se copia desde
// Asset.productId. reference es una nota corta (ej. el tag del activo o el
// numero de recepcion); notes es libre.
export interface RecordAcquisitionInput {
  assetId: number;
  unitCost: string;
  reference?: string | null;
  notes?: string | null;
  createdBy?: number | null;
}

export interface RecordWriteOffInput {
  assetId: number;
  reference?: string | null;
  notes?: string | null;
  createdBy?: number | null;
}

// Asiento manual (admin-only, ver asset-kardex:create): ADJUSTMENT suma o
// resta segun el signo de "amount" (positivo/negativo), WRITE_OFF siempre
// lleva el saldo a 0 sin importar el signo que mande el cliente.
export interface CreateManualKardexEntryInput {
  assetId: number;
  entryType: "ADJUSTMENT" | "WRITE_OFF";
  amount?: string;
  reference?: string | null;
  notes?: string | null;
  createdBy?: number | null;
}

export interface ProductKardexBalance {
  productId: string;
  balance: string;
  entryCount: number;
}
