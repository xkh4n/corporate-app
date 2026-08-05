export interface AssetStatusAttributes {
  id: number;
  code: string;
  name: string;
  description: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AssetStatusCreationAttributes = Pick<AssetStatusAttributes, "code" | "name"> &
  Partial<Pick<AssetStatusAttributes, "description" | "createdBy" | "updatedBy">>;

export type AssetStatusUpdateAttributes = Partial<
  Pick<AssetStatusAttributes, "name" | "description" | "updatedBy">
>;
