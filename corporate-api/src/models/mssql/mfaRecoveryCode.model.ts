import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { UserModel } from "./user.model";

// Plan 017: codigos de recuperacion de un solo uso. Solo el HMAC con la clave de MFA (ver
// library/mfa/recoveryCodes.ts), nunca el codigo en claro: se muestran una sola vez al generarlos.
export class MfaRecoveryCodeModel extends Model<
  InferAttributes<MfaRecoveryCodeModel>,
  InferCreationAttributes<MfaRecoveryCodeModel>
> {
  declare id: CreationOptional<number>;
  declare userId: number;
  declare codeHash: string;
  declare usedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
}

MfaRecoveryCodeModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: "user_id" },
    codeHash: { type: DataTypes.STRING(64), allowNull: false, field: "code_hash" },
    usedAt: { type: DataTypes.DATE, allowNull: true, field: "used_at" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
  },
  {
    sequelize: mssql,
    tableName: "user_mfa_recovery_codes",
    timestamps: false,
  },
);

MfaRecoveryCodeModel.belongsTo(UserModel, { foreignKey: "userId", as: "user" });
