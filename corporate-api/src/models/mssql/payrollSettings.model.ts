import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";

// ART47: gratificacion por participacion en utilidades (30% de las utilidades
// liquidas). ART50: la empresa opta por pagar el 25% de las remuneraciones
// mensuales devengadas, con tope de 4,75 IMM. CONVENCIONAL: la pactada en el
// contrato. Un contrato lleva su propio tipo (ver employeeContract.model.ts);
// este es el valor de la EMPRESA, con el que se pre-llena el alta.
export type GratificationType = "ART47" | "ART50" | "CONVENCIONAL";

// Configuracion de remuneraciones de la EMPRESA (una sola fila, id = 1, mismo
// criterio que previred_employer_settings: PK sin IDENTITY + CHECK (id = 1)).
export class PayrollSettingsModel extends Model<
  InferAttributes<PayrollSettingsModel>,
  InferCreationAttributes<PayrollSettingsModel>
> {
  declare id: CreationOptional<number>;
  // NULL = la empresa todavia no define su sistema de gratificacion.
  declare gratificationSystem: GratificationType | null;
  // % del sueldo base que se anticipa cada mes de gratificacion. Con el se
  // calcula en pesos el anticipo del contrato al crear el colaborador (cada
  // contrato guarda su propio monto). NULL = la empresa no define uno.
  declare gratificationMonthlyAdvancePercentage: number | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PayrollSettingsModel.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
    gratificationSystem: { type: DataTypes.STRING(15), allowNull: true, field: "gratification_system" },
    gratificationMonthlyAdvancePercentage: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      field: "gratification_monthly_advance_percentage",
    },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "payroll_settings",
    timestamps: true,
  },
);
