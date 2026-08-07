import { Op } from "sequelize";
import { SupplierModel } from "../../models/mssql/supplier.model";
import { BusinessPartnerModel } from "../../models/mssql/businessPartner.model";
import { SupplierServiceTypeModel } from "../../models/mssql/supplierServiceType.model";
import { SupplierDeliveryTermsModel } from "../../models/mssql/supplierDeliveryTerms.model";
import { getBusinessPartnerByIdOrThrow } from "./businessPartner.service";
import { getSupplierServiceTypeByIdOrThrow } from "./supplierServiceType.service";
import { getSupplierDeliveryTermsByIdOrThrow } from "./supplierDeliveryTerms.service";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { SupplierCreationAttributes, SupplierUpdateAttributes } from "../../types/mssql/supplier.types";

const INCLUDE = [
  { model: BusinessPartnerModel, as: "businessPartner" },
  { model: SupplierServiceTypeModel, as: "serviceType" },
  { model: SupplierDeliveryTermsModel, as: "deliveryTerms" },
];

// Sin campo de texto propio (el resto son FK): buscar por el nombre de la
// entidad asociada (BusinessPartner/ServiceType/DeliveryTerms) requeriria
// sintaxis $businessPartner.legalName$ -se deja fuera por ahora para no
// sumar mas riesgo a un cambio ya grande.
const SEARCH_FIELDS: string[] = [];

export async function listSuppliers(
  params: PaginationParams,
): Promise<{ items: SupplierModel[]; total: number }> {
  const { rows, count } = await SupplierModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    include: INCLUDE,
  });
  return { items: rows, total: count };
}

export async function getSupplierById(id: number): Promise<SupplierModel | null> {
  return SupplierModel.findByPk(id, { include: INCLUDE });
}

export async function getSupplierByIdOrThrow(id: number): Promise<SupplierModel> {
  const supplier = await getSupplierById(id);
  if (!supplier) throw new NotFoundError(`El proveedor ${id} no existe`);
  return supplier;
}

export async function getSupplierByBusinessPartnerId(businessPartnerId: number): Promise<SupplierModel | null> {
  return SupplierModel.findOne({ where: { businessPartnerId } });
}

// businessPartner (razonSocial/rut/giro) es la entidad base compartida con
// customers -crear un supplier NUNCA crea el businessPartner, debe existir
// primero (mismo criterio que persons -> users). Esto permite que la misma
// empresa sea proveedor y cliente a la vez sin duplicar sus datos.
export async function createSupplier(data: SupplierCreationAttributes): Promise<SupplierModel> {
  await getBusinessPartnerByIdOrThrow(data.businessPartnerId);
  await getSupplierServiceTypeByIdOrThrow(data.serviceTypeId);
  await getSupplierDeliveryTermsByIdOrThrow(data.deliveryTermsId);

  const existing = await getSupplierByBusinessPartnerId(data.businessPartnerId);
  if (existing) throw new ConflictError(`El tercero ${data.businessPartnerId} ya es proveedor`);

  const supplier = await SupplierModel.create(data);
  return getSupplierByIdOrThrow(supplier.id);
}

export async function updateSupplier(id: number, data: SupplierUpdateAttributes): Promise<SupplierModel> {
  const supplier = await getSupplierByIdOrThrow(id);
  if (data.serviceTypeId !== undefined) await getSupplierServiceTypeByIdOrThrow(data.serviceTypeId);
  if (data.deliveryTermsId !== undefined) await getSupplierDeliveryTermsByIdOrThrow(data.deliveryTermsId);
  await supplier.update(data);
  return getSupplierByIdOrThrow(id);
}
