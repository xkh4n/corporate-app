import { BusinessPartnerModel } from "../../models/mssql/businessPartner.model";
import { ConflictError, NotFoundError } from "../../library/errors";
import type {
  BusinessPartnerCreationAttributes,
  BusinessPartnerUpdateAttributes,
} from "../../types/mssql/businessPartner.types";

export async function listBusinessPartners(): Promise<BusinessPartnerModel[]> {
  return BusinessPartnerModel.findAll({ order: [["legalName", "ASC"]] });
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
