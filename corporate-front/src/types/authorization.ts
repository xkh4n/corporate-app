// Espejo de corporate-api/src/models/postgres/authorization.model.ts (AuthorizationAttributes).
// productId/supplierId se copian del lado del servidor desde el Quote referenciado, no son input del cliente.
export interface Authorization {
  id: number;
  requestLineId: number;
  quoteId: number;
  approvedAt: string | null;
  approverId: number;
  approvedQuantity: number;
  productId: string;
  supplierId: number;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

// approverId es siempre el usuario autenticado, resuelto del lado del servidor.
export interface AuthorizationCreateInput {
  requestLineId: number;
  quoteId: number;
  approvedQuantity: number;
}
