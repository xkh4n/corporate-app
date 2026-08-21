import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PersonModel } from "./person.model";

// Extiende persons 1:1 (mismo patron que users -> persons). No repite
// rut/dni: persons.documentId ya cubre eso, agregarlo de nuevo aca hubiera
// sido un campo redundante frente al draft original del usuario.
// costCenterId es una referencia cross-engine hacia cost_centers en
// Postgres, sin FK real -se valida a mano en la capa de servicio.
export class EmployeeModel extends Model<InferAttributes<EmployeeModel>, InferCreationAttributes<EmployeeModel>> {
  declare id: CreationOptional<number>;
  declare personId: number;
  declare employeeCode: string;
  declare costCenterId: number;
  // ObjectId de Mongo (coleccion positions) en formato string -cross-engine,
  // sin FK real, se valida a mano en services/mssql/employee.service.ts
  // contra position.service.ts. NULL solo en colaboradores creados antes de
  // que existiera el cargo (ver migrate.ts).
  declare positionId: string | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

EmployeeModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    personId: { type: DataTypes.INTEGER, allowNull: false, unique: true, field: "person_id" },
    employeeCode: { type: DataTypes.STRING(20), allowNull: false, unique: true, field: "employee_code" },
    costCenterId: { type: DataTypes.INTEGER, allowNull: false, field: "cost_center_id" },
    positionId: { type: DataTypes.STRING(24), allowNull: true, field: "position_id" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "employees",
    timestamps: true,
  },
);

EmployeeModel.belongsTo(PersonModel, { foreignKey: "personId", as: "person" });
PersonModel.hasOne(EmployeeModel, { foreignKey: "personId", as: "employee" });
