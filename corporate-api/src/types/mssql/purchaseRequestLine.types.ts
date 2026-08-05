export interface PurchaseRequestLineAttributes {
  id: number;
  requestId: number;
  equipmentType: string | null;
  productId: string;
  supplierId: number | null;
  quantity: number;
  status: string;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PurchaseRequestLineCreationAttributes = Pick<
  PurchaseRequestLineAttributes,
  "requestId" | "productId" | "quantity"
> &
  Partial<Pick<PurchaseRequestLineAttributes, "equipmentType" | "supplierId" | "createdBy" | "updatedBy">>;

export type PurchaseRequestLineUpdateAttributes = Partial<
  Pick<PurchaseRequestLineAttributes, "equipmentType" | "supplierId" | "quantity" | "status">
>;
