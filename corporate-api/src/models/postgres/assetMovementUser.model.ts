import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetMovementModel } from "./assetMovement.model";

// Tabla intermedia N:M: un movimiento puede involucrar 1 o mas usuarios
// (razon explicita del usuario para sacar Asignacion de MSSQL). userId es
// una referencia cross-engine hacia users (MSSQL) sin FK real, validada a
// mano en la capa de servicio.
export class AssetMovementUserModel extends Model<
  InferAttributes<AssetMovementUserModel>,
  InferCreationAttributes<AssetMovementUserModel>
> {
  declare id: CreationOptional<number>;
  declare assetMovementId: number;
  declare userId: number;
}

AssetMovementUserModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    assetMovementId: { type: DataTypes.INTEGER, allowNull: false, field: "asset_movement_id" },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: "user_id" },
  },
  {
    sequelize: postgres,
    tableName: "asset_movement_users",
    timestamps: false,
  },
);

AssetMovementUserModel.belongsTo(AssetMovementModel, { foreignKey: "assetMovementId", as: "movement" });
AssetMovementModel.hasMany(AssetMovementUserModel, { foreignKey: "assetMovementId", as: "movementUsers" });
