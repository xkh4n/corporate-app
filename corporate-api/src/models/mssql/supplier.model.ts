import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { BusinessPartnerModel } from "./businessPartner.model";

export type SupplierServiceType = "LEASE" | "SERVICE" | "SALE";
export type SupplierDeliveryTerms = "ON_PURCHASE_ORDER" | "ON_INVOICE";

export class SupplierModel extends Model<InferAttributes<SupplierModel>, InferCreationAttributes<SupplierModel>> {
  declare id: CreationOptional<number>;
  declare businessPartnerId: number;
  declare serviceType: SupplierServiceType;
  declare paymentTermDays: CreationOptional<number>;
  declare deliveryTerms: SupplierDeliveryTerms;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

SupplierModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    businessPartnerId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      field: "business_partner_id",
    },
    serviceType: { type: DataTypes.STRING(20), allowNull: false, field: "service_type" },
    paymentTermDays: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "payment_term_days",
    },
    deliveryTerms: { type: DataTypes.STRING(20), allowNull: false, field: "delivery_terms" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "suppliers",
    timestamps: true,
  },
);

SupplierModel.belongsTo(BusinessPartnerModel, { foreignKey: "businessPartnerId", as: "businessPartner" });
BusinessPartnerModel.hasOne(SupplierModel, { foreignKey: "businessPartnerId", as: "supplier" });
