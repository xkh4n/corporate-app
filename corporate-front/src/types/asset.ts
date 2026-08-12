// Espejo de corporate-api/src/models/postgres/asset.model.ts (AssetAttributes).
import type { AssetStatus } from "./assetStatus";

export interface Asset {
  id: number;
  tag: string;
  statusId: number;
  serialNumber: string | null;
  warrantyExpiresAt: string | null;
  value: string | null;
  receivedAt: string | null;
  goodsReceiptId: number | null;
  costCenterId: number | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  status: AssetStatus;
}

// No hay AssetCreateInput: los assets nacen server-side al confirmar un GoodsReceipt, no se crean via este recurso.
export interface AssetUpdateInput {
  serialNumber?: string;
  warrantyExpiresAt?: string;
  value?: number;
}
