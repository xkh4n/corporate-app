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

// quoteId/requestId/productId/supplierId/purchaseValue NO son input del
// cliente: se copian desde la PurchaseOrder -> Quote referenciada (mismo
// criterio que Authorization/PurchaseOrder, ver
// services/mssql/goodsReceipt.service.ts). documentNumber SI es input: es el
// numero del documento tributario real del proveedor (guia/boleta/factura),
// no un numero interno generado por esta app.
export interface GoodsReceiptCreationInput {
  documentType: GoodsReceiptDocumentType;
  documentNumber: string;
  purchaseOrderId: number;
  receivedQuantity: number;
  serialNumber?: string | null;
  warrantyExpiresAt?: string | null;
  createdBy?: number | null;
}
