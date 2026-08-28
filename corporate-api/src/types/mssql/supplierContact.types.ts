export interface SupplierContactAttributes {
  id: number;
  supplierId: number;
  name: string;
  email: string;
  phone: string | null;
  position: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SupplierContactCreationAttributes = Pick<SupplierContactAttributes, "supplierId" | "name" | "email"> &
  Partial<Pick<SupplierContactAttributes, "phone" | "position" | "createdBy">>;

export type SupplierContactUpdateAttributes = Partial<
  Pick<SupplierContactAttributes, "name" | "email" | "phone" | "position" | "updatedBy">
>;
