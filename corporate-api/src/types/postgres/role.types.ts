export interface RoleAttributes {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type RoleCreationAttributes = Pick<RoleAttributes, "name"> &
  Partial<Pick<RoleAttributes, "description" | "isActive">>;

export type RoleUpdateAttributes = Partial<
  Pick<RoleAttributes, "name" | "description" | "isActive">
>;
