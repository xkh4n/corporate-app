// Espejo de corporate-api/src/models/postgres/asset.model.ts (AssetAttributes).
import type { AssetStatus } from "./assetStatus";
import type { CostCenter } from "./costCenter";

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
  productId: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  status: AssetStatus;
  // Solo poblado por endpoints que lo incluyen explicitamente (ver
  // getAssetsByRequestId en asset.service.ts, usado por AssignAssets.tsx).
  costCenter?: CostCenter | null;
}

// No hay AssetCreateInput: los assets nacen server-side al confirmar un GoodsReceipt, no se crean via este recurso.
export interface AssetUpdateInput {
  serialNumber?: string;
  warrantyExpiresAt?: string;
  value?: number;
}

// Espejo de corporate-api/src/library/labels/assetLabelZpl.ts (AssetLabelConfig).
export type AssetLabelBarcodeType = "CODE128" | "CODE39" | "QR";

export interface AssetLabelConfig {
  widthMm: number;
  heightMm: number;
  barcodeType: AssetLabelBarcodeType;
  showBorder: boolean;
  showProductName: boolean;
  showSerialNumber: boolean;
}
