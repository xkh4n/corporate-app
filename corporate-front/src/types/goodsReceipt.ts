// Espejo de corporate-api/src/models/postgres/goodsReceipt.model.ts (GoodsReceiptAttributes).
export type GoodsReceiptDocumentType = "GUIA_DESPACHO" | "BOLETA" | "FACTURA";

// quoteId/requestId/productId/supplierId/purchaseValue se copian del lado del servidor
// desde la cadena PurchaseOrder->Quote, no son input del cliente. purchaseValue es decimal, viaja como string.
export interface GoodsReceipt {
  id: number;
  documentType: GoodsReceiptDocumentType;
  documentNumber: string;
  purchaseOrderId: number;
  quoteId: number;
  requestId: number;
  productId: string;
  supplierId: number;
  purchaseValue: string;
  receivedQuantity: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

// serialNumbers: uno por unidad recibida (decision B, un Asset por unidad) -si
// viene, tiene que tener exactamente receivedQuantity elementos.
export interface GoodsReceiptCreateInput {
  documentType: GoodsReceiptDocumentType;
  documentNumber: string;
  purchaseOrderId: number;
  receivedQuantity: number;
  serialNumbers?: (string | null)[];
  warrantyExpiresAt?: string;
}
