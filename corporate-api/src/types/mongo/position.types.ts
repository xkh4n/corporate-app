export interface PositionAttributes {
  id: string;
  title: string;
  description: string;
  responsibilities: string[];
  technicalSkills: string[];
  softSkills: string[];
  reportsTo: string | null;
  supervises: string | null;
  // Rol del sistema que se asigna por defecto a quien ocupe este cargo. Ver
  // roleId en position.model.ts.
  roleId: number;
  createdAt: Date;
  updatedAt: Date;
}

export type PositionCreationAttributes = Pick<
  PositionAttributes,
  "title" | "description" | "responsibilities" | "roleId"
> &
  Partial<Pick<PositionAttributes, "technicalSkills" | "softSkills" | "reportsTo" | "supervises">>;

export type PositionUpdateAttributes = Partial<
  Pick<
    PositionAttributes,
    | "title"
    | "description"
    | "responsibilities"
    | "technicalSkills"
    | "softSkills"
    | "reportsTo"
    | "supervises"
    | "roleId"
  >
>;
