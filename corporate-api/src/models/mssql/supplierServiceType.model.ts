import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";

// Tabla lookup (no ENUM/CHECK hardcodeado), mismo patron que
// postgres/assetStatus.model.ts: permite agregar tipos de servicio de
// proveedor nuevos via API/CRUD sin migracion. Vive en MSSQL (no en Postgres,
// a diferencia de asset_statuses) porque suppliers -la unica tabla que la
// referencia- vive en MSSQL: mismo motor permite un FK real, no cross-engine.
export class SupplierServiceTypeModel extends Model<
  InferAttributes<SupplierServiceTypeModel>,
  InferCreationAttributes<SupplierServiceTypeModel>
> {
  declare id: CreationOptional<number>;
  declare code: string;
  declare name: string;
  declare description: string | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SupplierServiceTypeModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    code: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "supplier_service_types",
    timestamps: true,
  },
);
