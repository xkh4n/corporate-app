import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";

// Un solo catalogo para AFP, salud (FONASA + Isapres), CCAF, mutualidades
// (incluye ISL, codigo Previred 00) y AFC, en vez de una tabla por tipo:
// todas comparten los mismos campos (RUT, nombre, codigo Previred) y los
// codigos Previred se REPITEN entre tipos (01 existe en salud, CCAF y mutual),
// por eso la unicidad es (type, previred_code) y no previred_code solo.
//
// Los porcentajes NO viven aca: cambian con el tiempo (comision AFP, tasa de
// mutual) y una columna pisaria el historico -ver previsionalRate.model.ts.
export type PrevisionalInstitutionType = "AFP" | "SALUD" | "CCAF" | "MUTUAL" | "CESANTIA";

export class PrevisionalInstitutionModel extends Model<
  InferAttributes<PrevisionalInstitutionModel>,
  InferCreationAttributes<PrevisionalInstitutionModel>
> {
  declare id: CreationOptional<number>;
  declare type: PrevisionalInstitutionType;
  declare code: string;
  declare name: string;
  // Formato canonico "98000000-1" (sin puntos). Previred pide cuerpo y DV en
  // campos separados (RUT Pagadora Subsidio, campos 103/104): se parte al
  // generar el archivo. NULL en las CCAF y en AFC (sin RUT en la fuente).
  declare nationalId: string | null;
  // Codigo de las Tablas de Equivalencia de Previred (10 AFP, 16 salud,
  // 18 CCAF, 19 mutual), con cero a la izquierda ("03", no 3) -es texto.
  // NULL en AFC: Previred no le asigna codigo.
  declare previredCode: string | null;
  declare address: string | null;
  declare phone: string | null;
  declare legalRepresentative: string | null;
  declare isActive: CreationOptional<boolean>;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PrevisionalInstitutionModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    type: { type: DataTypes.STRING(20), allowNull: false },
    code: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    nationalId: { type: DataTypes.STRING(20), allowNull: true, field: "national_id" },
    previredCode: { type: DataTypes.STRING(4), allowNull: true, field: "previred_code" },
    address: { type: DataTypes.STRING(255), allowNull: true },
    phone: { type: DataTypes.STRING(30), allowNull: true },
    legalRepresentative: { type: DataTypes.STRING(150), allowNull: true, field: "legal_representative" },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "previsional_institutions",
    timestamps: true,
  },
);
