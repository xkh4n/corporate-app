import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { QuoteModel } from "./quote.model";
import { SupplierModel } from "./supplier.model";

export class PurchaseOrderModel extends Model<
  InferAttributes<PurchaseOrderModel>,
  InferCreationAttributes<PurchaseOrderModel>
> {
  declare id: CreationOptional<number>;
  declare orderNumber: string;
  declare quoteId: number;
  declare issuedAt: CreationOptional<Date>;
  declare paymentTerms: string | null;
  declare supplierId: number;
  declare sentAt: Date | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PurchaseOrderModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    orderNumber: { type: DataTypes.STRING(20), allowNull: false, unique: true, field: "order_number" },
    quoteId: { type: DataTypes.INTEGER, allowNull: false, field: "quote_id" },
    issuedAt: { type: DataTypes.DATE, allowNull: false, field: "issued_at" },
    paymentTerms: { type: DataTypes.STRING(50), allowNull: true, field: "payment_terms" },
    supplierId: { type: DataTypes.INTEGER, allowNull: false, field: "supplier_id" },
    sentAt: { type: DataTypes.DATE, allowNull: true, field: "sent_at" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "purchase_orders",
    timestamps: true,
  },
);

PurchaseOrderModel.belongsTo(QuoteModel, { foreignKey: "quoteId", as: "quote" });
QuoteModel.hasOne(PurchaseOrderModel, { foreignKey: "quoteId", as: "purchaseOrder" });

PurchaseOrderModel.belongsTo(SupplierModel, { foreignKey: "supplierId", as: "supplier" });
