import { Op } from "sequelize";
import { PurchaseRequestLineModel } from "../../models/mssql/purchaseRequestLine.model";
import { getPurchaseRequestByIdOrThrow } from "./purchaseRequest.service";
import { getSupplierByIdOrThrow } from "./supplier.service";
import { getProductByIdOrThrow } from "../mongo/product.service";
import { NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type {
  PurchaseRequestLineCreationAttributes,
  PurchaseRequestLineUpdateAttributes,
} from "../../types/mssql/purchaseRequestLine.types";

const SEARCH_FIELDS = ["equipmentType", "status"];

export async function listLinesByRequest(
  requestId: number,
  params: PaginationParams,
): Promise<{ items: PurchaseRequestLineModel[]; total: number }> {
  const searchWhere = buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like);
  const { rows, count } = await PurchaseRequestLineModel.findAndCountAll({
    where: { requestId, ...searchWhere },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getLineById(id: number): Promise<PurchaseRequestLineModel | null> {
  return PurchaseRequestLineModel.findByPk(id);
}

export async function getLineByIdOrThrow(id: number): Promise<PurchaseRequestLineModel> {
  const line = await getLineById(id);
  if (!line) throw new NotFoundError(`La linea de solicitud ${id} no existe`);
  return line;
}

// Todas las lineas de una solicitud, sin paginar -usado para armar el
// documento de "solicitud de cotizacion" (PDF), que debe listar el
// contenido completo de la solicitud, no una pagina parcial.
export async function listAllLinesByRequest(requestId: number): Promise<PurchaseRequestLineModel[]> {
  return PurchaseRequestLineModel.findAll({ where: { requestId }, order: [["id", "ASC"]] });
}

// productId es un ObjectId de Mongo (catalogo de producto) -sin FK real,
// validado a mano contra el service de Mongo, mismo criterio que
// getRoleByIdOrThrow en user.service.ts para el cross-engine hacia Postgres.
export async function createLine(
  data: PurchaseRequestLineCreationAttributes,
): Promise<PurchaseRequestLineModel> {
  await getPurchaseRequestByIdOrThrow(data.requestId);
  await getProductByIdOrThrow(data.productId);
  if (data.supplierId !== undefined && data.supplierId !== null) {
    await getSupplierByIdOrThrow(data.supplierId);
  }

  return PurchaseRequestLineModel.create(data);
}

export async function updateLine(
  id: number,
  data: PurchaseRequestLineUpdateAttributes,
): Promise<PurchaseRequestLineModel> {
  const line = await getLineByIdOrThrow(id);
  if (data.supplierId !== undefined && data.supplierId !== null) {
    await getSupplierByIdOrThrow(data.supplierId);
  }
  await line.update(data);
  return line;
}
