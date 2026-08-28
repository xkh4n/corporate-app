import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { postgres } from "../../databases/postgres/connection";

export type PermissionAction = "create" | "read" | "update" | "delete" | "approve";

// Catalogo fijo (resource+action), sembrado en databases/permission-catalog.ts
// -no se crea via API, solo se asigna/desasigna a roles (ver RolePermissionModel).
export class PermissionModel extends Model<
  InferAttributes<PermissionModel>,
  InferCreationAttributes<PermissionModel>
> {
  declare id: CreationOptional<number>;
  declare resource: string;
  declare action: PermissionAction;
  declare description: string | null;
  declare createdAt: CreationOptional<Date>;
}

PermissionModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    resource: { type: DataTypes.STRING(50), allowNull: false },
    action: { type: DataTypes.STRING(20), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
  },
  {
    sequelize: postgres,
    tableName: "permissions",
    timestamps: false,
  },
);
