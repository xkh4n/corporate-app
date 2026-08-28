import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PurchaseRequestModel } from "./purchaseRequest.model";
import { SupplierModel } from "./supplier.model";

export type QuoteStatus = "PENDING" | "SELECTED" | "REJECTED";

export class QuoteModel extends Model<InferAttributes<QuoteModel>, InferCreationAttributes<QuoteModel>> {
  declare id: CreationOptional<number>;
  declare quoteNumber: string;
  declare requestId: number;
  declare productId: string;
  declare supplierId: number;
  declare purchaseValue: string;
  declare purchaseUnit: string | null;
  declare storageUnit: string | null;
  declare productCode: string | null;
  declare model: string | null;
  declare status: CreationOptional<QuoteStatus>;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

QuoteModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    quoteNumber: { type: DataTypes.STRING(20), allowNull: false, unique: true, field: "quote_number" },
    requestId: { type: DataTypes.INTEGER, allowNull: false, field: "request_id" },
    productId: { type: DataTypes.STRING(24), allowNull: false, field: "product_id" },
    supplierId: { type: DataTypes.INTEGER, allowNull: false, field: "supplier_id" },
    purchaseValue: { type: DataTypes.DECIMAL(18, 2), allowNull: false, field: "purchase_value" },
    purchaseUnit: { type: DataTypes.STRING(20), allowNull: true, field: "purchase_unit" },
    storageUnit: { type: DataTypes.STRING(20), allowNull: true, field: "storage_unit" },
    productCode: { type: DataTypes.STRING(50), allowNull: true, field: "product_code" },
    model: { type: DataTypes.STRING(100), allowNull: true },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "PENDING" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "quotes",
    timestamps: true,
  },
);

QuoteModel.belongsTo(PurchaseRequestModel, { foreignKey: "requestId", as: "request" });
PurchaseRequestModel.hasMany(QuoteModel, { foreignKey: "requestId", as: "quotes" });

QuoteModel.belongsTo(SupplierModel, { foreignKey: "supplierId", as: "supplier" });
