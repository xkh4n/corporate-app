import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";

export class PersonModel extends Model<
  InferAttributes<PersonModel>,
  InferCreationAttributes<PersonModel>
> {
  declare id: CreationOptional<number>;
  declare firstName: string;
  // Apellido PATERNO en los alta nuevos (ver maternalLastName). En personas
  // creadas antes de este cambio puede traer ambos apellidos juntos.
  declare lastName: string;
  declare maternalLastName: string | null;
  // Campos 6 y 7 del formato Previred (Tablas 1 y 2). NULL en personas
  // anteriores: el generador de la nomina exige que un colaborador los tenga.
  declare sex: "M" | "F" | null;
  // 0 chileno, 1 extranjero.
  declare nationality: 0 | 1 | null;
  declare documentId: string;
  declare email: string;
  declare phone: string | null;
  declare birthDate: string | null;
  declare isActive: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PersonModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    firstName: { type: DataTypes.STRING(100), allowNull: false, field: "first_name" },
    lastName: { type: DataTypes.STRING(100), allowNull: false, field: "last_name" },
    maternalLastName: { type: DataTypes.STRING(100), allowNull: true, field: "maternal_last_name" },
    sex: { type: DataTypes.STRING(1), allowNull: true },
    nationality: { type: DataTypes.SMALLINT, allowNull: true },
    documentId: { type: DataTypes.STRING(20), allowNull: false, unique: true, field: "document_id" },
    email: { type: DataTypes.STRING(150), allowNull: false, unique: true },
    phone: { type: DataTypes.STRING(30), allowNull: true },
    birthDate: { type: DataTypes.DATEONLY, allowNull: true, field: "birth_date" },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "persons",
    timestamps: true,
  },
);
