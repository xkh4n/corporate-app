import type { QuoteStatus } from "../../models/mssql/quote.model";

export interface QuoteAttributes {
  id: number;
  quoteNumber: string;
  requestId: number;
  productId: string;
  supplierId: number;
  purchaseValue: string;
  purchaseUnit: string | null;
  storageUnit: string | null;
  productCode: string | null;
  model: string | null;
  status: QuoteStatus;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// quoteNumber se genera en el service (COT000000001...); status nace en
// PENDING y solo cambia a SELECTED cuando se crea una Authorization sobre
// esta cotizacion (ver services/mssql/authorization.service.ts).
export type QuoteCreationAttributes = Pick<
  QuoteAttributes,
  "requestId" | "productId" | "supplierId" | "purchaseValue"
> &
  Partial<Pick<QuoteAttributes, "purchaseUnit" | "storageUnit" | "productCode" | "model" | "createdBy" | "updatedBy">>;
