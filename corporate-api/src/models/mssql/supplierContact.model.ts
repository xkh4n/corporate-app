import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { SupplierModel } from "./supplier.model";

// Un proveedor puede tener varios contactos (comercial, facturacion, etc.).
// Vive en MSSQL, mismo motor que Supplier -FK real, no cross-engine.
export class SupplierContactModel extends Model<
  InferAttributes<SupplierContactModel>,
  InferCreationAttributes<SupplierContactModel>
> {
  declare id: CreationOptional<number>;
  declare supplierId: number;
  declare name: string;
  declare email: string;
  declare phone: string | null;
  declare position: string | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SupplierContactModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    supplierId: { type: DataTypes.INTEGER, allowNull: false, field: "supplier_id" },
    name: { type: DataTypes.STRING(150), allowNull: false },
    email: { type: DataTypes.STRING(150), allowNull: false },
    phone: { type: DataTypes.STRING(30), allowNull: true },
    position: { type: DataTypes.STRING(100), allowNull: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "supplier_contacts",
    timestamps: true,
  },
);

SupplierContactModel.belongsTo(SupplierModel, { foreignKey: "supplierId", as: "supplier" });
SupplierModel.hasMany(SupplierContactModel, { foreignKey: "supplierId", as: "contacts" });
