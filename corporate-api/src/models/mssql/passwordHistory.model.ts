import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { UserModel } from "./user.model";

// Solo hashes VIEJOS: el hash actual vive en users.password_hash, nunca se
// duplica aca. Ver services/mssql/user.service.ts (changePassword) para el
// check contra PASSWORD_HISTORY_LIMIT y la poda de filas mas antiguas.
export class PasswordHistoryModel extends Model<
  InferAttributes<PasswordHistoryModel>,
  InferCreationAttributes<PasswordHistoryModel>
> {
  declare id: CreationOptional<number>;
  declare userId: number;
  declare passwordHash: string;
  declare createdAt: CreationOptional<Date>;
}

PasswordHistoryModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: "user_id" },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false, field: "password_hash" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
  },
  {
    sequelize: mssql,
    tableName: "password_history",
    timestamps: false,
  },
);

PasswordHistoryModel.belongsTo(UserModel, { foreignKey: "userId", as: "user" });
