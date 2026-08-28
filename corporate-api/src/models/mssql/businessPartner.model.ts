import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";

// Entidad base para proveedores/clientes: campos compartidos (razon social,
// rut, giro). suppliers/customers son extensiones 1:1 -evita duplicar estos
// campos y permite que una misma empresa sea cliente Y proveedor a la vez
// sin filas duplicadas. Ver memoria project-erp-scope-and-data-classification.
export class BusinessPartnerModel extends Model<
  InferAttributes<BusinessPartnerModel>,
  InferCreationAttributes<BusinessPartnerModel>
> {
  declare id: CreationOptional<number>;
  declare legalName: string;
  declare nationalId: string;
  declare businessLine: string | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

BusinessPartnerModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    legalName: { type: DataTypes.STRING(200), allowNull: false, field: "legal_name" },
    nationalId: { type: DataTypes.STRING(20), allowNull: false, unique: true, field: "national_id" },
    businessLine: { type: DataTypes.STRING(150), allowNull: true, field: "business_line" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "business_partners",
    timestamps: true,
  },
);
