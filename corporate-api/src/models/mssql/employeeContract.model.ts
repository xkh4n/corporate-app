import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { EmployeeModel } from "./employee.model";
import type { GratificationType } from "./payrollSettings.model";

export type EmployeeContractType = "INDEFINIDO" | "PLAZO_FIJO";
// PORCENTAJE_REMUNERACIONES: % sobre lo devengado en remuneraciones mensuales
// (ART50 y convencional). PARTICIPACION_UTILIDADES: la del ART47, que depende
// de las utilidades de la empresa (todavia sin calculo: falta modelar utilidades).
export type GratificationMethod = "PORCENTAJE_REMUNERACIONES" | "PARTICIPACION_UTILIDADES";
export type GratificationCapType = "IMM";
// MENSUAL: se paga cada mes, sin ajuste posterior. ANTICIPO_MENSUAL_RELIQUIDACION:
// anticipos mensuales y una reliquidacion en gratification_settlement_month que
// cuadra contra el derecho anual. ANUAL: un solo pago en ese mes.
export type GratificationPaymentMode = "MENSUAL" | "ANTICIPO_MENSUAL_RELIQUIDACION" | "ANUAL";

// Contrato vigente o historico de un colaborador: sueldo base y la forma en
// que se le paga la gratificacion legal. Un colaborador puede tener varios en
// el tiempo (recontratacion, renovacion de plazo fijo), pero solo uno abierto
// a la vez; la fila mas reciente sin end_date es la vigente.
//
// Reemplaza a employee_previsional_profiles.contract_type/contract_start_date
// (para el seguro de cesantia: tipo de contrato y antiguedad salen de aca).
export class EmployeeContractModel extends Model<
  InferAttributes<EmployeeContractModel>,
  InferCreationAttributes<EmployeeContractModel>
> {
  declare id: CreationOptional<number>;
  declare employeeId: number;
  declare contractType: EmployeeContractType;
  declare startDate: string;
  // Obligatorio en PLAZO_FIJO; en INDEFINIDO se llena al terminar la relacion.
  declare endDate: string | null;
  // Sueldo base mensual en pesos enteros.
  declare baseSalary: number;

  declare gratificationType: GratificationType;
  declare gratificationMethod: GratificationMethod;
  // Porcentaje (ART50: 25).
  declare gratificationPercentage: number;
  // Tope: cap_factor veces el valor de cap_type (ART50: 4,75 IMM). Ambos NULL = sin tope.
  declare gratificationCapType: GratificationCapType | null;
  declare gratificationCapFactor: number | null;
  declare gratificationPaymentMode: GratificationPaymentMode;
  // 1-12. Obligatorio si el modo no es MENSUAL (mes de la reliquidacion o del pago anual).
  declare gratificationSettlementMonth: number | null;
  // Monto en pesos que se anticipa cada mes. Obligatorio con
  // ANTICIPO_MENSUAL_RELIQUIDACION (lo exige el controlador), NULL en los demas
  // modos. Tambien NULL en contratos anteriores a este campo.
  declare gratificationMonthlyAdvance: number | null;
  // Reajustar los anticipos por IPC al reliquidar (solo con ANTICIPO_MENSUAL_RELIQUIDACION).
  declare gratificationAdjustAdvancesCpi: CreationOptional<boolean>;

  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

EmployeeContractModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    employeeId: { type: DataTypes.INTEGER, allowNull: false, field: "employee_id" },
    contractType: { type: DataTypes.STRING(15), allowNull: false, field: "contract_type" },
    startDate: { type: DataTypes.DATEONLY, allowNull: false, field: "start_date" },
    endDate: { type: DataTypes.DATEONLY, allowNull: true, field: "end_date" },
    baseSalary: { type: DataTypes.INTEGER, allowNull: false, field: "base_salary" },
    gratificationType: { type: DataTypes.STRING(15), allowNull: false, field: "gratification_type" },
    gratificationMethod: { type: DataTypes.STRING(30), allowNull: false, field: "gratification_method" },
    gratificationPercentage: { type: DataTypes.DECIMAL(5, 2), allowNull: false, field: "gratification_percentage" },
    gratificationCapType: { type: DataTypes.STRING(10), allowNull: true, field: "gratification_cap_type" },
    gratificationCapFactor: { type: DataTypes.DECIMAL(6, 3), allowNull: true, field: "gratification_cap_factor" },
    gratificationPaymentMode: { type: DataTypes.STRING(30), allowNull: false, field: "gratification_payment_mode" },
    gratificationSettlementMonth: { type: DataTypes.SMALLINT, allowNull: true, field: "gratification_settlement_month" },
    gratificationMonthlyAdvance: { type: DataTypes.INTEGER, allowNull: true, field: "gratification_monthly_advance" },
    gratificationAdjustAdvancesCpi: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "gratification_adjust_advances_cpi",
    },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "employee_contracts",
    timestamps: true,
  },
);

EmployeeContractModel.belongsTo(EmployeeModel, { foreignKey: "employeeId", as: "employee" });
EmployeeModel.hasMany(EmployeeContractModel, { foreignKey: "employeeId", as: "contracts" });
