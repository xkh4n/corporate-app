import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { postgres } from "../../databases/postgres/connection";

// Referenciada desde MSSQL (employees.costCenterId, purchaseRequests.costCenterId)
// como cross-engine sin FK real -mismo patron y direccion que ya existe
// entre users.roleId y roles-. createdBy/updatedBy tambien son cross-engine
// hacia users (MSSQL).
export class CostCenterModel extends Model<
  InferAttributes<CostCenterModel>,
  InferCreationAttributes<CostCenterModel>
> {
  declare id: CreationOptional<number>;
  declare code: number;
  declare name: string;
  declare description: string | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CostCenterModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    code: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: postgres,
    tableName: "cost_centers",
    timestamps: true,
  },
);
