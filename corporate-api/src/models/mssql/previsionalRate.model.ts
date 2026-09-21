import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PrevisionalInstitutionModel } from "./previsionalInstitution.model";

// Tasas versionadas por vigencia (valid_from/valid_to), no una columna en la
// institucion: la comision de una AFP, la tasa del SIS o la de expectativa de
// vida cambian, y una planilla de un periodo pasado debe poder recalcularse
// con la tasa que regia entonces (Previred rechaza con tolerancia 0 si el
// monto no calza con la tasa del periodo).
//
//  AFP_COMMISSION    comision de la AFP (institution_id = la AFP)
//  AFP_MANDATORY     cotizacion obligatoria de pensiones (10%), global
//  SIS               seguro de invalidez y sobrevivencia (cargo empleador), global
//  HEALTH_LEGAL      salud legal (7%), global
//  AFC_WORKER        aporte trabajador seguro de cesantia, global
//  AFC_EMPLOYER_INDEFINITE / AFC_EMPLOYER_FIXED_TERM  aporte empleador segun contrato
//  LIFE_EXPECTANCY   cotizacion expectativa de vida (campo 94), global
//  PROTECTED_RETURN  cotizacion rentabilidad protegida (campo 95), global
//
// institution_id NULL = tasa global. La tasa de accidentes del trabajo
// (mutual/ISL) es propia de cada empresa y vive en previredEmployerSettings.
export type PrevisionalRateType =
  | "AFP_COMMISSION"
  | "AFP_MANDATORY"
  | "SIS"
  | "HEALTH_LEGAL"
  | "AFC_WORKER"
  | "AFC_EMPLOYER_INDEFINITE"
  | "AFC_EMPLOYER_FIXED_TERM"
  | "LIFE_EXPECTANCY"
  | "PROTECTED_RETURN";

export class PrevisionalRateModel extends Model<
  InferAttributes<PrevisionalRateModel>,
  InferCreationAttributes<PrevisionalRateModel>
> {
  declare id: CreationOptional<number>;
  declare rateType: PrevisionalRateType;
  declare institutionId: number | null;
  // Porcentaje, ej. 1.44 = 1,44%. tedious devuelve DECIMAL como number.
  declare rate: number;
  declare validFrom: string;
  // NULL = vigente hasta nuevo aviso.
  declare validTo: string | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PrevisionalRateModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    rateType: { type: DataTypes.STRING(30), allowNull: false, field: "rate_type" },
    institutionId: { type: DataTypes.INTEGER, allowNull: true, field: "institution_id" },
    rate: { type: DataTypes.DECIMAL(7, 4), allowNull: false },
    validFrom: { type: DataTypes.DATEONLY, allowNull: false, field: "valid_from" },
    validTo: { type: DataTypes.DATEONLY, allowNull: true, field: "valid_to" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "previsional_rates",
    timestamps: true,
  },
);

PrevisionalRateModel.belongsTo(PrevisionalInstitutionModel, { foreignKey: "institutionId", as: "institution" });
PrevisionalInstitutionModel.hasMany(PrevisionalRateModel, { foreignKey: "institutionId", as: "rates" });
