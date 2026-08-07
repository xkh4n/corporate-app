import { Op } from "sequelize";
import { SupplierServiceTypeModel } from "../../models/mssql/supplierServiceType.model";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type {
  SupplierServiceTypeCreationAttributes,
  SupplierServiceTypeUpdateAttributes,
} from "../../types/mssql/supplierServiceType.types";

const SEARCH_FIELDS = ["code", "name", "description"];

export async function listSupplierServiceTypes(
  params: PaginationParams,
): Promise<{ items: SupplierServiceTypeModel[]; total: number }> {
  const { rows, count } = await SupplierServiceTypeModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getSupplierServiceTypeById(id: number): Promise<SupplierServiceTypeModel | null> {
  return SupplierServiceTypeModel.findByPk(id);
}

export async function getSupplierServiceTypeByIdOrThrow(id: number): Promise<SupplierServiceTypeModel> {
  const serviceType = await getSupplierServiceTypeById(id);
  if (!serviceType) throw new NotFoundError(`El tipo de servicio de proveedor ${id} no existe`);
  return serviceType;
}

export async function getSupplierServiceTypeByCode(code: string): Promise<SupplierServiceTypeModel | null> {
  return SupplierServiceTypeModel.findOne({ where: { code } });
}

// Lista abierta (mismo criterio que asset_statuses): por eso hay
// createSupplierServiceType en vez de un ENUM/CHECK hardcodeado.
export async function createSupplierServiceType(
  data: SupplierServiceTypeCreationAttributes,
): Promise<SupplierServiceTypeModel> {
  const existing = await getSupplierServiceTypeByCode(data.code);
  if (existing) throw new ConflictError(`Ya existe un tipo de servicio de proveedor con codigo '${data.code}'`);
  return SupplierServiceTypeModel.create(data);
}

export async function updateSupplierServiceType(
  id: number,
  data: SupplierServiceTypeUpdateAttributes,
): Promise<SupplierServiceTypeModel> {
  const serviceType = await getSupplierServiceTypeByIdOrThrow(id);
  await serviceType.update(data);
  return serviceType;
}
