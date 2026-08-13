import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PersonModel } from "./person.model";

export class UserModel extends Model<InferAttributes<UserModel>, InferCreationAttributes<UserModel>> {
  declare id: CreationOptional<number>;
  declare personId: number;
  // roleId apunta a roles.id en Postgres: sin FK real (motores distintos),
  // se valida a mano en services/mssql/user.service.ts contra role.service.
  declare roleId: number;
  declare username: string;
  declare passwordHash: string;
  declare isActive: CreationOptional<boolean>;
  declare lastLoginAt: Date | null;
  // true al crear el User o al resetear la password via admin (PATCH
  // /users/:id/password); se limpia a false tras un PATCH /auth/change-password
  // exitoso (auto-servicio). El frontend usa esto para forzar la vista de
  // cambio obligatorio antes de dejar entrar a cualquier otra pantalla (ver
  // /auth/me en auth.controller.ts).
  declare mustChangePassword: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

UserModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    personId: { type: DataTypes.INTEGER, allowNull: false, field: "person_id" },
    roleId: { type: DataTypes.INTEGER, allowNull: false, field: "role_id" },
    username: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false, field: "password_hash" },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
    lastLoginAt: { type: DataTypes.DATE, allowNull: true, field: "last_login_at" },
    mustChangePassword: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "must_change_password",
    },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "users",
    timestamps: true,
  },
);

UserModel.belongsTo(PersonModel, { foreignKey: "personId", as: "person" });
PersonModel.hasOne(UserModel, { foreignKey: "personId", as: "user" });
