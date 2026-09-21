import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, NonAttribute } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetModel } from "./asset.model";
import { InventoryCountModel } from "./inventoryCount.model";

// Activos del sistema que NO aparecieron en la toma. Se escribe una sola vez,
// al cerrar (closeInventoryCount), para que el reporte de una toma cerrada no
// cambie cuando el estado real de los activos cambie despues.
export class InventoryCountMissingAssetModel extends Model<
  InferAttributes<InventoryCountMissingAssetModel>,
  InferCreationAttributes<InventoryCountMissingAssetModel>
> {
  declare id: CreationOptional<number>;
  declare inventoryCountId: number;
  declare assetId: number;
  declare systemStatusCode: string;
  declare systemHolderUserId: number | null;
  declare asset?: NonAttribute<AssetModel>;
}

InventoryCountMissingAssetModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    inventoryCountId: { type: DataTypes.INTEGER, allowNull: false, field: "inventory_count_id" },
    assetId: { type: DataTypes.INTEGER, allowNull: false, field: "asset_id" },
    systemStatusCode: { type: DataTypes.STRING(30), allowNull: false, field: "system_status_code" },
    systemHolderUserId: { type: DataTypes.INTEGER, allowNull: true, field: "system_holder_user_id" },
  },
  {
    sequelize: postgres,
    tableName: "inventory_count_missing_assets",
    timestamps: false,
  },
);

InventoryCountMissingAssetModel.belongsTo(InventoryCountModel, {
  foreignKey: "inventoryCountId",
  as: "inventoryCount",
});
InventoryCountModel.hasMany(InventoryCountMissingAssetModel, { foreignKey: "inventoryCountId", as: "missingAssets" });

InventoryCountMissingAssetModel.belongsTo(AssetModel, { foreignKey: "assetId", as: "asset" });
