import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { CityModel } from "./city.model";

// "states" es el nivel administrativo mas bajo de la jerarquia (comuna en
// Chile, condado/nivel analogo en otros paises), no un "estado" tipo EEUU
// -el nombre generico se mantiene para reusar la misma tabla entre paises.
// Ver memoria project-erp-scope-and-data-classification.
export class StateModel extends Model<InferAttributes<StateModel>, InferCreationAttributes<StateModel>> {
  declare id: CreationOptional<number>;
  declare territorialCode: string | null;
  declare postalCode: string | null;
  declare siiCode: string | null;
  declare nameState: string;
  declare cityId: number;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StateModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    territorialCode: { type: DataTypes.STRING(20), allowNull: true, field: "territorial_code" },
    postalCode: { type: DataTypes.STRING(20), allowNull: true, field: "postal_code" },
    siiCode: { type: DataTypes.STRING(20), allowNull: true, field: "sii_code" },
    nameState: { type: DataTypes.STRING(150), allowNull: false, field: "name_state" },
    cityId: { type: DataTypes.INTEGER, allowNull: false, field: "city_id" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "states",
    timestamps: true,
  },
);

StateModel.belongsTo(CityModel, { foreignKey: "cityId", as: "city" });
CityModel.hasMany(StateModel, { foreignKey: "cityId", as: "states" });
