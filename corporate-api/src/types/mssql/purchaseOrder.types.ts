export interface PurchaseOrderAttributes {
  id: number;
  orderNumber: string;
  requestId: number;
  issuedAt: Date;
  paymentTerms: string | null;
  supplierId: number;
  sentAt: Date | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// Input del SERVICIO, no atributos de creacion de Sequelize: quoteIds no es
// una columna de purchase_orders -las cotizaciones cubiertas se enganchan
// aparte, en purchase_order_quotes-. orderNumber, requestId y supplierId
// tampoco son input del cliente: se derivan de las cotizaciones indicadas
// (todas deben compartir requestId y supplierId, ver createPurchaseOrder).
// paymentTerms, si no se entrega, se completa desde Supplier.paymentTermDays.
export interface CreatePurchaseOrderInput {
  quoteIds: number[];
  paymentTerms?: string | null;
  createdBy?: number | null;
}
