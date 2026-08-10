import { Op } from "sequelize";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StateModel } from "../../models/mssql/state.model";
import { CityModel } from "../../models/mssql/city.model";
import { NotFoundError, isUniqueConstraintError, isDuplicateMssqlObjectError } from "../../library/errors";
import { logger } from "../../library/logger";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { StateCreationAttributes } from "../../types/mssql/state.types";

// "ciudad" en states.json es el iata_code de cities (ej. "ARI" para Arica),
// no un FK numerico. Ver memoria project-erp-scope-and-data-classification
// sobre por que "states" es el nivel administrativo mas bajo (comuna en
// Chile), no un "estado" tipo EEUU.
interface StateSeedRow {
  cod_territorial: string;
  cod_postal: string;
  name_comuna: string;
  ciudad: string;
  cod_sii: string;
}

const SEARCH_FIELDS = ["nameState", "territorialCode", "postalCode", "siiCode"];

export async function listStates(params: PaginationParams): Promise<{ items: StateModel[]; total: number }> {
  const { rows, count } = await StateModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getStateById(id: number): Promise<StateModel | null> {
  return StateModel.findByPk(id);
}

export async function getStateByIdOrThrow(id: number): Promise<StateModel> {
  const state = await getStateById(id);
  if (!state) throw new NotFoundError(`El estado/comuna ${id} no existe`);
  return state;
}

export async function seedStates(): Promise<void> {
  const existing = await StateModel.count();
  if (existing > 0) return;

  const path = join(__dirname, "../../databases/seed-data/states.json");
  const rows: StateSeedRow[] = JSON.parse(readFileSync(path, "utf-8"));

  const cities = await CityModel.findAll();
  const cityIdByIataCode = new Map(cities.map((c) => [c.iataCodes, c.id]));

  const toInsert: StateCreationAttributes[] = [];
  let skipped = 0;
  for (const row of rows) {
    const cityId = cityIdByIataCode.get(row.ciudad);
    if (!cityId) {
      skipped += 1;
      continue;
    }
    toInsert.push({
      territorialCode: row.cod_territorial,
      postalCode: row.cod_postal,
      siiCode: row.cod_sii,
      nameState: row.name_comuna,
      cityId,
    });
  }

  // Ver el mismo comentario en city.service.ts: si cities todavia no existia
  // (otra replica corriendo seedCities en paralelo), esto se reintenta solo
  // en el proximo arranque -la tabla queda en 0, no con datos a medias.
  if (toInsert.length === 0 && rows.length > 0) {
    logger.warn(
      { skipped },
      "Seed de states no encontro ningun city_id valido -probable carrera entre replicas, se reintentara en el proximo arranque",
    );
    return;
  }

  try {
    await StateModel.bulkCreate(toInsert);
    logger.info({ count: toInsert.length, skipped }, "Seed de states aplicado");
  } catch (err) {
    // Ver comentario equivalente en country.service.ts: bulkCreate en MSSQL
    // no normaliza la violacion de UNIQUE a SequelizeUniqueConstraintError.
    if (!isUniqueConstraintError(err) && !isDuplicateMssqlObjectError(err)) throw err;
    logger.debug("Seed de states ya aplicado por otra replica, se omite");
  }
}
