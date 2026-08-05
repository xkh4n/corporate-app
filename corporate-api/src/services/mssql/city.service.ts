import { Op } from "sequelize";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CityModel } from "../../models/mssql/city.model";
import { CountryModel } from "../../models/mssql/country.model";
import { NotFoundError, isUniqueConstraintError } from "../../library/errors";
import { logger } from "../../library/logger";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { CityCreationAttributes, CityUpdateAttributes } from "../../types/mssql/city.types";

// OJO: en cities.json el campo se llama "iso_code" pero en realidad contiene
// el iata_code (3 letras) del pais, no su iso_code (2 letras) -confirmado
// contra countries.json antes de escribir el seed: "CHL" hace match con
// countries.iata_code, no con countries.iso_code ("CL"). Ver memoria
// project-erp-scope-and-data-classification.
interface CitySeedRow {
  iata_code: string;
  name_city: string;
  iso_code: string;
}

const SEARCH_FIELDS = ["nameCity", "iataCodes"];

export async function listCities(params: PaginationParams): Promise<{ items: CityModel[]; total: number }> {
  const { rows, count } = await CityModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getCityById(id: number): Promise<CityModel | null> {
  return CityModel.findByPk(id);
}

export async function getCityByIdOrThrow(id: number): Promise<CityModel> {
  const city = await getCityById(id);
  if (!city) throw new NotFoundError(`La ciudad ${id} no existe`);
  return city;
}

export async function getCityByIataCode(iataCode: string): Promise<CityModel | null> {
  return CityModel.findOne({ where: { iataCodes: iataCode } });
}

export async function createCity(data: CityCreationAttributes): Promise<CityModel> {
  return CityModel.create(data);
}

export async function updateCity(id: number, data: CityUpdateAttributes): Promise<CityModel> {
  const city = await getCityByIdOrThrow(id);
  await city.update(data);
  return city;
}

export async function seedCities(): Promise<void> {
  const existing = await CityModel.count();
  if (existing > 0) return;

  const path = join(__dirname, "../../databases/seed-data/cities.json");
  const rows: CitySeedRow[] = JSON.parse(readFileSync(path, "utf-8"));

  const countries = await CountryModel.findAll();
  const countryIdByIataCode = new Map(countries.map((c) => [c.iataCode, c.id]));

  const toInsert: CityCreationAttributes[] = [];
  let skipped = 0;
  for (const row of rows) {
    const countryId = countryIdByIataCode.get(row.iso_code);
    if (!countryId) {
      skipped += 1;
      continue;
    }
    toInsert.push({ iataCodes: row.iata_code, nameCity: row.name_city, countryId });
  }

  // Si countries todavia no existia cuando esta replica llego aca (otra
  // replica corriendo seedCountries en paralelo, ver isUniqueConstraintError
  // mas abajo), toInsert queda vacio -bulkCreate([]) es un no-op y la tabla
  // sigue en 0, asi que la proxima vez que arranque el stack se vuelve a
  // intentar (count() === 0 todavia). No es un error fatal, pero se deja
  // como warning para que sea diagnosticable si se repite seguido.
  if (toInsert.length === 0 && rows.length > 0) {
    logger.warn(
      { skipped },
      "Seed de cities no encontro ningun country_id valido -probable carrera entre replicas, se reintentara en el proximo arranque",
    );
    return;
  }

  try {
    await CityModel.bulkCreate(toInsert);
    logger.info({ count: toInsert.length, skipped }, "Seed de cities aplicado");
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    logger.debug("Seed de cities ya aplicado por otra replica, se omite");
  }
}
