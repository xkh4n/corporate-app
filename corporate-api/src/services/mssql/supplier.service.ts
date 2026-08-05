import { Op } from "sequelize";
import { SupplierModel } from "../../models/mssql/supplier.model";
import { BusinessPartnerModel } from "../../models/mssql/businessPartner.model";
import { getBusinessPartnerByIdOrThrow } from "./businessPartner.service";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { SupplierCreationAttributes, SupplierUpdateAttributes } from "../../types/mssql/supplier.types";

// Sin campo de texto propio significativo (el resto son FK/enums): se busca
// por serviceType/deliveryTerms directos. Buscar por el nombre del
// BusinessPartner asociado requeriria sintaxis $businessPartner.legalName$
// -se deja fuera por ahora para no sumar mas riesgo a un cambio ya grande.
const SEARCH_FIELDS = ["serviceType", "deliveryTerms"];

export async function listSuppliers(
  params: PaginationParams,
): Promise<{ items: SupplierModel[]; total: number }> {
  const { rows, count } = await SupplierModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    include: [{ model: BusinessPartnerModel, as: "businessPartner" }],
  });
  return { items: rows, total: count };
}

export async function getSupplierById(id: number): Promise<SupplierModel | null> {
  return SupplierModel.findByPk(id, { include: [{ model: BusinessPartnerModel, as: "businessPartner" }] });
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

  const existing = await getSupplierByBusinessPartnerId(data.businessPartnerId);
  if (existing) throw new ConflictError(`El tercero ${data.businessPartnerId} ya es proveedor`);

  const supplier = await SupplierModel.create(data);
  return getSupplierByIdOrThrow(supplier.id);
}

export async function updateSupplier(id: number, data: SupplierUpdateAttributes): Promise<SupplierModel> {
  const supplier = await getSupplierByIdOrThrow(id);
  await supplier.update(data);
  return supplier;
}
