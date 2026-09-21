import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { CountryModel } from "./country.model";

export class CityModel extends Model<InferAttributes<CityModel>, InferCreationAttributes<CityModel>> {
  declare id: CreationOptional<number>;
  declare iataCodes: string | null;
  declare nameCity: string;
  declare countryId: number;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CityModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    iataCodes: { type: DataTypes.STRING(20), allowNull: true, unique: true, field: "iata_codes" },
    nameCity: { type: DataTypes.STRING(150), allowNull: false, field: "name_city" },
    countryId: { type: DataTypes.INTEGER, allowNull: false, field: "country_id" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "cities",
    timestamps: true,
  },
);

CityModel.belongsTo(CountryModel, { foreignKey: "countryId", as: "country" });
CountryModel.hasMany(CityModel, { foreignKey: "countryId", as: "cities" });
