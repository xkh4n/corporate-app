import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PurchaseRequestLineModel } from "./purchaseRequestLine.model";
import { QuoteModel } from "./quote.model";
import { SupplierModel } from "./supplier.model";
import { UserModel } from "./user.model";

// Por linea (requestLineId), no por PurchaseRequest completa: permite
// aprobacion parcial (ej. autorizar 3 de 5 unidades pedidas). quoteId
// identifica cual cotizacion especifica (entre varias competidoras para la
// misma linea) fue la aprobada. Ver memoria
// project-erp-scope-and-data-classification.
export class AuthorizationModel extends Model<
  InferAttributes<AuthorizationModel>,
  InferCreationAttributes<AuthorizationModel>
> {
  declare id: CreationOptional<number>;
  declare requestLineId: number;
  declare quoteId: number;
  declare approvedAt: Date | null;
  declare approverId: number;
  declare approvedQuantity: number;
  declare productId: string;
  declare supplierId: number;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

AuthorizationModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    requestLineId: { type: DataTypes.INTEGER, allowNull: false, field: "request_line_id" },
    quoteId: { type: DataTypes.INTEGER, allowNull: false, field: "quote_id" },
    approvedAt: { type: DataTypes.DATE, allowNull: true, field: "approved_at" },
    approverId: { type: DataTypes.INTEGER, allowNull: false, field: "approver_id" },
    approvedQuantity: { type: DataTypes.INTEGER, allowNull: false, field: "approved_quantity" },
    productId: { type: DataTypes.STRING(24), allowNull: false, field: "product_id" },
    supplierId: { type: DataTypes.INTEGER, allowNull: false, field: "supplier_id" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "authorizations",
    timestamps: true,
  },
);

AuthorizationModel.belongsTo(PurchaseRequestLineModel, { foreignKey: "requestLineId", as: "requestLine" });
PurchaseRequestLineModel.hasMany(AuthorizationModel, { foreignKey: "requestLineId", as: "authorizations" });

AuthorizationModel.belongsTo(QuoteModel, { foreignKey: "quoteId", as: "quote" });
AuthorizationModel.belongsTo(SupplierModel, { foreignKey: "supplierId", as: "supplier" });
AuthorizationModel.belongsTo(UserModel, { foreignKey: "approverId", as: "approver" });
