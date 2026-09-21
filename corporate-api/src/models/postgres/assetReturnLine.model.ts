import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, NonAttribute } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetModel } from "./asset.model";
import { AssetReturnModel } from "./assetReturn.model";

// Un activo dentro de una devolucion. holderUserId (users, MSSQL, sin FK real) y
// previousStatusCode son la foto al agregarlo: al despacharse el activo pierde
// su tenedor, esta linea es lo que conserva quien lo tenia. active = la linea
// sigue vigente; el indice unico parcial ux_asset_return_lines_active_asset
// impide que un activo este en dos devoluciones vigentes a la vez.
export class AssetReturnLineModel extends Model<
  InferAttributes<AssetReturnLineModel>,
  InferCreationAttributes<AssetReturnLineModel>
> {
  declare id: CreationOptional<number>;
  declare assetReturnId: number;
  declare assetId: number;
  declare holderUserId: number | null;
  declare previousStatusCode: string;
  declare active: boolean;
  declare receivedAt: Date | null;
  declare receivedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare asset?: NonAttribute<AssetModel>;
  declare assetReturn?: NonAttribute<AssetReturnModel>;
}

AssetReturnLineModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    assetReturnId: { type: DataTypes.INTEGER, allowNull: false, field: "asset_return_id" },
    assetId: { type: DataTypes.INTEGER, allowNull: false, field: "asset_id" },
    holderUserId: { type: DataTypes.INTEGER, allowNull: true, field: "holder_user_id" },
    previousStatusCode: { type: DataTypes.STRING(30), allowNull: false, field: "previous_status_code" },
    active: { type: DataTypes.BOOLEAN, allowNull: false },
    receivedAt: { type: DataTypes.DATE, allowNull: true, field: "received_at" },
    receivedBy: { type: DataTypes.INTEGER, allowNull: true, field: "received_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: postgres,
    tableName: "asset_return_lines",
    timestamps: true,
  },
);

AssetReturnLineModel.belongsTo(AssetReturnModel, { foreignKey: "assetReturnId", as: "assetReturn" });
AssetReturnModel.hasMany(AssetReturnLineModel, { foreignKey: "assetReturnId", as: "lines" });

AssetReturnLineModel.belongsTo(AssetModel, { foreignKey: "assetId", as: "asset" });
AssetModel.hasMany(AssetReturnLineModel, { foreignKey: "assetId", as: "returnLines" });
