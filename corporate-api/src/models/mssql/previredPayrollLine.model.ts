import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { EmployeeModel } from "./employee.model";
import { PreviredPayrollModel } from "./previredPayroll.model";
import { PrevisionalInstitutionModel } from "./previsionalInstitution.model";
import { ApvInstitutionModel } from "./apvInstitution.model";
import type {
  FamilyAllowanceBracket,
  HealthPlanCurrency,
  PrevisionalRegime,
  PrevisionalWorkerType,
  WorkdayType,
} from "./employeePrevisionalProfile.model";

// Tabla 6: 00 principal, 01 adicional (2do movimiento de personal, APVI, APVC),
// 02 segundo contrato o pagos adicionales, 03 movimiento de afiliado voluntario.
export type PreviredLineType = "00" | "01" | "02" | "03";

// Una fila = una linea del archivo de largo variable: un trabajador en un
// envio (previred_payrolls). Es una FOTO de los montos y codigos del periodo,
// no una referencia viva al perfil: si el trabajador cambia de AFP/isapre
// despues, una planilla ya generada debe seguir produciendo el mismo archivo.
//
// Cubre los campos 8-105 del formato; los 1-7 (RUT, nombres, sexo,
// nacionalidad) se toman del perfil/persona al generar, porque Previred los
// valida contra el Registro Civil y no varian por periodo.
//
// Convenciones:
//  * Montos en pesos enteros -> INT (el formato pide enteros sin decimales, max
//    9 digitos). Los que son porcentaje o UF con decimales -> DECIMAL; el
//    driver (tedious) los devuelve como number, no como string.
//  * Columna "no aplica" = 0 / NULL: el generador escribe el 0 o los blancos
//    que exige la seccion "Especificacion Lineas Especiales" segun line_type.
//  * Los codigos Previred (AFP "03", salud "07") NO se guardan: se resuelven
//    por FK a previsional_institutions/apv_institutions al generar, asi hay
//    una sola fuente de verdad para cada codigo.
//
// FUERA DE ALCANCE por ahora: campos 50-61 (afiliado voluntario / linea 03) y
// la Tabla 14 de ex cajas (regimen INP) -ver ips_ex_fund_code.
export class PreviredPayrollLineModel extends Model<
  InferAttributes<PreviredPayrollLineModel>,
  InferCreationAttributes<PreviredPayrollLineModel>
> {
  declare id: CreationOptional<number>;
  declare payrollId: number;
  declare employeeId: number;
  declare lineType: PreviredLineType;
  // Orden dentro del trabajador: la linea anexa debe ir INMEDIATAMENTE despues
  // de la principal o Previred no la contabiliza (nota 1 de la especificacion).
  declare lineSeq: CreationOptional<number>;

  // --- Datos del trabajador (11-25) ---
  declare regime: PrevisionalRegime;
  declare workerType: PrevisionalWorkerType;
  declare daysWorked: number;
  // 15-17: codigos de la Tabla 7 (0 sin movimiento, 1 contratacion, 2 retiro,
  // 3 subsidio, 4 permiso sin goce, 5 incorporacion, 6 accidente, 7 plazo fijo,
  // 8 cambio a indefinido, 11 ausentismo, 12 reliquidacion).
  declare movementCode: CreationOptional<number>;
  declare movementFrom: string | null;
  declare movementTo: string | null;
  declare familyAllowanceBracket: FamilyAllowanceBracket;
  declare simpleCharges: CreationOptional<number>;
  declare maternalCharges: CreationOptional<number>;
  declare disabledCharges: CreationOptional<number>;
  declare familyAllowance: CreationOptional<number>;
  declare retroactiveFamilyAllowance: CreationOptional<number>;
  declare familyChargesRefund: CreationOptional<number>;
  // 25, "uso futuro": 'S' o 'N'.
  declare youngWorkerSubsidy: "S" | "N" | null;

  // --- AFP (26-39) ---
  declare afpInstitutionId: number | null;
  declare afpTaxableIncome: CreationOptional<number>;
  declare afpMandatoryContribution: CreationOptional<number>;
  declare sisContribution: CreationOptional<number>;
  declare afpVoluntarySavings: CreationOptional<number>;
  declare substituteTaxableIncome: CreationOptional<number>;
  declare substituteAgreedRate: number | null;
  declare substituteSeveranceContribution: CreationOptional<number>;
  declare substitutePeriods: CreationOptional<number>;
  declare substituteFrom: string | null;
  declare substituteTo: string | null;
  declare heavyWorkPosition: string | null;
  declare heavyWorkRate: number | null;
  declare heavyWorkContribution: CreationOptional<number>;

  // --- APVI (40-44) y APVC (45-49) ---
  declare apviInstitutionId: number | null;
  declare apviContractNumber: string | null;
  declare apviPaymentMethod: 1 | 2 | null;
  declare apviAmount: CreationOptional<number>;
  declare apviAgreedDeposits: CreationOptional<number>;
  declare apvcInstitutionId: number | null;
  declare apvcContractNumber: string | null;
  declare apvcPaymentMethod: 1 | 2 | null;
  declare apvcWorkerAmount: CreationOptional<number>;
  declare apvcEmployerAmount: CreationOptional<number>;

  // --- IPS / ISL / FONASA (62-74) ---
  // Tabla 14 (ex cajas, ~100 codigos de 4 digitos): texto libre por ahora, sin
  // catalogo -solo aplica a regimen INP, que hoy no esta en uso. Cuando se
  // active, va a un catalogo y esto pasa a FK.
  declare ipsExFundCode: string | null;
  declare ipsRate: number | null;
  declare ipsTaxableIncome: CreationOptional<number>;
  declare ipsMandatoryContribution: CreationOptional<number>;
  declare severanceTaxableIncome: CreationOptional<number>;
  declare severanceFundCode: string | null;
  declare severanceRate: number | null;
  declare severanceContribution: CreationOptional<number>;
  declare fonasaContribution: CreationOptional<number>;
  // 71: aporte de accidentes del trabajo al ISL (solo si la empresa no tiene mutual).
  declare islWorkAccidentContribution: CreationOptional<number>;
  declare law15386Bonus: CreationOptional<number>;
  declare ipsFamilyChargesDiscount: CreationOptional<number>;
  declare governmentBonus: CreationOptional<number>;

  // --- Salud (75-82) ---
  declare healthInstitutionId: number | null;
  declare healthFun: string | null;
  declare healthTaxableIncome: CreationOptional<number>;
  declare healthPlanCurrency: HealthPlanCurrency | null;
  declare healthAgreedContribution: number | null;
  declare healthMandatoryContribution: CreationOptional<number>;
  declare healthAdditionalContribution: CreationOptional<number>;
  // 82 "uso futuro": Previred pide 0 en esta version.
  declare gesContribution: CreationOptional<number>;

  // --- CCAF (83-91) ---
  declare ccafInstitutionId: number | null;
  declare ccafTaxableIncome: CreationOptional<number>;
  declare ccafPersonalCredits: CreationOptional<number>;
  declare ccafDentalDiscount: CreationOptional<number>;
  declare ccafLeasingDiscount: CreationOptional<number>;
  declare ccafLifeInsuranceDiscount: CreationOptional<number>;
  declare ccafOtherDiscounts: CreationOptional<number>;
  declare ccafNonIsapreContribution: CreationOptional<number>;
  declare ccafFamilyChargesDiscount: CreationOptional<number>;

  // --- 92-95 ---
  // RIMA: renta imponible del mes anterior a la licencia; obligatoria solo con
  // movimiento de personal 3 o 6, y Previred rechaza si se informa con otro.
  declare previousMonthTaxableIncome: number | null;
  declare workdayType: WorkdayType;
  declare lifeExpectancyContribution: CreationOptional<number>;
  declare protectedReturnContribution: CreationOptional<number>;

  // --- Mutualidad (96-99) ---
  declare mutualInstitutionId: number | null;
  declare mutualTaxableIncome: CreationOptional<number>;
  declare mutualWorkAccidentContribution: CreationOptional<number>;
  declare mutualBranchCode: number | null;

  // --- Seguro de cesantia (100-102) ---
  declare afcTaxableIncome: CreationOptional<number>;
  declare afcWorkerContribution: CreationOptional<number>;
  declare afcEmployerContribution: CreationOptional<number>;

  // --- Pagador de subsidios (103-104): RUT/DV salen de la institucion (Tabla 20
  // son exactamente las isapres, FONASA, mutuales e ISL del catalogo).
  declare subsidyPayerInstitutionId: number | null;

  // 105: centro de costos/sucursal/obra. Debe estar pre-configurado en el portal
  // de Previred; se guarda como texto (max 20) y no como FK a cost_centers
  // (Postgres) porque lo que Previred valida es su propia configuracion.
  declare costCenterLabel: string | null;

  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

// Los montos son opcionales al crear (default 0 en BD); se declaran en un
// helper para no repetir 40 veces el mismo objeto.
const amount = (field: string) => ({ type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field });
const fk = (field: string) => ({ type: DataTypes.INTEGER, allowNull: true, field });

PreviredPayrollLineModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    payrollId: { type: DataTypes.INTEGER, allowNull: false, field: "payroll_id" },
    employeeId: { type: DataTypes.INTEGER, allowNull: false, field: "employee_id" },
    lineType: { type: DataTypes.STRING(2), allowNull: false, defaultValue: "00", field: "line_type" },
    lineSeq: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0, field: "line_seq" },

    regime: { type: DataTypes.STRING(3), allowNull: false },
    workerType: { type: DataTypes.SMALLINT, allowNull: false, field: "worker_type" },
    daysWorked: { type: DataTypes.SMALLINT, allowNull: false, field: "days_worked" },
    movementCode: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0, field: "movement_code" },
    movementFrom: { type: DataTypes.DATEONLY, allowNull: true, field: "movement_from" },
    movementTo: { type: DataTypes.DATEONLY, allowNull: true, field: "movement_to" },
    familyAllowanceBracket: { type: DataTypes.STRING(1), allowNull: false, defaultValue: "D", field: "family_allowance_bracket" },
    simpleCharges: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0, field: "simple_charges" },
    maternalCharges: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0, field: "maternal_charges" },
    disabledCharges: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0, field: "disabled_charges" },
    familyAllowance: amount("family_allowance"),
    retroactiveFamilyAllowance: amount("retroactive_family_allowance"),
    familyChargesRefund: amount("family_charges_refund"),
    youngWorkerSubsidy: { type: DataTypes.STRING(1), allowNull: true, field: "young_worker_subsidy" },

    afpInstitutionId: fk("afp_institution_id"),
    afpTaxableIncome: amount("afp_taxable_income"),
    afpMandatoryContribution: amount("afp_mandatory_contribution"),
    sisContribution: amount("sis_contribution"),
    afpVoluntarySavings: amount("afp_voluntary_savings"),
    substituteTaxableIncome: amount("substitute_taxable_income"),
    substituteAgreedRate: { type: DataTypes.DECIMAL(5, 2), allowNull: true, field: "substitute_agreed_rate" },
    substituteSeveranceContribution: amount("substitute_severance_contribution"),
    substitutePeriods: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0, field: "substitute_periods" },
    substituteFrom: { type: DataTypes.DATEONLY, allowNull: true, field: "substitute_from" },
    substituteTo: { type: DataTypes.DATEONLY, allowNull: true, field: "substitute_to" },
    heavyWorkPosition: { type: DataTypes.STRING(40), allowNull: true, field: "heavy_work_position" },
    heavyWorkRate: { type: DataTypes.DECIMAL(5, 2), allowNull: true, field: "heavy_work_rate" },
    heavyWorkContribution: amount("heavy_work_contribution"),

    apviInstitutionId: fk("apvi_institution_id"),
    apviContractNumber: { type: DataTypes.STRING(20), allowNull: true, field: "apvi_contract_number" },
    apviPaymentMethod: { type: DataTypes.SMALLINT, allowNull: true, field: "apvi_payment_method" },
    apviAmount: amount("apvi_amount"),
    apviAgreedDeposits: amount("apvi_agreed_deposits"),
    apvcInstitutionId: fk("apvc_institution_id"),
    apvcContractNumber: { type: DataTypes.STRING(20), allowNull: true, field: "apvc_contract_number" },
    apvcPaymentMethod: { type: DataTypes.SMALLINT, allowNull: true, field: "apvc_payment_method" },
    apvcWorkerAmount: amount("apvc_worker_amount"),
    apvcEmployerAmount: amount("apvc_employer_amount"),

    ipsExFundCode: { type: DataTypes.STRING(4), allowNull: true, field: "ips_ex_fund_code" },
    ipsRate: { type: DataTypes.DECIMAL(5, 2), allowNull: true, field: "ips_rate" },
    ipsTaxableIncome: amount("ips_taxable_income"),
    ipsMandatoryContribution: amount("ips_mandatory_contribution"),
    severanceTaxableIncome: amount("severance_taxable_income"),
    severanceFundCode: { type: DataTypes.STRING(4), allowNull: true, field: "severance_fund_code" },
    severanceRate: { type: DataTypes.DECIMAL(5, 2), allowNull: true, field: "severance_rate" },
    severanceContribution: amount("severance_contribution"),
    fonasaContribution: amount("fonasa_contribution"),
    islWorkAccidentContribution: amount("isl_work_accident_contribution"),
    law15386Bonus: amount("law_15386_bonus"),
    ipsFamilyChargesDiscount: amount("ips_family_charges_discount"),
    governmentBonus: amount("government_bonus"),

    healthInstitutionId: fk("health_institution_id"),
    healthFun: { type: DataTypes.STRING(16), allowNull: true, field: "health_fun" },
    healthTaxableIncome: amount("health_taxable_income"),
    healthPlanCurrency: { type: DataTypes.SMALLINT, allowNull: true, field: "health_plan_currency" },
    healthAgreedContribution: { type: DataTypes.DECIMAL(12, 4), allowNull: true, field: "health_agreed_contribution" },
    healthMandatoryContribution: amount("health_mandatory_contribution"),
    healthAdditionalContribution: amount("health_additional_contribution"),
    gesContribution: amount("ges_contribution"),

    ccafInstitutionId: fk("ccaf_institution_id"),
    ccafTaxableIncome: amount("ccaf_taxable_income"),
    ccafPersonalCredits: amount("ccaf_personal_credits"),
    ccafDentalDiscount: amount("ccaf_dental_discount"),
    ccafLeasingDiscount: amount("ccaf_leasing_discount"),
    ccafLifeInsuranceDiscount: amount("ccaf_life_insurance_discount"),
    ccafOtherDiscounts: amount("ccaf_other_discounts"),
    ccafNonIsapreContribution: amount("ccaf_non_isapre_contribution"),
    ccafFamilyChargesDiscount: amount("ccaf_family_charges_discount"),

    previousMonthTaxableIncome: { type: DataTypes.INTEGER, allowNull: true, field: "previous_month_taxable_income" },
    workdayType: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 1, field: "workday_type" },
    lifeExpectancyContribution: amount("life_expectancy_contribution"),
    protectedReturnContribution: amount("protected_return_contribution"),

    mutualInstitutionId: fk("mutual_institution_id"),
    mutualTaxableIncome: amount("mutual_taxable_income"),
    mutualWorkAccidentContribution: amount("mutual_work_accident_contribution"),
    mutualBranchCode: { type: DataTypes.INTEGER, allowNull: true, field: "mutual_branch_code" },

    afcTaxableIncome: amount("afc_taxable_income"),
    afcWorkerContribution: amount("afc_worker_contribution"),
    afcEmployerContribution: amount("afc_employer_contribution"),

    subsidyPayerInstitutionId: fk("subsidy_payer_institution_id"),
    costCenterLabel: { type: DataTypes.STRING(20), allowNull: true, field: "cost_center_label" },

    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "previred_payroll_lines",
    timestamps: true,
  },
);

PreviredPayrollLineModel.belongsTo(PreviredPayrollModel, { foreignKey: "payrollId", as: "payroll" });
PreviredPayrollModel.hasMany(PreviredPayrollLineModel, { foreignKey: "payrollId", as: "lines" });

PreviredPayrollLineModel.belongsTo(EmployeeModel, { foreignKey: "employeeId", as: "employee" });

// Una asociacion por cada FK a previsional_institutions: el alias es lo que
// permite incluirlas por separado (una linea tiene AFP, salud, CCAF, mutual y
// pagador de subsidio distintos a la vez).
PreviredPayrollLineModel.belongsTo(PrevisionalInstitutionModel, { foreignKey: "afpInstitutionId", as: "afp" });
PreviredPayrollLineModel.belongsTo(PrevisionalInstitutionModel, { foreignKey: "healthInstitutionId", as: "healthInstitution" });
PreviredPayrollLineModel.belongsTo(PrevisionalInstitutionModel, { foreignKey: "ccafInstitutionId", as: "ccaf" });
PreviredPayrollLineModel.belongsTo(PrevisionalInstitutionModel, { foreignKey: "mutualInstitutionId", as: "mutual" });
PreviredPayrollLineModel.belongsTo(PrevisionalInstitutionModel, { foreignKey: "subsidyPayerInstitutionId", as: "subsidyPayer" });
PreviredPayrollLineModel.belongsTo(ApvInstitutionModel, { foreignKey: "apviInstitutionId", as: "apviInstitution" });
PreviredPayrollLineModel.belongsTo(ApvInstitutionModel, { foreignKey: "apvcInstitutionId", as: "apvcInstitution" });
