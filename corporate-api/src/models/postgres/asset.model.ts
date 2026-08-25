import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, NonAttribute } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetStatusModel } from "./assetStatus.model";
import { CostCenterModel } from "./costCenter.model";

// Maestro de activos: el estado actual vive aca (statusId), no se recalcula
// buscando el ultimo AssetMovement. goodsReceiptId es una referencia
// cross-engine hacia goods_receipts (MSSQL) sin FK real -se crea este
// registro cuando se confirma la recepcion correspondiente, ver
// goodsReceipt.model.ts-.
export class AssetModel extends Model<InferAttributes<AssetModel>, InferCreationAttributes<AssetModel>> {
  declare id: CreationOptional<number>;
  declare tag: string;
  declare statusId: number;
  declare serialNumber: string | null;
  declare warrantyExpiresAt: string | null;
  declare value: string | null;
  declare receivedAt: string | null;
  declare goodsReceiptId: number | null;
  declare costCenterId: number | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  // NonAttribute: solo esta poblado cuando el query pide explicitamente
  // include:[{model: AssetStatusModel, as:"status"}] (ver asset.service.ts)
  // -no es una columna propia de "assets".
  declare status?: NonAttribute<AssetStatusModel>;
}

AssetModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tag: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    statusId: { type: DataTypes.INTEGER, allowNull: false, field: "status_id" },
    serialNumber: { type: DataTypes.STRING(100), allowNull: true, field: "serial_number" },
    warrantyExpiresAt: { type: DataTypes.DATEONLY, allowNull: true, field: "warranty_expires_at" },
    value: { type: DataTypes.DECIMAL(18, 2), allowNull: true },
    receivedAt: { type: DataTypes.DATEONLY, allowNull: true, field: "received_at" },
    goodsReceiptId: { type: DataTypes.INTEGER, allowNull: true, field: "goods_receipt_id" },
    costCenterId: { type: DataTypes.INTEGER, allowNull: true, field: "cost_center_id" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: postgres,
    tableName: "assets",
    timestamps: true,
  },
);

AssetModel.belongsTo(AssetStatusModel, { foreignKey: "statusId", as: "status" });
AssetStatusModel.hasMany(AssetModel, { foreignKey: "statusId", as: "assets" });

AssetModel.belongsTo(CostCenterModel, { foreignKey: "costCenterId", as: "costCenter" });
CostCenterModel.hasMany(AssetModel, { foreignKey: "costCenterId", as: "assets" });
