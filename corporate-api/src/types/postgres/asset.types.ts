import type { ProductType } from "../mongo/product.types";

export interface AssetAttributes {
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
  createdAt: Date;
  updatedAt: Date;
}

// tag no es input del cliente: lo genera createAssetsFromReceipt en base al
// productType del producto recibido (ARR/SRV/ACT). costCenterId se copia del
// PurchaseRequest original (via GoodsReceipt.requestId, resuelto en
// goodsReceipt.service.ts) -tampoco es input del cliente. Ver
// services/postgres/asset.service.ts.
//
// quantity: un Asset POR UNIDAD recibida (decision de producto B del plan),
// no un Asset con un campo cantidad -asi cada unidad se puede asignar a un
// empleado distinto (Fase E). serialNumbers, si viene, tiene que tener
// exactamente "quantity" elementos (uno por unidad, null donde no se
// registro numero de serie) -validado en goodsReceipt.controller.ts, no aca.
// finalStatusCode: si viene (ej. "AVAILABLE"), cada asset nace en RECEIVED y
// se transiciona en la misma transaccion -ver comentario en
// createAssetsFromReceipt.
export interface CreateAssetsFromReceiptInput {
  goodsReceiptId: number;
  productId: string;
  quantity: number;
  costCenterId?: number | null;
  serialNumbers?: (string | null)[];
  warrantyExpiresAt?: string | null;
  value?: string | null;
  receivedAt?: string | null;
  finalStatusCode?: string;
  createdBy?: number | null;
}

// Alta de un activo desde una toma de inventario (createAssetFromInventory): no
// hay recepcion ni valor conocido, asi que no lleva goodsReceiptId ni asiento
// de Kardex. productType lo resuelve quien llama (ya leyo el producto para
// validarlo) y define el prefijo del tag (ARR/SRV/ACT).
export interface CreateAssetFromInventoryInput {
  productId: string;
  productType: ProductType;
  costCenterId: number;
  serialNumber: string;
  // Solo la carga masiva por CSV la informa; la toma de inventario no la conoce.
  warrantyExpiresAt?: string | null;
  createdBy?: number | null;
}

export type AssetUpdateAttributes = Partial<
  Pick<AssetAttributes, "serialNumber" | "warrantyExpiresAt" | "value" | "updatedBy">
>;
