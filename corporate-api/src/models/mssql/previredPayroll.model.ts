import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";

// Tabla 3 de Previred: 01 remuneraciones del mes, 02 gratificaciones,
// 03 bono Ley de Modernizacion de Empresas Publicas.
export type PreviredPaymentType = "01" | "02" | "03";
// DRAFT: lineas editables. VALIDATED: paso las validaciones locales. GENERATED:
// ya se produjo el archivo (file_name/file_sha256 quedan fijos). SUBMITTED:
// confirmado como subido a Previred (el envio es manual en su portal).
export type PreviredPayrollStatus = "DRAFT" | "VALIDATED" | "GENERATED" | "SUBMITTED";

// Cabecera de un envio: una nomina de un periodo y un tipo de pago. El archivo
// de largo variable de Previred es plano (sin cabecera propia), asi que estos
// datos -periodo, tipo, estado- solo existen aca y se repiten en cada linea
// del archivo (campos 8, 9 y 10).
export class PreviredPayrollModel extends Model<
  InferAttributes<PreviredPayrollModel>,
  InferCreationAttributes<PreviredPayrollModel>
> {
  declare id: CreationOptional<number>;
  declare paymentType: PreviredPaymentType;
  // Primer dia del mes del periodo (2026-09-01); se formatea mmaaaa al generar
  // el archivo. DATE y no CHAR(6) para poder ordenar/comparar periodos.
  declare periodFrom: string;
  // Solo tipos 02 y 03 (campo 10, "Condicional"); NULL en remuneraciones.
  declare periodTo: string | null;
  declare status: CreationOptional<PreviredPayrollStatus>;
  declare generatedAt: Date | null;
  declare generatedBy: number | null;
  declare fileName: string | null;
  // SHA-256 del archivo generado: permite comprobar que el que se subio a
  // Previred es el mismo que se produjo aca, sin guardar el archivo (contiene
  // PII de toda la nomina).
  declare fileSha256: string | null;
  declare notes: string | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PreviredPayrollModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    paymentType: { type: DataTypes.STRING(2), allowNull: false, field: "payment_type" },
    periodFrom: { type: DataTypes.DATEONLY, allowNull: false, field: "period_from" },
    periodTo: { type: DataTypes.DATEONLY, allowNull: true, field: "period_to" },
    status: { type: DataTypes.STRING(15), allowNull: false, defaultValue: "DRAFT" },
    generatedAt: { type: DataTypes.DATE, allowNull: true, field: "generated_at" },
    generatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "generated_by" },
    fileName: { type: DataTypes.STRING(150), allowNull: true, field: "file_name" },
    fileSha256: { type: DataTypes.STRING(64), allowNull: true, field: "file_sha256" },
    notes: { type: DataTypes.STRING(500), allowNull: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "previred_payrolls",
    timestamps: true,
  },
);
