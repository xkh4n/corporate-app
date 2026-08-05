import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetModel } from "./asset.model";

export type AssetMovementType = "ASSIGNED" | "REASSIGNED" | "SUPPORT" | "DECOMMISSIONED";

export class AssetMovementModel extends Model<
  InferAttributes<AssetMovementModel>,
  InferCreationAttributes<AssetMovementModel>
> {
  declare id: CreationOptional<number>;
  declare assetId: number;
  declare movementType: AssetMovementType;
  declare movementDate: CreationOptional<Date>;
  declare notes: string | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

AssetMovementModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    assetId: { type: DataTypes.INTEGER, allowNull: false, field: "asset_id" },
    movementType: { type: DataTypes.STRING(20), allowNull: false, field: "movement_type" },
    movementDate: { type: DataTypes.DATE, allowNull: false, field: "movement_date" },
    notes: { type: DataTypes.STRING(255), allowNull: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: postgres,
    tableName: "asset_movements",
    timestamps: true,
  },
);

AssetMovementModel.belongsTo(AssetModel, { foreignKey: "assetId", as: "asset" });
AssetModel.hasMany(AssetMovementModel, { foreignKey: "assetId", as: "movements" });
