import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { BusinessPartnerModel } from "./businessPartner.model";
import { SupplierServiceTypeModel } from "./supplierServiceType.model";
import { SupplierDeliveryTermsModel } from "./supplierDeliveryTerms.model";

// serviceType/deliveryTerms son FK a tablas lookup (supplier_service_types/
// supplier_delivery_terms), no un ENUM/CHECK hardcodeado -permite agregar
// valores nuevos via API/CRUD sin migracion, mismo criterio que
// assets.status_id -> asset_statuses.
export class SupplierModel extends Model<InferAttributes<SupplierModel>, InferCreationAttributes<SupplierModel>> {
  declare id: CreationOptional<number>;
  declare businessPartnerId: number;
  declare serviceTypeId: number;
  declare paymentTermDays: CreationOptional<number>;
  declare deliveryTermsId: number;
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
    serviceTypeId: { type: DataTypes.INTEGER, allowNull: false, field: "service_type_id" },
    paymentTermDays: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "payment_term_days",
    },
    deliveryTermsId: { type: DataTypes.INTEGER, allowNull: false, field: "delivery_terms_id" },
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

SupplierModel.belongsTo(SupplierServiceTypeModel, { foreignKey: "serviceTypeId", as: "serviceType" });
SupplierServiceTypeModel.hasMany(SupplierModel, { foreignKey: "serviceTypeId", as: "suppliers" });

SupplierModel.belongsTo(SupplierDeliveryTermsModel, { foreignKey: "deliveryTermsId", as: "deliveryTerms" });
SupplierDeliveryTermsModel.hasMany(SupplierModel, { foreignKey: "deliveryTermsId", as: "suppliers" });
