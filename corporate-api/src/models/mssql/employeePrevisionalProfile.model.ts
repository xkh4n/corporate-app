import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
  NonAttribute,
} from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { EmployeeModel } from "./employee.model";
import { PrevisionalInstitutionModel } from "./previsionalInstitution.model";

// Tabla 4 de Previred
export type PrevisionalRegime = "AFP" | "INP" | "SIP";
// Tabla 5: 0 activo, 1 pensionado y cotiza, 2 pensionado sin cotizar o
// invalidez total, 3 activo desde los 65 (nunca pensionado), 8 exento de
// cotizar, 9 pensionado por invalidez parcial.
export type PrevisionalWorkerType = 0 | 1 | 2 | 3 | 8 | 9;
// Tabla 8
export type FamilyAllowanceBracket = "A" | "B" | "C" | "D";
// Tabla 22
export type WorkdayType = 1 | 2;
// Tabla 17
export type HealthPlanCurrency = 1 | 2;

// Afiliacion previsional VIGENTE del colaborador (1:1 con employees, mismo
// patron que employees -> persons). Es la fuente de la que se copian los datos
// a cada previred_payroll_lines: la linea guarda una FOTO del periodo, asi que
// cambiar de AFP o de isapre aca no altera planillas ya generadas.
//
// La fila nace cuando se asigna la primera pieza (AFP o salud) y se completa
// de a poco: regimen y tipo de trabajador son NULL hasta entonces.
// Que el perfil este completo lo valida el generador de la nomina, no la BD.
// Apellidos, sexo y nacionalidad (campos 3-7) viven en persons; tipo de contrato
// y fecha de inicio (seguro de cesantia) viven en employee_contracts.
//
// CCAF y mutual NO estan aca: son de la empresa (previred_employer_settings) y
// el trabajador las hereda al armar cada linea de la nomina.
export class EmployeePrevisionalProfileModel extends Model<
  InferAttributes<EmployeePrevisionalProfileModel>,
  InferCreationAttributes<EmployeePrevisionalProfileModel>
> {
  declare id: CreationOptional<number>;
  declare employeeId: number;

  // --- Regimen (campos 11, 12) ---
  declare regime: PrevisionalRegime | null;
  declare workerType: PrevisionalWorkerType | null;

  // --- Instituciones (FK reales a previsional_institutions) ---
  declare afpInstitutionId: number | null;
  declare healthInstitutionId: number | null;

  // --- Plan de salud Isapre (campos 76, 78, 79). NULL si esta en FONASA ---
  declare healthFun: string | null;
  declare healthPlanCurrency: HealthPlanCurrency | null;
  // Monto pactado en pesos o UF segun la moneda; admite hasta 4 decimales
  // (ej. UF 004,0241). Es lo PACTADO -la cotizacion adicional se calcula al
  // generar la linea como pactado - 7%, no se guarda aca.
  declare healthAgreedAmount: number | null;

  // --- Seguro de cesantia (campos 100-102) ---
  // false = sin seguro de cesantia (ej. pensionado, contrato excluido). Con
  // true, el aporte del trabajador cesa a los 11 anos con el mismo empleador
  // (regla de la doc de Previred, campo 101) -se evalua contra el inicio del
  // contrato (employee_contracts.start_date) al armar la linea.
  declare afcCovered: boolean;

  // --- Asignacion familiar (campos 18-21) ---
  declare familyAllowanceBracket: FamilyAllowanceBracket;
  declare simpleCharges: number;
  declare maternalCharges: number;
  declare disabledCharges: number;

  // --- Otros ---
  declare workdayType: WorkdayType;
  // Trabajo pesado (campos 37-38). NULL si no aplica; la tasa es 2 o 4 (%).
  declare heavyWorkPosition: string | null;
  declare heavyWorkRate: number | null;

  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Solo presentes si la query las incluye (include: [{ as: "afp" }, ...]).
  declare afp?: NonAttribute<PrevisionalInstitutionModel>;
  declare healthInstitution?: NonAttribute<PrevisionalInstitutionModel>;
}

EmployeePrevisionalProfileModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    employeeId: { type: DataTypes.INTEGER, allowNull: false, unique: true, field: "employee_id" },
    regime: { type: DataTypes.STRING(3), allowNull: true },
    workerType: { type: DataTypes.SMALLINT, allowNull: true, field: "worker_type" },
    afpInstitutionId: { type: DataTypes.INTEGER, allowNull: true, field: "afp_institution_id" },
    healthInstitutionId: { type: DataTypes.INTEGER, allowNull: true, field: "health_institution_id" },
    healthFun: { type: DataTypes.STRING(16), allowNull: true, field: "health_fun" },
    healthPlanCurrency: { type: DataTypes.SMALLINT, allowNull: true, field: "health_plan_currency" },
    healthAgreedAmount: { type: DataTypes.DECIMAL(12, 4), allowNull: true, field: "health_agreed_amount" },
    afcCovered: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "afc_covered" },
    familyAllowanceBracket: { type: DataTypes.STRING(1), allowNull: false, defaultValue: "D", field: "family_allowance_bracket" },
    simpleCharges: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0, field: "simple_charges" },
    maternalCharges: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0, field: "maternal_charges" },
    disabledCharges: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0, field: "disabled_charges" },
    workdayType: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 1, field: "workday_type" },
    heavyWorkPosition: { type: DataTypes.STRING(40), allowNull: true, field: "heavy_work_position" },
    heavyWorkRate: { type: DataTypes.DECIMAL(5, 2), allowNull: true, field: "heavy_work_rate" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "employee_previsional_profiles",
    timestamps: true,
  },
);

EmployeePrevisionalProfileModel.belongsTo(EmployeeModel, { foreignKey: "employeeId", as: "employee" });
EmployeeModel.hasOne(EmployeePrevisionalProfileModel, { foreignKey: "employeeId", as: "previsionalProfile" });

EmployeePrevisionalProfileModel.belongsTo(PrevisionalInstitutionModel, {
  foreignKey: "afpInstitutionId",
  as: "afp",
});
EmployeePrevisionalProfileModel.belongsTo(PrevisionalInstitutionModel, {
  foreignKey: "healthInstitutionId",
  as: "healthInstitution",
});
