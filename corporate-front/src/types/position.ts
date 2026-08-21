// Espejo de corporate-api/src/models/mongo/position.model.ts (PositionAttributes).
// Excepcion Mongo: id es ObjectId de 24 caracteres (string), no number.
export interface Position {
  id: string;
  title: string;
  description: string;
  responsibilities: string[];
  technicalSkills: string[];
  softSkills: string[];
  reportsTo: string | null;
  supervises: string | null;
  roleId: number;
  createdAt: string;
  updatedAt: string;
}

export interface PositionCreateInput {
  title: string;
  description: string;
  responsibilities: string[];
  technicalSkills?: string[];
  softSkills?: string[];
  reportsTo?: string;
  supervises?: string;
  roleId: number;
}

export type PositionUpdateInput = Partial<PositionCreateInput>;
