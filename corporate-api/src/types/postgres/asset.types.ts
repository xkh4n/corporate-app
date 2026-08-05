export interface AssetAttributes {
  id: number;
  tag: string;
  statusId: number;
  serialNumber: string | null;
  warrantyExpiresAt: string | null;
  value: string | null;
  receivedAt: string | null;
  goodsReceiptId: number | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// tag no es input del cliente: lo genera createAssetFromReceipt en base al
// productType del producto recibido (ARR/SRV/ACT). statusId nace en
// RECEIVED. Ver services/postgres/asset.service.ts.
export interface CreateAssetFromReceiptInput {
  goodsReceiptId: number;
  productId: string;
  serialNumber?: string | null;
  warrantyExpiresAt?: string | null;
  value?: string | null;
  receivedAt?: string | null;
  createdBy?: number | null;
}

export type AssetUpdateAttributes = Partial<
  Pick<AssetAttributes, "serialNumber" | "warrantyExpiresAt" | "value" | "updatedBy">
>;
