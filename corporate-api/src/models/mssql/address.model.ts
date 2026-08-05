import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PersonModel } from "./person.model";
import { BusinessPartnerModel } from "./businessPartner.model";
import { StateModel } from "./state.model";

// 1:N, no embebida en persons/business_partners: permite mas de una
// direccion por entidad (ej. fiscal vs. despacho para un proveedor). Solo
// guarda stateId -no cityId/countryId repetidos- para no arrastrar 3 FKs
// que tendrian que mantenerse consistentes entre si; ciudad/pais se resuelven
// via el join state -> city -> country. Exactamente uno de personId/
// businessPartnerId debe estar seteado (CHECK a nivel de BD, ver migrate.ts).
export class AddressModel extends Model<InferAttributes<AddressModel>, InferCreationAttributes<AddressModel>> {
  declare id: CreationOptional<number>;
  declare personId: number | null;
  declare businessPartnerId: number | null;
  declare addressType: string;
  declare addressLine: string;
  declare stateId: number;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

AddressModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    personId: { type: DataTypes.INTEGER, allowNull: true, field: "person_id" },
    businessPartnerId: { type: DataTypes.INTEGER, allowNull: true, field: "business_partner_id" },
    addressType: { type: DataTypes.STRING(30), allowNull: false, field: "address_type" },
    addressLine: { type: DataTypes.STRING(255), allowNull: false, field: "address_line" },
    stateId: { type: DataTypes.INTEGER, allowNull: false, field: "state_id" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "addresses",
    timestamps: true,
  },
);

AddressModel.belongsTo(PersonModel, { foreignKey: "personId", as: "person" });
PersonModel.hasMany(AddressModel, { foreignKey: "personId", as: "addresses" });

AddressModel.belongsTo(BusinessPartnerModel, { foreignKey: "businessPartnerId", as: "businessPartner" });
BusinessPartnerModel.hasMany(AddressModel, { foreignKey: "businessPartnerId", as: "addresses" });

AddressModel.belongsTo(StateModel, { foreignKey: "stateId", as: "state" });
StateModel.hasMany(AddressModel, { foreignKey: "stateId", as: "addresses" });
