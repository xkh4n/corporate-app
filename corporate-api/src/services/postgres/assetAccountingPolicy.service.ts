import { QueryTypes, type Transaction } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { BadRequestError, ConflictError, NotFoundError, isUniqueConstraintError } from "../../library/errors";
import type { DepreciationMethod } from "../../library/depreciation";

// Politica contable de activos (plan 007): umbral de capitalizacion (una sola
// fila) y clases de activo con sus valores por defecto de depreciacion.

export interface AccountingPolicy {
  capitalizationThreshold: string;
  updatedBy: number | null;
  updatedAt: Date;
}

export interface AccountingClass {
  id: number;
  code: string;
  name: string;
  usefulLifeMonths: number;
  defaultMethod: DepreciationMethod;
  residualRate: string;
  isActive: boolean;
}

const CLASS_COLUMNS = `
  id, code, name, useful_life_months AS "usefulLifeMonths", default_method AS "defaultMethod",
  residual_rate::text AS "residualRate", is_active AS "isActive"
`;

export async function getPolicy(transaction?: Transaction): Promise<AccountingPolicy> {
  const [row] = await postgres.query<AccountingPolicy>(
    `SELECT capitalization_threshold::text AS "capitalizationThreshold", updated_by AS "updatedBy", updated_at AS "updatedAt"
       FROM asset_accounting_policy WHERE id = 1`,
    { type: QueryTypes.SELECT, transaction },
  );
  if (!row) throw new NotFoundError("No existe la politica contable de activos (revise la migracion)");
  return row;
}

export async function updatePolicy(capitalizationThreshold: number, userId: number): Promise<AccountingPolicy> {
  await postgres.query(
    `UPDATE asset_accounting_policy
        SET capitalization_threshold = :threshold, updated_by = :userId, updated_at = now()
      WHERE id = 1`,
    { replacements: { threshold: capitalizationThreshold.toFixed(2), userId } },
  );
  return getPolicy();
}

export async function listClasses(includeInactive: boolean): Promise<AccountingClass[]> {
  return postgres.query<AccountingClass>(
    `SELECT ${CLASS_COLUMNS} FROM asset_accounting_classes
      ${includeInactive ? "" : "WHERE is_active = true"}
      ORDER BY name`,
    { type: QueryTypes.SELECT },
  );
}

export async function getClassOrThrow(id: number, transaction?: Transaction): Promise<AccountingClass> {
  const [row] = await postgres.query<AccountingClass>(
    `SELECT ${CLASS_COLUMNS} FROM asset_accounting_classes WHERE id = :id`,
    { replacements: { id }, type: QueryTypes.SELECT, transaction },
  );
  if (!row) throw new NotFoundError(`La clase contable ${id} no existe`);
  return row;
}

export interface ClassInput {
  code: string;
  name: string;
  usefulLifeMonths: number;
  defaultMethod: DepreciationMethod;
  residualRate: number;
  isActive?: boolean;
}

function assertClassRules(input: Partial<ClassInput>): void {
  if (input.residualRate !== undefined && (input.residualRate < 0 || input.residualRate >= 1)) {
    throw new BadRequestError("La tasa residual debe estar entre 0 y menos de 1 (ej. 0,1 = 10%)");
  }
}

export async function createClass(input: ClassInput): Promise<AccountingClass> {
  assertClassRules(input);
  try {
    const [row] = await postgres.query<AccountingClass>(
      `INSERT INTO asset_accounting_classes (code, name, useful_life_months, default_method, residual_rate, is_active)
       VALUES (:code, :name, :usefulLifeMonths, :defaultMethod, :residualRate, :isActive)
       RETURNING ${CLASS_COLUMNS}`,
      {
        replacements: { ...input, residualRate: input.residualRate.toFixed(4), isActive: input.isActive ?? true },
        type: QueryTypes.SELECT,
      },
    );
    if (!row) throw new Error("INSERT de clase contable sin RETURNING");
    return row;
  } catch (err) {
    if (isUniqueConstraintError(err) || (err as { parent?: { code?: string } }).parent?.code === "23505") {
      throw new ConflictError(`Ya existe una clase con el codigo '${input.code}'`);
    }
    throw err;
  }
}

// El codigo no se cambia: es la clave estable de la clase.
export async function updateClass(id: number, input: Partial<Omit<ClassInput, "code">>): Promise<AccountingClass> {
  assertClassRules(input);
  const current = await getClassOrThrow(id);
  const next = {
    name: input.name ?? current.name,
    usefulLifeMonths: input.usefulLifeMonths ?? current.usefulLifeMonths,
    defaultMethod: input.defaultMethod ?? current.defaultMethod,
    residualRate: input.residualRate !== undefined ? input.residualRate.toFixed(4) : current.residualRate,
    isActive: input.isActive ?? current.isActive,
  };
  await postgres.query(
    `UPDATE asset_accounting_classes
        SET name = :name, useful_life_months = :usefulLifeMonths, default_method = :defaultMethod,
            residual_rate = :residualRate, is_active = :isActive, updated_at = now()
      WHERE id = :id`,
    { replacements: { ...next, id } },
  );
  return getClassOrThrow(id);
}
