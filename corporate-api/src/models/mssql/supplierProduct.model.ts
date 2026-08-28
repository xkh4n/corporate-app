import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { SupplierModel } from "./supplier.model";

// Vinculo M:N entre Supplier (MSSQL) y Product (Mongo): productId es un
// ObjectId de Mongo en formato string -sin FK real, validado en la capa de
// servicio, mismo criterio que PurchaseRequestLine.productId. Vive en MSSQL
// (no en Mongo) porque supplierId SI tiene FK real hacia suppliers en este
// motor -mantener la integridad relacional del lado que puede tenerla de
// verdad, en vez de perderla poniendo la tabla del otro lado.
export class SupplierProductModel extends Model<
  InferAttributes<SupplierProductModel>,
  InferCreationAttributes<SupplierProductModel>
> {
  declare id: CreationOptional<number>;
  declare supplierId: number;
  declare productId: string;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SupplierProductModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    supplierId: { type: DataTypes.INTEGER, allowNull: false, field: "supplier_id" },
    productId: { type: DataTypes.STRING(24), allowNull: false, field: "product_id" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "supplier_products",
    timestamps: true,
  },
);

SupplierProductModel.belongsTo(SupplierModel, { foreignKey: "supplierId", as: "supplier" });
SupplierModel.hasMany(SupplierProductModel, { foreignKey: "supplierId", as: "supplierProducts" });
