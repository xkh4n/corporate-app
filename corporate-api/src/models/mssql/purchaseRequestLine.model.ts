import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PurchaseRequestModel } from "./purchaseRequest.model";
import { SupplierModel } from "./supplier.model";

// productId es un ObjectId de Mongo (catalogo de producto/inventario) en
// formato string -referencia cross-engine sin FK real, validada en la capa
// de servicio. No lleva requestNumber duplicado: solo el FK real (requestId)
// -ver memoria convention-erp-english-naming, "sin duplicar el codigo de
// negocio en tablas hijas".
export class PurchaseRequestLineModel extends Model<
  InferAttributes<PurchaseRequestLineModel>,
  InferCreationAttributes<PurchaseRequestLineModel>
> {
  declare id: CreationOptional<number>;
  declare requestId: number;
  declare equipmentType: string | null;
  declare productId: string;
  declare supplierId: number | null;
  declare quantity: number;
  declare status: CreationOptional<string>;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PurchaseRequestLineModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    requestId: { type: DataTypes.INTEGER, allowNull: false, field: "request_id" },
    equipmentType: { type: DataTypes.STRING(100), allowNull: true, field: "equipment_type" },
    productId: { type: DataTypes.STRING(24), allowNull: false, field: "product_id" },
    supplierId: { type: DataTypes.INTEGER, allowNull: true, field: "supplier_id" },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "PENDING" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "purchase_request_lines",
    timestamps: true,
  },
);

PurchaseRequestLineModel.belongsTo(PurchaseRequestModel, { foreignKey: "requestId", as: "request" });
PurchaseRequestModel.hasMany(PurchaseRequestLineModel, { foreignKey: "requestId", as: "lines" });

PurchaseRequestLineModel.belongsTo(SupplierModel, { foreignKey: "supplierId", as: "supplier" });
