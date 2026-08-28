import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { BusinessPartnerModel } from "./businessPartner.model";

export class CustomerModel extends Model<InferAttributes<CustomerModel>, InferCreationAttributes<CustomerModel>> {
  declare id: CreationOptional<number>;
  declare businessPartnerId: number;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

CustomerModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    businessPartnerId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      field: "business_partner_id",
    },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "customers",
    timestamps: true,
  },
);

CustomerModel.belongsTo(BusinessPartnerModel, { foreignKey: "businessPartnerId", as: "businessPartner" });
BusinessPartnerModel.hasOne(CustomerModel, { foreignKey: "businessPartnerId", as: "customer" });
