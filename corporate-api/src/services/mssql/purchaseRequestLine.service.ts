import { Op } from "sequelize";
import { PurchaseRequestLineModel } from "../../models/mssql/purchaseRequestLine.model";
import { AuthorizationModel } from "../../models/mssql/authorization.model";
import { getPurchaseRequestByIdOrThrow } from "./purchaseRequest.service";
import { getSupplierByIdOrThrow } from "./supplier.service";
import { getProductByIdOrThrow } from "../mongo/product.service";
import { ConflictError, NotFoundError } from "../../library/errors";
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

// Cierre del paso 5->6 del flujo (ver authorization.service.ts,
// createAuthorization): la solicitud pasa a QUOTE_APPROVED recien cuando
// CADA linea APPROVED tiene ya al menos una Authorization -no en la
// primera-, para no decirle al solicitante que ya puede adjuntar la OC
// mientras otras lineas todavia esperan que el aprobador elija ganadora.
// Sin lineas APPROVED todavia (no deberia pasar en el flujo real, la
// solicitud no llega a APPROVE_QUOTE sin al menos una) se considera
// "no completo" -fail closed, no se asume que esta bien.
export async function areAllApprovedLinesAuthorized(requestId: number): Promise<boolean> {
  const approvedLines = await PurchaseRequestLineModel.findAll({
    where: { requestId, status: "APPROVED" },
    attributes: ["id"],
  });
  if (approvedLines.length === 0) return false;

  const authorizedCount = await AuthorizationModel.count({
    where: { requestLineId: { [Op.in]: approvedLines.map((line) => line.id) } },
    distinct: true,
    col: "requestLineId",
  });
  return authorizedCount === approvedLines.length;
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

  // createAuthorization (authorization.service.ts) exige approvedQuantity <=
  // line.quantity AL MOMENTO de autorizar, pero nada revalidaba eso si la
  // linea se editaba DESPUES -se podia terminar con una autorizacion ya
  // aprobando mas cantidad que la que la linea permite hoy (hallazgo de
  // auditoria de seguridad 2026-08-07, integridad de negocio, no control de
  // acceso: el permiso "purchase-request-lines:update" sigue siendo el
  // correcto y suficiente para editar).
  if (data.quantity !== undefined && data.quantity < line.quantity) {
    const maxApproved = (await AuthorizationModel.max("approvedQuantity", {
      where: { requestLineId: id },
    })) as number | null;
    if (maxApproved !== null && data.quantity < maxApproved) {
      throw new ConflictError(
        `No se puede reducir la cantidad a ${data.quantity}: ya existe una autorizacion por ${maxApproved} unidades para esta linea`,
      );
    }
  }

  await line.update(data);
  return line;
}
