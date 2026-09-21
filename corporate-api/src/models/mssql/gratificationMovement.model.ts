import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { EmployeeModel } from "./employee.model";
import { EmployeeContractModel } from "./employeeContract.model";

// ANTICIPO: adelanto mensual. RELIQUIDACION: cuadre contra el derecho anual en
// el mes pactado. PAGO: gratificacion pagada directamente (modo MENSUAL o ANUAL).
export type GratificationMovementType = "ANTICIPO" | "RELIQUIDACION" | "PAGO";
// CALCULADO: existe pero aun no va en una liquidacion. PAGADO: incluido en una
// liquidacion. RELIQUIDADO: anticipo ya cuadrado por una reliquidacion.
// ANULADO: dejado sin efecto (no se borra: es historial de remuneraciones).
export type GratificationMovementStatus = "CALCULADO" | "PAGADO" | "RELIQUIDADO" | "ANULADO";

// Una fila por (contrato, periodo, tipo): lo que la liquidacion muestra en su
// seccion de gratificacion. Es la fuente de los cuatro conceptos que la
// liquidacion necesita (base de gratificacion, gratificacion, anticipo,
// reliquidacion) -se suman desde aca, no se duplican en la liquidacion.
export class GratificationMovementModel extends Model<
  InferAttributes<GratificationMovementModel>,
  InferCreationAttributes<GratificationMovementModel>
> {
  declare id: CreationOptional<number>;
  declare employeeId: number;
  declare contractId: number;
  // Primer dia del mes (2026-09-01).
  declare period: string;
  declare type: GratificationMovementType;
  // Remuneracion sobre la que se calcula (en pesos).
  declare calculationBase: number;
  // Porcentaje aplicado, copiado del contrato al calcular (foto: un cambio
  // posterior del contrato no debe alterar movimientos ya emitidos).
  declare percentage: number;
  declare calculatedAmount: number;
  declare paidAmount: CreationOptional<number>;
  // Factor de reajuste por IPC aplicado a un anticipo al reliquidarlo; NULL si
  // no se reajusto. adjustedAmount = paidAmount * ipcFactor, redondeado.
  declare ipcFactor: number | null;
  declare adjustedAmount: number | null;
  declare status: CreationOptional<GratificationMovementStatus>;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

GratificationMovementModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    employeeId: { type: DataTypes.INTEGER, allowNull: false, field: "employee_id" },
    contractId: { type: DataTypes.INTEGER, allowNull: false, field: "contract_id" },
    period: { type: DataTypes.DATEONLY, allowNull: false },
    type: { type: DataTypes.STRING(15), allowNull: false },
    calculationBase: { type: DataTypes.INTEGER, allowNull: false, field: "calculation_base" },
    percentage: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
    calculatedAmount: { type: DataTypes.INTEGER, allowNull: false, field: "calculated_amount" },
    paidAmount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "paid_amount" },
    ipcFactor: { type: DataTypes.DECIMAL(9, 6), allowNull: true, field: "ipc_factor" },
    adjustedAmount: { type: DataTypes.INTEGER, allowNull: true, field: "adjusted_amount" },
    status: { type: DataTypes.STRING(15), allowNull: false, defaultValue: "CALCULADO" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "gratification_movements",
    timestamps: true,
  },
);

GratificationMovementModel.belongsTo(EmployeeModel, { foreignKey: "employeeId", as: "employee" });
GratificationMovementModel.belongsTo(EmployeeContractModel, { foreignKey: "contractId", as: "contract" });
EmployeeContractModel.hasMany(GratificationMovementModel, { foreignKey: "contractId", as: "gratificationMovements" });
