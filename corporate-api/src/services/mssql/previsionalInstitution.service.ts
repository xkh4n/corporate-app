import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrevisionalInstitutionModel } from "../../models/mssql/previsionalInstitution.model";
import type { PrevisionalInstitutionType } from "../../models/mssql/previsionalInstitution.model";
import { PrevisionalRateModel } from "../../models/mssql/previsionalRate.model";
import type { PrevisionalRateType } from "../../models/mssql/previsionalRate.model";
import { ApvInstitutionModel } from "../../models/mssql/apvInstitution.model";
import type { ApvInstitutionGroup } from "../../models/mssql/apvInstitution.model";
import { BadRequestError, NotFoundError, isUniqueConstraintError, isDuplicateMssqlObjectError } from "../../library/errors";
import { logger } from "../../library/logger";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder } from "../../library/sequelizeSearch";

interface InstitutionSeedRow {
  type: PrevisionalInstitutionType;
  code: string;
  name: string;
  national_id: string | null;
  previred_code: string | null;
  address?: string | null;
  phone?: string | null;
  legal_representative?: string | null;
}

interface ApvSeedRow {
  previred_code: string;
  name: string;
  institution_group: ApvInstitutionGroup;
}

interface RateSeedRow {
  rate_type: PrevisionalRateType;
  institution_code: string | null;
  rate: number;
  valid_from: string;
}

// Solo instituciones activas: es el catalogo que alimenta los combos de
// asignacion (AFP, salud, CCAF, mutual). Una institucion desactivada deja de
// ofrecerse pero las asignaciones ya hechas a ella siguen validas.
export async function listPrevisionalInstitutions(
  params: PaginationParams,
  type?: PrevisionalInstitutionType,
): Promise<{ items: PrevisionalInstitutionModel[]; total: number }> {
  const { rows, count } = await PrevisionalInstitutionModel.findAndCountAll({
    where: { isActive: true, ...(type ? { type } : {}) },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

// La FK no puede garantizar el TIPO de la institucion (una AFP en el campo de
// salud pasaria la FK igual), por eso cada asignacion la valida aca.
export async function getInstitutionOfTypeOrThrow(
  id: number,
  type: PrevisionalInstitutionType,
): Promise<PrevisionalInstitutionModel> {
  const institution = await PrevisionalInstitutionModel.findByPk(id);
  if (!institution) throw new NotFoundError(`La institucion previsional ${id} no existe`);
  if (institution.type !== type || !institution.isActive) {
    throw new BadRequestError(`La institucion ${id} no es una ${type} activa`);
  }
  return institution;
}

function readSeed<T>(file: string): T[] {
  return JSON.parse(readFileSync(join(__dirname, "../../databases/seed-data", file), "utf-8"));
}

// Mismo criterio que country.service.ts (seedCountries): se puebla una sola
// vez, si la tabla ya tiene filas no se toca -no pisa cambios hechos despues
// via CRUD-, y un choque de UNIQUE se interpreta como "otra replica gano la
// carrera" (bulkCreate en MSSQL lo envuelve en un AggregateError, de ahi el
// chequeo doble).
async function seedOnce(label: string, isEmpty: () => Promise<boolean>, insert: () => Promise<number>): Promise<void> {
  if (!(await isEmpty())) return;
  try {
    const count = await insert();
    logger.info({ count }, `Seed de ${label} aplicado`);
  } catch (err) {
    if (!isUniqueConstraintError(err) && !isDuplicateMssqlObjectError(err)) throw err;
    logger.debug(`Seed de ${label} ya aplicado por otra replica, se omite`);
  }
}

export async function seedPrevisionalInstitutions(): Promise<void> {
  await seedOnce(
    "previsional_institutions",
    async () => (await PrevisionalInstitutionModel.count()) === 0,
    async () => {
      const rows = readSeed<InstitutionSeedRow>("previsional-institutions.json");
      await PrevisionalInstitutionModel.bulkCreate(
        rows.map((row) => ({
          type: row.type,
          code: row.code,
          name: row.name,
          nationalId: row.national_id,
          previredCode: row.previred_code,
          address: row.address ?? null,
          phone: row.phone ?? null,
          legalRepresentative: row.legal_representative ?? null,
          createdBy: null,
          updatedBy: null,
        })),
      );
      return rows.length;
    },
  );
}

export async function seedApvInstitutions(): Promise<void> {
  await seedOnce(
    "apv_institutions",
    async () => (await ApvInstitutionModel.count()) === 0,
    async () => {
      const rows = readSeed<ApvSeedRow>("apv-institutions.json");
      await ApvInstitutionModel.bulkCreate(
        rows.map((row) => ({
          previredCode: row.previred_code,
          name: row.name,
          institutionGroup: row.institution_group,
          createdBy: null,
          updatedBy: null,
        })),
      );
      return rows.length;
    },
  );
}

// Depende de seedPrevisionalInstitutions (resuelve institution_code -> id), por
// eso seedPrevisional() en seed.ts las llama en orden y no en paralelo.
export async function seedPrevisionalRates(): Promise<void> {
  await seedOnce(
    "previsional_rates",
    async () => (await PrevisionalRateModel.count()) === 0,
    async () => {
      const rows = readSeed<RateSeedRow>("previsional-rates.json");
      const institutions = await PrevisionalInstitutionModel.findAll({ attributes: ["id", "code"] });
      const idByCode = new Map(institutions.map((institution) => [institution.code, institution.id]));

      const values = rows.map((row) => {
        const institutionId = row.institution_code === null ? null : (idByCode.get(row.institution_code) ?? undefined);
        if (institutionId === undefined) {
          throw new Error(`Seed previsional_rates: la institucion ${row.institution_code} no existe`);
        }
        return {
          rateType: row.rate_type,
          institutionId,
          rate: row.rate,
          validFrom: row.valid_from,
          validTo: null,
          createdBy: null,
          updatedBy: null,
        };
      });
      await PrevisionalRateModel.bulkCreate(values);
      return values.length;
    },
  );
}
