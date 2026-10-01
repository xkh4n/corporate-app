import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { UserModel } from "./user.model";

// Plan 017: una passkey registrada (Windows Hello, Touch ID, llave FIDO2, passkey del telefono). Solo la
// clave PUBLICA: la privada nunca sale del autenticador. credentialId en base64url, como lo entrega el
// navegador; signCount detecta un autenticador clonado (ver library/mfa/webauthn.ts).
export class WebauthnCredentialModel extends Model<
  InferAttributes<WebauthnCredentialModel>,
  InferCreationAttributes<WebauthnCredentialModel>
> {
  declare id: CreationOptional<number>;
  declare userId: number;
  declare credentialId: string;
  declare publicKey: Buffer;
  declare signCount: number;
  declare transports: string | null;
  declare deviceName: string;
  declare aaguid: string | null;
  declare backedUp: boolean;
  declare lastUsedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

WebauthnCredentialModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: "user_id" },
    credentialId: { type: DataTypes.STRING(512), allowNull: false, unique: true, field: "credential_id" },
    publicKey: { type: DataTypes.BLOB, allowNull: false, field: "public_key" },
    // BIGINT llega como string desde tedious: se normaliza a number al leer (los contadores reales
    // estan muy lejos de 2^53).
    signCount: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "sign_count",
      get(this: WebauthnCredentialModel) {
        return Number(this.getDataValue("signCount"));
      },
    },
    transports: { type: DataTypes.STRING(100), allowNull: true },
    deviceName: { type: DataTypes.STRING(100), allowNull: false, field: "device_name" },
    aaguid: { type: DataTypes.STRING(36), allowNull: true },
    backedUp: { type: DataTypes.BOOLEAN, allowNull: false, field: "backed_up" },
    lastUsedAt: { type: DataTypes.DATE, allowNull: true, field: "last_used_at" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "user_webauthn_credentials",
    timestamps: true,
  },
);

WebauthnCredentialModel.belongsTo(UserModel, { foreignKey: "userId", as: "user" });
