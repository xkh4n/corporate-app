import { Op } from "sequelize";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CountryModel } from "../../models/mssql/country.model";
import { ConflictError, NotFoundError, isUniqueConstraintError } from "../../library/errors";
import { logger } from "../../library/logger";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { CountryCreationAttributes, CountryUpdateAttributes } from "../../types/mssql/country.types";

interface CountrySeedRow {
  iso_code: string;
  name_pais: string;
  iata_code: string;
}

const SEARCH_FIELDS = ["isoCode", "iataCode", "nameCountry"];

export async function listCountries(params: PaginationParams): Promise<{ items: CountryModel[]; total: number }> {
  const { rows, count } = await CountryModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getCountryById(id: number): Promise<CountryModel | null> {
  return CountryModel.findByPk(id);
}

export async function getCountryByIdOrThrow(id: number): Promise<CountryModel> {
  const country = await getCountryById(id);
  if (!country) throw new NotFoundError(`El pais ${id} no existe`);
  return country;
}

export async function getCountryByIsoCode(isoCode: string): Promise<CountryModel | null> {
  return CountryModel.findOne({ where: { isoCode } });
}

export async function getCountryByIataCode(iataCode: string): Promise<CountryModel | null> {
  return CountryModel.findOne({ where: { iataCode } });
}

export async function createCountry(data: CountryCreationAttributes): Promise<CountryModel> {
  const existing = await getCountryByIsoCode(data.isoCode);
  if (existing) throw new ConflictError(`Ya existe el pais con iso_code '${data.isoCode}'`);
  return CountryModel.create(data);
}

export async function updateCountry(id: number, data: CountryUpdateAttributes): Promise<CountryModel> {
  const country = await getCountryByIdOrThrow(id);
  if (data.isoCode && data.isoCode !== country.isoCode) {
    const existing = await getCountryByIsoCode(data.isoCode);
    if (existing) throw new ConflictError(`Ya existe el pais con iso_code '${data.isoCode}'`);
  }
  await country.update(data);
  return country;
}

// Datos de referencia (initial-data/countries.json, ver memoria
// project-erp-scope-and-data-classification): se puebla una sola vez, en el
// primer arranque -si la tabla ya tiene datos, no se toca (no pisa cambios
// manuales que se hayan hecho despues via CRUD).
export async function seedCountries(): Promise<void> {
  const existing = await CountryModel.count();
  if (existing > 0) return;

  const path = join(__dirname, "../../databases/seed-data/countries.json");
  const rows: CountrySeedRow[] = JSON.parse(readFileSync(path, "utf-8"));

  try {
    await CountryModel.bulkCreate(
      rows.map((row) => ({
        isoCode: row.iso_code,
        nameCountry: row.name_pais,
        iataCode: row.iata_code,
      })),
    );
    logger.info({ count: rows.length }, "Seed de countries aplicado");
  } catch (err) {
    // Otra replica ya gano la carrera e inserto esta misma data primero.
    if (!isUniqueConstraintError(err)) throw err;
    logger.debug("Seed de countries ya aplicado por otra replica, se omite");
  }
}
