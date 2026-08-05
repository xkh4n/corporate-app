import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";

export class PersonModel extends Model<
  InferAttributes<PersonModel>,
  InferCreationAttributes<PersonModel>
> {
  declare id: CreationOptional<number>;
  declare firstName: string;
  declare lastName: string;
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
