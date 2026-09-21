import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { QuoteModel } from "./quote.model";
import { SupplierModel } from "./supplier.model";
import { PurchaseRequestModel } from "./purchaseRequest.model";
import { PurchaseOrderQuoteModel } from "./purchaseOrderQuote.model";

export class PurchaseOrderModel extends Model<
  InferAttributes<PurchaseOrderModel>,
  InferCreationAttributes<PurchaseOrderModel>
> {
  declare id: CreationOptional<number>;
  declare orderNumber: string;
  declare requestId: number;
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
    requestId: { type: DataTypes.INTEGER, allowNull: false, field: "request_id" },
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

PurchaseOrderModel.belongsTo(PurchaseRequestModel, { foreignKey: "requestId", as: "request" });
PurchaseRequestModel.hasMany(PurchaseOrderModel, { foreignKey: "requestId", as: "purchaseOrders" });

// through: el MODELO, no el string "purchase_order_quotes" -con el string
// Sequelize se define un modelo propio con columnas camelCase
// (purchaseOrderId/quoteId), que no son las reales (este proyecto no usa
// underscored:true). unique:false para que Sequelize no agregue ademas un
// indice compuesto propio sobre el through -el UNIQUE real (solo sobre
// quote_id) ya vive en la tabla, ver migrate.ts.
PurchaseOrderModel.belongsToMany(QuoteModel, {
  through: { model: PurchaseOrderQuoteModel, unique: false },
  foreignKey: "purchaseOrderId",
  otherKey: "quoteId",
  as: "quotes",
});
QuoteModel.belongsToMany(PurchaseOrderModel, {
  through: { model: PurchaseOrderQuoteModel, unique: false },
  foreignKey: "quoteId",
  otherKey: "purchaseOrderId",
  as: "purchaseOrders",
});

PurchaseOrderModel.belongsTo(SupplierModel, { foreignKey: "supplierId", as: "supplier" });
