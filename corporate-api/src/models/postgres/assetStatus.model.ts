import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { postgres } from "../../databases/postgres/connection";

// Tabla lookup (no ENUM/CHECK hardcodeado): la lista de estados de activos
// es abierta ("etc." segun el usuario), permite agregar estados sin
// migracion. "code" es la clave estable para la logica de la app (ej.
// "AVAILABLE"); "name" es solo la etiqueta visible y puede cambiar desde un
// CRUD de mantenimiento sin romper comparaciones en codigo. Ver memoria
// project-erp-scope-and-data-classification.
export class AssetStatusModel extends Model<
  InferAttributes<AssetStatusModel>,
  InferCreationAttributes<AssetStatusModel>
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

AssetStatusModel.init(
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
    sequelize: postgres,
    tableName: "asset_statuses",
    timestamps: true,
  },
);
