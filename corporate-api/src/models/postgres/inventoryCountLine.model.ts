import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, NonAttribute } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetModel } from "./asset.model";
import { CostCenterModel } from "./costCenter.model";
import { InventoryCountModel } from "./inventoryCount.model";

// Estados que el auditor puede declarar. DAMAGED existe en asset_statuses
// (sembrado en migrate.ts) pero no tiene movimiento propio en
// AssetMovementType: se asigna con setAssetStatus.
export type InventoryLineStatusCode = "ASSIGNED" | "SUPPORT" | "AVAILABLE" | "DAMAGED" | "DECOMMISSIONED";

// Un equipo levantado en una toma. asset_id siempre esta presente: o se
// vinculo un activo existente (asset_created = false, con snapshot del
// sistema para comparar) o se creo uno nuevo en la misma transaccion
// (asset_created = true, sin comparacion). holderUserId, productCategoryId y
// productId son referencias cross-engine (MSSQL / Mongo) sin FK real.
export class InventoryCountLineModel extends Model<
  InferAttributes<InventoryCountLineModel>,
  InferCreationAttributes<InventoryCountLineModel>
> {
  declare id: CreationOptional<number>;
  declare inventoryCountId: number;
  declare assetId: number;
  declare assetCreated: boolean;
  declare productCategoryId: string;
  declare productId: string;
  declare description: string | null;
  declare costCenterId: number;
  declare serialNumber: string | null;
  declare holderUserId: number | null;
  declare statusCode: InventoryLineStatusCode;
  // Snapshot de lo que el sistema tenia al capturar (null si el activo lo creo la toma).
  declare systemStatusCode: string | null;
  declare systemHolderUserId: number | null;
  declare systemCostCenterId: number | null;
  // Estado con el que quedo el activo tras la toma; assetModified = la toma
  // cambio algo del activo (una linea modificada o creada ya no se puede quitar).
  declare resultingStatusCode: string | null;
  declare assetModified: boolean;
  declare createdBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare asset?: NonAttribute<AssetModel>;
  declare costCenter?: NonAttribute<CostCenterModel>;
}

InventoryCountLineModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    inventoryCountId: { type: DataTypes.INTEGER, allowNull: false, field: "inventory_count_id" },
    assetId: { type: DataTypes.INTEGER, allowNull: false, field: "asset_id" },
    assetCreated: { type: DataTypes.BOOLEAN, allowNull: false, field: "asset_created" },
    productCategoryId: { type: DataTypes.STRING(24), allowNull: false, field: "product_category_id" },
    productId: { type: DataTypes.STRING(24), allowNull: false, field: "product_id" },
    description: { type: DataTypes.STRING(255), allowNull: true },
    costCenterId: { type: DataTypes.INTEGER, allowNull: false, field: "cost_center_id" },
    serialNumber: { type: DataTypes.STRING(100), allowNull: true, field: "serial_number" },
    holderUserId: { type: DataTypes.INTEGER, allowNull: true, field: "holder_user_id" },
    statusCode: { type: DataTypes.STRING(20), allowNull: false, field: "status_code" },
    systemStatusCode: { type: DataTypes.STRING(30), allowNull: true, field: "system_status_code" },
    systemHolderUserId: { type: DataTypes.INTEGER, allowNull: true, field: "system_holder_user_id" },
    systemCostCenterId: { type: DataTypes.INTEGER, allowNull: true, field: "system_cost_center_id" },
    resultingStatusCode: { type: DataTypes.STRING(30), allowNull: true, field: "resulting_status_code" },
    assetModified: { type: DataTypes.BOOLEAN, allowNull: false, field: "asset_modified" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: postgres,
    tableName: "inventory_count_lines",
    timestamps: true,
  },
);

InventoryCountLineModel.belongsTo(InventoryCountModel, { foreignKey: "inventoryCountId", as: "inventoryCount" });
InventoryCountModel.hasMany(InventoryCountLineModel, { foreignKey: "inventoryCountId", as: "lines" });

InventoryCountLineModel.belongsTo(AssetModel, { foreignKey: "assetId", as: "asset" });
AssetModel.hasMany(InventoryCountLineModel, { foreignKey: "assetId", as: "inventoryLines" });

InventoryCountLineModel.belongsTo(CostCenterModel, { foreignKey: "costCenterId", as: "costCenter" });
