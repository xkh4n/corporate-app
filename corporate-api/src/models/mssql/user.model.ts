import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, NonAttribute } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PersonModel } from "./person.model";

export class UserModel extends Model<InferAttributes<UserModel>, InferCreationAttributes<UserModel>> {
  declare id: CreationOptional<number>;
  declare personId: number;
  // NonAttribute: solo esta poblado cuando el query pide explicitamente
  // include:[{model: PersonModel, as:"person"}] (ver getUserById/
  // getUserByUsername/getUserByPersonId en user.service.ts) -no es una
  // columna propia de "users". Mismo patron que AssetModel.status.
  declare person?: NonAttribute<PersonModel>;
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
  // Plan 017: segundo factor. El secreto TOTP va cifrado (library/mfa/secretBox.ts) y nunca sale en
  // una respuesta HTTP (ver toSafeUser en user.service.ts). Las passkeys viven en su propia tabla.
  declare mfaTotpSecretEnc: CreationOptional<string | null>;
  declare mfaEmailEnabled: CreationOptional<boolean>;
  declare mfaEnrolledAt: CreationOptional<Date | null>;
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
    mfaTotpSecretEnc: { type: DataTypes.STRING(255), allowNull: true, field: "mfa_totp_secret_enc" },
    mfaEmailEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: "mfa_email_enabled" },
    mfaEnrolledAt: { type: DataTypes.DATE, allowNull: true, field: "mfa_enrolled_at" },
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
