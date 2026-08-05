import { Op } from "sequelize";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CostCenterModel } from "../../models/postgres/costCenter.model";
import { ConflictError, NotFoundError, isUniqueConstraintError } from "../../library/errors";
import { logger } from "../../library/logger";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { CostCenterCreationAttributes, CostCenterUpdateAttributes } from "../../types/postgres/costCenter.types";

interface CostCenterSeedRow {
  codigo: number;
  nombre: string;
  descripcion: string;
}

// "code" es INTEGER, no participa del search de texto libre (Op.iLike no
// aplica sobre una columna numerica sin cast).
const SEARCH_FIELDS = ["name", "description"];

export async function listCostCenters(
  params: PaginationParams,
): Promise<{ items: CostCenterModel[]; total: number }> {
  const { rows, count } = await CostCenterModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.iLike),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getCostCenterById(id: number): Promise<CostCenterModel | null> {
  return CostCenterModel.findByPk(id);
}

export async function getCostCenterByIdOrThrow(id: number): Promise<CostCenterModel> {
  const costCenter = await getCostCenterById(id);
  if (!costCenter) throw new NotFoundError(`El centro de costo ${id} no existe`);
  return costCenter;
}

export async function getCostCenterByCode(code: number): Promise<CostCenterModel | null> {
  return CostCenterModel.findOne({ where: { code } });
}

export async function createCostCenter(data: CostCenterCreationAttributes): Promise<CostCenterModel> {
  const existing = await getCostCenterByCode(data.code);
  if (existing) throw new ConflictError(`Ya existe el centro de costo con codigo '${data.code}'`);
  return CostCenterModel.create(data);
}

export async function updateCostCenter(id: number, data: CostCenterUpdateAttributes): Promise<CostCenterModel> {
  const costCenter = await getCostCenterByIdOrThrow(id);
  if (data.code !== undefined && data.code !== costCenter.code) {
    const existing = await getCostCenterByCode(data.code);
    if (existing) throw new ConflictError(`Ya existe el centro de costo con codigo '${data.code}'`);
  }
  await costCenter.update(data);
  return costCenter;
}

export async function seedCostCenters(): Promise<void> {
  const existing = await CostCenterModel.count();
  if (existing > 0) return;

  const path = join(__dirname, "../../databases/seed-data/ccostos.json");
  const rows: CostCenterSeedRow[] = JSON.parse(readFileSync(path, "utf-8"));

  try {
    await CostCenterModel.bulkCreate(
      rows.map((row) => ({ code: row.codigo, name: row.nombre, description: row.descripcion })),
    );
    logger.info({ count: rows.length }, "Seed de cost_centers aplicado");
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    logger.debug("Seed de cost_centers ya aplicado por otra replica, se omite");
  }
}
