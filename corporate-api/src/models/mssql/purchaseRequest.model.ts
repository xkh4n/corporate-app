import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PersonModel } from "./person.model";
import { UserModel } from "./user.model";

// requesterId/beneficiaryId apuntan a persons (no a users): el beneficiario
// puede no tener cuenta de sistema. beneficiaryUserId (cuentaBeneficiario)
// es la cuenta de usuario del beneficiario cuando si la tiene. Los campos
// requesterPosition/requesterEmail/requesterPhone son una foto (snapshot)
// del dato de la persona al momento de la solicitud, para que el documento
// no cambie si despues se edita su perfil. Ver memoria
// project-erp-scope-and-data-classification.
export class PurchaseRequestModel extends Model<
  InferAttributes<PurchaseRequestModel>,
  InferCreationAttributes<PurchaseRequestModel>
> {
  declare id: CreationOptional<number>;
  declare requestNumber: string;
  declare requesterId: number;
  declare requesterPosition: string | null;
  declare requesterEmail: string | null;
  declare requesterPhone: string | null;
  declare beneficiaryId: number;
  declare beneficiaryPhone: string | null;
  declare beneficiaryUserId: number | null;
  declare costCenterId: number;
  declare notes: string | null;
  declare status: CreationOptional<string>;
  declare priority: CreationOptional<string>;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PurchaseRequestModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    requestNumber: { type: DataTypes.STRING(20), allowNull: false, unique: true, field: "request_number" },
    requesterId: { type: DataTypes.INTEGER, allowNull: false, field: "requester_id" },
    requesterPosition: { type: DataTypes.STRING(100), allowNull: true, field: "requester_position" },
    requesterEmail: { type: DataTypes.STRING(150), allowNull: true, field: "requester_email" },
    requesterPhone: { type: DataTypes.STRING(30), allowNull: true, field: "requester_phone" },
    beneficiaryId: { type: DataTypes.INTEGER, allowNull: false, field: "beneficiary_id" },
    beneficiaryPhone: { type: DataTypes.STRING(30), allowNull: true, field: "beneficiary_phone" },
    beneficiaryUserId: { type: DataTypes.INTEGER, allowNull: true, field: "beneficiary_user_id" },
    costCenterId: { type: DataTypes.INTEGER, allowNull: false, field: "cost_center_id" },
    notes: { type: DataTypes.STRING(500), allowNull: true },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "DRAFT" },
    priority: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "MEDIUM" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "purchase_requests",
    timestamps: true,
  },
);

PurchaseRequestModel.belongsTo(PersonModel, { foreignKey: "requesterId", as: "requester" });
PurchaseRequestModel.belongsTo(PersonModel, { foreignKey: "beneficiaryId", as: "beneficiary" });
PurchaseRequestModel.belongsTo(UserModel, { foreignKey: "beneficiaryUserId", as: "beneficiaryUser" });
