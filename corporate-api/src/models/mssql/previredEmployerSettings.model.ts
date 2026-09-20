import {
  CreationOptional,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
  NonAttribute,
} from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PrevisionalInstitutionModel } from "./previsionalInstitution.model";

// Configuracion del EMPLEADOR (una sola fila): la CCAF y la mutual son de la
// empresa, no del trabajador -Previred las exige igual en cada linea del
// archivo (campos 83 y 96, "Obligatorio para todos los trabajadores si la
// empresa esta adherida") y rechaza si difieren de lo configurado en su
// portal. Guardarlas por trabajador dejaria posible que dos filas discrepen.
//
// El unico registro se fuerza en migrate.ts: id NO es IDENTITY, tiene DEFAULT 1
// y CHECK (id = 1), asi que una segunda fila es imposible a nivel de motor. El
// servicio que se agregue despues debe hacer upsert sobre id = 1.
export class PreviredEmployerSettingsModel extends Model<
  InferAttributes<PreviredEmployerSettingsModel>,
  InferCreationAttributes<PreviredEmployerSettingsModel>
> {
  declare id: CreationOptional<number>;
  // NULL = empresa sin CCAF (Previred codigo 00).
  declare ccafInstitutionId: number | null;
  // NULL o ISL (codigo 00) = el aporte de accidentes del trabajo va al ISL
  // (campo 71) en vez de a una mutual (campo 98).
  declare mutualInstitutionId: number | null;
  // Sucursal para pago mutual (campo 99, 9(3)), asignada por la mutual.
  declare mutualBranchCode: number | null;
  // Tasa total de accidentes del trabajo: base + adicional + Ley SANNA, la
  // informa la mutual/ISL a cada empresa. Porcentaje, ej. 0.9300.
  declare workAccidentRate: number | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;

  // Solo presentes si la query las incluye (include: [{ as: "ccaf" }, ...]).
  declare ccaf?: NonAttribute<PrevisionalInstitutionModel>;
  declare mutual?: NonAttribute<PrevisionalInstitutionModel>;
}

PreviredEmployerSettingsModel.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
    ccafInstitutionId: { type: DataTypes.INTEGER, allowNull: true, field: "ccaf_institution_id" },
    mutualInstitutionId: { type: DataTypes.INTEGER, allowNull: true, field: "mutual_institution_id" },
    mutualBranchCode: { type: DataTypes.INTEGER, allowNull: true, field: "mutual_branch_code" },
    workAccidentRate: { type: DataTypes.DECIMAL(7, 4), allowNull: true, field: "work_accident_rate" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "previred_employer_settings",
    timestamps: true,
  },
);

PreviredEmployerSettingsModel.belongsTo(PrevisionalInstitutionModel, {
  foreignKey: "ccafInstitutionId",
  as: "ccaf",
});
PreviredEmployerSettingsModel.belongsTo(PrevisionalInstitutionModel, {
  foreignKey: "mutualInstitutionId",
  as: "mutual",
});
