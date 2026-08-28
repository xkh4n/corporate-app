export interface AuthorizationAttributes {
  id: number;
  requestLineId: number;
  quoteId: number;
  approvedAt: Date | null;
  approverId: number;
  approvedQuantity: number;
  productId: string;
  supplierId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// productId/supplierId NO se aceptan como input: el service los copia desde
// la Quote referenciada, para que nunca puedan quedar inconsistentes con lo
// que esa cotizacion realmente dice. approvedAt tampoco: se fija a "ahora"
// al crear.
export type AuthorizationCreationAttributes = Pick<
  AuthorizationAttributes,
  "requestLineId" | "quoteId" | "approverId" | "approvedQuantity"
>;
