import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";

export class CountryModel extends Model<InferAttributes<CountryModel>, InferCreationAttributes<CountryModel>> {
  declare id: CreationOptional<number>;
  declare isoCode: string;
  declare iataCode: string | null;
  declare nameCountry: string;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CountryModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    isoCode: { type: DataTypes.STRING(2), allowNull: false, unique: true, field: "iso_code" },
    iataCode: { type: DataTypes.STRING(3), allowNull: true, field: "iata_code" },
    nameCountry: { type: DataTypes.STRING(150), allowNull: false, field: "name_country" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "countries",
    timestamps: true,
  },
);
