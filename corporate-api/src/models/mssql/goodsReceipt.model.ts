import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PurchaseOrderModel } from "./purchaseOrder.model";
import { QuoteModel } from "./quote.model";
import { PurchaseRequestModel } from "./purchaseRequest.model";
import { SupplierModel } from "./supplier.model";

export type GoodsReceiptDocumentType = "GUIA_DESPACHO" | "BOLETA" | "FACTURA";

// Al confirmarse un GoodsReceipt se crea el registro correspondiente en
// "assets" (Postgres) -escritura cross-engine real, no atomica: ver memoria
// project-erp-scope-and-data-classification para el manejo de reintento/
// reconciliacion que debe vivir en la capa de servicio, no aqui.
export class GoodsReceiptModel extends Model<
  InferAttributes<GoodsReceiptModel>,
  InferCreationAttributes<GoodsReceiptModel>
> {
  declare id: CreationOptional<number>;
  declare documentType: GoodsReceiptDocumentType;
  declare documentNumber: string;
  declare purchaseOrderId: number;
  declare quoteId: number;
  declare requestId: number;
  declare productId: string;
  declare supplierId: number;
  declare purchaseValue: string;
  declare receivedQuantity: number;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

GoodsReceiptModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    documentType: { type: DataTypes.STRING(30), allowNull: false, field: "document_type" },
    documentNumber: { type: DataTypes.STRING(50), allowNull: false, field: "document_number" },
    purchaseOrderId: { type: DataTypes.INTEGER, allowNull: false, field: "purchase_order_id" },
    quoteId: { type: DataTypes.INTEGER, allowNull: false, field: "quote_id" },
    requestId: { type: DataTypes.INTEGER, allowNull: false, field: "request_id" },
    productId: { type: DataTypes.STRING(24), allowNull: false, field: "product_id" },
    supplierId: { type: DataTypes.INTEGER, allowNull: false, field: "supplier_id" },
    purchaseValue: { type: DataTypes.DECIMAL(18, 2), allowNull: false, field: "purchase_value" },
    receivedQuantity: { type: DataTypes.INTEGER, allowNull: false, field: "received_quantity" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "goods_receipts",
    timestamps: true,
  },
);

GoodsReceiptModel.belongsTo(PurchaseOrderModel, { foreignKey: "purchaseOrderId", as: "purchaseOrder" });
PurchaseOrderModel.hasMany(GoodsReceiptModel, { foreignKey: "purchaseOrderId", as: "goodsReceipts" });

GoodsReceiptModel.belongsTo(QuoteModel, { foreignKey: "quoteId", as: "quote" });
GoodsReceiptModel.belongsTo(PurchaseRequestModel, { foreignKey: "requestId", as: "request" });
GoodsReceiptModel.belongsTo(SupplierModel, { foreignKey: "supplierId", as: "supplier" });
