import type { GoodsReceiptDocumentType } from "../../models/mssql/goodsReceipt.model";

export interface GoodsReceiptAttributes {
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
  createdAt: Date;
  updatedAt: Date;
}

// requestId/productId/supplierId/purchaseValue NO son input del cliente: se
// copian de la Quote indicada. quoteId SI pasa a ser input: una OC ahora
// cubre varias cotizaciones, asi que la orden por si sola ya no determina
// contra QUE producto se esta recepcionando -el servidor valida que esa
// cotizacion pertenezca a esa orden (purchase_order_quotes, ver
// services/mssql/goodsReceipt.service.ts). documentNumber SI es input: es el
// numero del documento tributario real del proveedor (guia/boleta/factura),
// no un numero interno generado por esta app.
//
// serialNumbers: uno por unidad recibida -si viene, DEBE tener exactamente
// receivedQuantity elementos (validado en goodsReceipt.controller.ts, no
// aca) -manifestacion directa de la decision B (un Asset por unidad, ver
// services/postgres/asset.service.ts).
export interface GoodsReceiptCreationInput {
  documentType: GoodsReceiptDocumentType;
  documentNumber: string;
  purchaseOrderId: number;
  quoteId: number;
  receivedQuantity: number;
  serialNumbers?: (string | null)[];
  warrantyExpiresAt?: string | null;
  createdBy?: number | null;
}
