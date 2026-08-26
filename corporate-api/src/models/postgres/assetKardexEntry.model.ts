import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetModel } from "./asset.model";

export type AssetKardexEntryType = "ACQUISITION" | "ADJUSTMENT" | "WRITE_OFF";

// Libro contable de valorizacion de activos: INSERT-ONLY, un renglon por
// movimiento -nunca se actualiza ni se borra un renglon existente (ver
// comentario largo en migrate.ts, migrateAssetKardex). Un error se corrige
// con un asiento ADJUSTMENT que lo compense. "balance" es el saldo del
// activo DESPUES de este asiento -se calcula una sola vez al insertar (ver
// assetKardex.service.ts, getNextBalance), nunca se recalcula leyendo el
// historial completo.
export class AssetKardexEntryModel extends Model<
  InferAttributes<AssetKardexEntryModel>,
  InferCreationAttributes<AssetKardexEntryModel>
> {
  declare id: CreationOptional<number>;
  declare assetId: number;
  // ObjectId de Mongo (coleccion products) en formato string -cross-engine,
  // sin FK real, duplicado desde Asset.productId al insertar para poder
  // agregar "por producto" con un GROUP BY sobre esta misma tabla.
  declare productId: string | null;
  declare entryType: AssetKardexEntryType;
  declare entryDate: CreationOptional<Date>;
  declare unitCost: string;
  declare amount: string;
  declare balance: string;
  declare reference: string | null;
  declare notes: string | null;
  declare createdBy: number | null;
  declare createdAt: CreationOptional<Date>;
}

AssetKardexEntryModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    assetId: { type: DataTypes.INTEGER, allowNull: false, field: "asset_id" },
    productId: { type: DataTypes.STRING(24), allowNull: true, field: "product_id" },
    entryType: { type: DataTypes.STRING(20), allowNull: false, field: "entry_type" },
    entryDate: { type: DataTypes.DATE, allowNull: false, field: "entry_date" },
    unitCost: { type: DataTypes.DECIMAL(18, 2), allowNull: false, field: "unit_cost" },
    amount: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
    balance: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
    reference: { type: DataTypes.STRING(50), allowNull: true },
    notes: { type: DataTypes.STRING(255), allowNull: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
  },
  {
    sequelize: postgres,
    tableName: "asset_kardex_entries",
    timestamps: true,
    updatedAt: false,
  },
);

AssetKardexEntryModel.belongsTo(AssetModel, { foreignKey: "assetId", as: "asset" });
AssetModel.hasMany(AssetKardexEntryModel, { foreignKey: "assetId", as: "kardexEntries" });
