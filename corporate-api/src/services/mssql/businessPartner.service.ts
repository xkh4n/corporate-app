import { Op } from "sequelize";
import { BusinessPartnerModel } from "../../models/mssql/businessPartner.model";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type {
  BusinessPartnerCreationAttributes,
  BusinessPartnerUpdateAttributes,
} from "../../types/mssql/businessPartner.types";

const SEARCH_FIELDS = ["legalName", "nationalId", "businessLine"];

export async function listBusinessPartners(
  params: PaginationParams,
): Promise<{ items: BusinessPartnerModel[]; total: number }> {
  const { rows, count } = await BusinessPartnerModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getBusinessPartnerById(id: number): Promise<BusinessPartnerModel | null> {
  return BusinessPartnerModel.findByPk(id);
}

export async function getBusinessPartnerByIdOrThrow(id: number): Promise<BusinessPartnerModel> {
  const partner = await getBusinessPartnerById(id);
  if (!partner) throw new NotFoundError(`El tercero ${id} no existe`);
  return partner;
}

export async function getBusinessPartnerByNationalId(nationalId: string): Promise<BusinessPartnerModel | null> {
  return BusinessPartnerModel.findOne({ where: { nationalId } });
}

export async function createBusinessPartner(
  data: BusinessPartnerCreationAttributes,
): Promise<BusinessPartnerModel> {
  const existing = await getBusinessPartnerByNationalId(data.nationalId);
  if (existing) throw new ConflictError(`Ya existe un tercero con rut/nationalId '${data.nationalId}'`);
  return BusinessPartnerModel.create(data);
}

export async function updateBusinessPartner(
  id: number,
  data: BusinessPartnerUpdateAttributes,
): Promise<BusinessPartnerModel> {
  const partner = await getBusinessPartnerByIdOrThrow(id);
  if (data.nationalId && data.nationalId !== partner.nationalId) {
    const existing = await getBusinessPartnerByNationalId(data.nationalId);
    if (existing) throw new ConflictError(`Ya existe un tercero con rut/nationalId '${data.nationalId}'`);
  }
  await partner.update(data);
  return partner;
}
