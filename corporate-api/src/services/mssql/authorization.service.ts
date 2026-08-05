import { mssql } from "../../databases/mssql/connection";
import { AuthorizationModel } from "../../models/mssql/authorization.model";
import { getLineByIdOrThrow } from "./purchaseRequestLine.service";
import { getPurchaseRequestByIdOrThrow } from "./purchaseRequest.service";
import { getQuoteByIdOrThrow } from "./quote.service";
import { getUserByIdOrThrow } from "./user.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder } from "../../library/sequelizeSearch";
import type { AuthorizationCreationAttributes } from "../../types/mssql/authorization.types";

// Sin campos de texto propios significativos (productId es un ObjectId de
// Mongo, supplierId es FK): solo paginacion/orden, sin filtro de busqueda.
export async function listAuthorizationsByLine(
  requestLineId: number,
  params: PaginationParams,
): Promise<{ items: AuthorizationModel[]; total: number }> {
  const { rows, count } = await AuthorizationModel.findAndCountAll({
    where: { requestLineId },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getAuthorizationById(id: number): Promise<AuthorizationModel | null> {
  return AuthorizationModel.findByPk(id);
}

export async function getAuthorizationByIdOrThrow(id: number): Promise<AuthorizationModel> {
  const authorization = await getAuthorizationById(id);
  if (!authorization) throw new NotFoundError(`La autorizacion ${id} no existe`);
  return authorization;
}

// Por linea (requestLineId), no por PurchaseRequest completa -permite
// aprobacion parcial. productId/supplierId se copian de la Quote elegida
// (nunca input del cliente, ver types/mssql/authorization.types.ts), y esa
// Quote pasa a status SELECTED en la misma transaccion: autorizar ES la
// accion de negocio que decide cual cotizacion, entre varias competidoras,
// gano. Ver memoria project-erp-scope-and-data-classification.
export async function createAuthorization(
  data: AuthorizationCreationAttributes,
): Promise<AuthorizationModel> {
  const line = await getLineByIdOrThrow(data.requestLineId);
  const quote = await getQuoteByIdOrThrow(data.quoteId);
  const approver = await getUserByIdOrThrow(data.approverId);

  if (quote.requestId !== line.requestId) {
    throw new BadRequestError(
      `La cotizacion ${data.quoteId} no pertenece a la misma solicitud que la linea ${data.requestLineId}`,
    );
  }

  // Segregacion de funciones: quien solicito la compra no puede ser quien la
  // autoriza -sin esto, un usuario con permiso "authorizations:create"
  // podria aprobarse su propia solicitud. requesterId es un personId; se
  // compara contra el personId del usuario aprobador, no su userId (son
  // entidades distintas, ver types/auth.types.ts).
  const request = await getPurchaseRequestByIdOrThrow(line.requestId);
  if (request.requesterId === approver.personId) {
    throw new ForbiddenError("El solicitante de la compra no puede autorizar su propia solicitud");
  }

  if (data.approvedQuantity > line.quantity) {
    throw new BadRequestError(
      `La cantidad aprobada (${data.approvedQuantity}) no puede superar la cantidad solicitada (${line.quantity})`,
    );
  }

  const authorization = await mssql.transaction(async (transaction) => {
    const created = await AuthorizationModel.create(
      {
        requestLineId: data.requestLineId,
        quoteId: data.quoteId,
        approverId: data.approverId,
        approvedQuantity: data.approvedQuantity,
        approvedAt: new Date(),
        productId: quote.productId,
        supplierId: quote.supplierId,
      },
      { transaction },
    );
    await quote.update({ status: "SELECTED" }, { transaction });
    return created;
  });

  return getAuthorizationByIdOrThrow(authorization.id);
}
