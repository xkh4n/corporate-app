import { Op } from "sequelize";
import { SupplierDeliveryTermsModel } from "../../models/mssql/supplierDeliveryTerms.model";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type {
  SupplierDeliveryTermsCreationAttributes,
  SupplierDeliveryTermsUpdateAttributes,
} from "../../types/mssql/supplierDeliveryTerms.types";

const SEARCH_FIELDS = ["code", "name", "description"];

export async function listSupplierDeliveryTerms(
  params: PaginationParams,
): Promise<{ items: SupplierDeliveryTermsModel[]; total: number }> {
  const { rows, count } = await SupplierDeliveryTermsModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getSupplierDeliveryTermsById(id: number): Promise<SupplierDeliveryTermsModel | null> {
  return SupplierDeliveryTermsModel.findByPk(id);
}

export async function getSupplierDeliveryTermsByIdOrThrow(id: number): Promise<SupplierDeliveryTermsModel> {
  const deliveryTerms = await getSupplierDeliveryTermsById(id);
  if (!deliveryTerms) throw new NotFoundError(`La condicion de entrega de proveedor ${id} no existe`);
  return deliveryTerms;
}

export async function getSupplierDeliveryTermsByCode(code: string): Promise<SupplierDeliveryTermsModel | null> {
  return SupplierDeliveryTermsModel.findOne({ where: { code } });
}

// Lista abierta (mismo criterio que asset_statuses): por eso hay
// createSupplierDeliveryTerms en vez de un ENUM/CHECK hardcodeado.
export async function createSupplierDeliveryTerms(
  data: SupplierDeliveryTermsCreationAttributes,
): Promise<SupplierDeliveryTermsModel> {
  const existing = await getSupplierDeliveryTermsByCode(data.code);
  if (existing) {
    throw new ConflictError(`Ya existe una condicion de entrega de proveedor con codigo '${data.code}'`);
  }
  return SupplierDeliveryTermsModel.create(data);
}

export async function updateSupplierDeliveryTerms(
  id: number,
  data: SupplierDeliveryTermsUpdateAttributes,
): Promise<SupplierDeliveryTermsModel> {
  const deliveryTerms = await getSupplierDeliveryTermsByIdOrThrow(id);
  await deliveryTerms.update(data);
  return deliveryTerms;
}
