import { Schema, model, Document } from "mongoose";
import { idJsonTransform } from "../../library/mongoSchema";

// Cargos/funciones a los que se asigna un colaborador (Employee) -vive en
// Mongo por el mismo motivo que ProductCategory: catalogo de negocio con
// forma libre (funciones/habilidades como listas abiertas), no una entidad
// transaccional. Ver memoria project-erp-scope-and-data-classification.
export interface PositionDocument extends Document {
  title: string;
  description: string;
  responsibilities: string[];
  technicalSkills: string[];
  softSkills: string[];
  reportsTo: string | null;
  supervises: string | null;
  // Apunta a roles.id en Postgres: sin FK real (motores distintos), se
  // valida a mano en services/mongo/position.service.ts contra role.service
  // (mismo criterio que UserModel.roleId, ver models/mssql/user.model.ts).
  roleId: number;
  createdAt: Date;
  updatedAt: Date;
}

const positionSchema = new Schema<PositionDocument>(
  {
    title: { type: String, required: true, trim: true, unique: true },
    description: { type: String, required: true },
    responsibilities: { type: [String], required: true, default: [] },
    technicalSkills: { type: [String], default: [] },
    softSkills: { type: [String], default: [] },
    reportsTo: { type: String, default: null },
    supervises: { type: String, default: null },
    roleId: { type: Number, required: true },
  },
  { timestamps: true, collection: "positions", toJSON: idJsonTransform },
);

export const PositionModel = model<PositionDocument>("Position", positionSchema);
