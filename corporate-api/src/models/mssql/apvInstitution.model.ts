import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";

// Tabla N°11 de Previred (instituciones autorizadas APVI/APVC). Catalogo
// aparte de previsional_institutions porque usa OTRO codigo: la misma AFP es
// "03" como AFP (Tabla 10) y "003" como institucion APV (Tabla 11), y las
// aseguradoras/fondos mutuos/corredoras no son AFP/salud/CCAF de ningun tipo.
export type ApvInstitutionGroup = "AFP" | "SEGUROS_VIDA" | "FONDOS_MUTUOS" | "CORREDORES_BOLSA";

export class ApvInstitutionModel extends Model<
  InferAttributes<ApvInstitutionModel>,
  InferCreationAttributes<ApvInstitutionModel>
> {
  declare id: CreationOptional<number>;
  // 3 digitos con cero a la izquierda ("003"). "000" (No cotiza APV) no se
  // guarda: es el valor que el generador escribe cuando no hay APV.
  declare previredCode: string;
  declare name: string;
  declare institutionGroup: ApvInstitutionGroup;
  declare isActive: CreationOptional<boolean>;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

ApvInstitutionModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    previredCode: { type: DataTypes.STRING(3), allowNull: false, unique: true, field: "previred_code" },
    name: { type: DataTypes.STRING(150), allowNull: false },
    institutionGroup: { type: DataTypes.STRING(20), allowNull: false, field: "institution_group" },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "apv_institutions",
    timestamps: true,
  },
);
