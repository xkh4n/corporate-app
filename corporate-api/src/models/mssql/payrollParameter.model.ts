import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";

// Parametros MONETARIOS versionados por vigencia (a diferencia de
// previsional_rates, que guarda porcentajes 0-100). Hoy solo IMM (ingreso
// minimo mensual, base del tope de la gratificacion: 4,75 IMM). Otros valores
// que cambian con el tiempo (UF, UTM, IPC) entran aca cuando un calculo los
// necesite -no se siembra ninguno: el valor vigente lo informa el usuario.
export type PayrollParameterCode = "IMM";

export class PayrollParameterModel extends Model<
  InferAttributes<PayrollParameterModel>,
  InferCreationAttributes<PayrollParameterModel>
> {
  declare id: CreationOptional<number>;
  declare code: PayrollParameterCode;
  // Pesos para IMM. tedious devuelve DECIMAL como number.
  declare value: number;
  declare validFrom: string;
  // NULL = vigente hasta nuevo aviso. Al registrar un valor nuevo el servicio
  // cierra el anterior el dia previo a valid_from.
  declare validTo: string | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PayrollParameterModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    code: { type: DataTypes.STRING(30), allowNull: false },
    value: { type: DataTypes.DECIMAL(14, 4), allowNull: false },
    validFrom: { type: DataTypes.DATEONLY, allowNull: false, field: "valid_from" },
    validTo: { type: DataTypes.DATEONLY, allowNull: true, field: "valid_to" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "payroll_parameters",
    timestamps: true,
  },
);
