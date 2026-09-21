import { Op } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { AuthorizationModel } from "../../models/mssql/authorization.model";
import { QuoteModel } from "../../models/mssql/quote.model";
import { areAllApprovedLinesAuthorized, getLineByIdOrThrow } from "./purchaseRequestLine.service";
import { assertIsAssignedApprover, getPurchaseRequestByIdOrThrow, updatePurchaseRequestStatus } from "./purchaseRequest.service";
import { getQuoteByIdOrThrow } from "./quote.service";
import { getUserByIdOrThrow, getUserByPersonId } from "./user.service";
import { getSupplierByIdOrThrow } from "./supplier.service";
import { getBusinessPartnerByIdOrThrow } from "./businessPartner.service";
import {
  copyIfExists,
  findFileByPrefix,
  getAcquisitionFolder,
  getQuoteRequestFolder,
  sanitizeFilenameSegment,
  saveBuffer,
} from "../../library/documentStorage";
import { getSafeExtension } from "../../middlewares/upload";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, isUniqueConstraintError } from "../../library/errors";
import { logger } from "../../library/logger";
import { notifyPendingPurchaseOrder } from "../../library/realtime/notify";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder } from "../../library/sequelizeSearch";
import type { AuthorizationCreationAttributes } from "../../types/mssql/authorization.types";

// Sin campos de texto propios significativos (productId es un ObjectId de
// Mongo, supplierId es FK): solo paginacion/orden, sin filtro de busqueda.
// quoteId, alternativa a requestLineId, la usa ReceiveGoods.tsx (Fase D)
// para resolver la Authorization de una PurchaseOrder puntual (PurchaseOrder
// solo conoce su quoteId, no el requestLineId) -mismo patron que el filtro
// requestId de listPurchaseOrders/goodsReceiptId de listAssets.
export async function listAuthorizations(
  filter: { requestLineId?: number; quoteId?: number },
  params: PaginationParams,
): Promise<{ items: AuthorizationModel[]; total: number }> {
  const { rows, count } = await AuthorizationModel.findAndCountAll({
    where: {
      ...(filter.requestLineId !== undefined ? { requestLineId: filter.requestLineId } : {}),
      ...(filter.quoteId !== undefined ? { quoteId: filter.quoteId } : {}),
    },
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

  // Sin esto, dos llamadas legitimas y secuenciales del mismo aprobador
  // asignado sobre la misma linea (posible mientras la solicitud sigue en
  // APPROVE_QUOTE por otras lineas sin resolver) creaban dos Authorization
  // SELECTED para la misma linea -el UNIQUE (request_line_id) de migrate.ts
  // cierra la carrera a nivel de motor, este chequeo solo da el mensaje
  // legible en el camino no concurrente.
  if (quote.status !== "PENDING") {
    throw new ConflictError(
      `La cotizacion ${data.quoteId} ya no esta PENDING (estado actual: "${quote.status}")`,
    );
  }

  const existingAuthorization = await AuthorizationModel.findOne({ where: { requestLineId: data.requestLineId } });
  if (existingAuthorization) {
    throw new ConflictError(`La linea ${data.requestLineId} ya tiene una autorizacion (id ${existingAuthorization.id})`);
  }

  const request = await getPurchaseRequestByIdOrThrow(line.requestId);

  // Decision A del plan de implementacion: solo el aprobador ASIGNADO a
  // esta solicitud puede elegir la cotizacion ganadora -no cualquier usuario
  // con el permiso generico authorizations:create. Deliberadamente SIN
  // bypass de admin (mismo criterio que assertIsAssignedApprover en
  // purchaseRequest.service.ts): un admin saltandose esto ya no es
  // segregacion de funciones.
  assertIsAssignedApprover(request, data.approverId);

  if (request.status !== "APPROVE_QUOTE") {
    throw new ConflictError(
      `No se puede autorizar: la solicitud ${request.requestNumber} esta en estado "${request.status}", no "APPROVE_QUOTE"`,
    );
  }

  // Segregacion de funciones: quien solicito la compra no puede ser quien la
  // autoriza -sin esto, un usuario con permiso "authorizations:create"
  // podria aprobarse su propia solicitud. requesterId es un personId; se
  // compara contra el personId del usuario aprobador, no su userId (son
  // entidades distintas, ver types/auth.types.ts).
  if (request.requesterId === approver.personId) {
    throw new ForbiddenError("El solicitante de la compra no puede autorizar su propia solicitud");
  }

  if (data.approvedQuantity > line.quantity) {
    throw new BadRequestError(
      `La cantidad aprobada (${data.approvedQuantity}) no puede superar la cantidad solicitada (${line.quantity})`,
    );
  }

  let authorization: AuthorizationModel;
  try {
    authorization = await mssql.transaction(async (transaction) => {
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
      await quote.update({ status: "SELECTED", updatedBy: data.approverId }, { transaction });
      // Cotizaciones competidoras del MISMO producto en esta solicitud quedan
      // REJECTED -autorizar ES la accion de negocio que decide, entre varias,
      // cual proveedor gano (ver comentario mas arriba en este archivo).
      await QuoteModel.update(
        { status: "REJECTED", updatedBy: data.approverId },
        {
          where: {
            requestId: line.requestId,
            productId: quote.productId,
            status: "PENDING",
            id: { [Op.ne]: quote.id },
          },
          transaction,
        },
      );
      return created;
    });
  } catch (err) {
    // uq_authorizations_request_line (migrate.ts): cierra a nivel de motor
    // la misma carrera que el findOne de arriba ya rechaza en el camino no
    // concurrente -dos llamadas simultaneas del aprobador para la misma
    // linea, la perdedora choca aca en vez de crear una segunda Authorization.
    if (isUniqueConstraintError(err)) {
      throw new ConflictError(`La linea ${data.requestLineId} ya tiene una autorizacion`);
    }
    throw err;
  }

  // Consolida en la carpeta de la adquisicion (best-effort, no bloquea la
  // autorizacion ya confirmada) el respaldo del proveedor ganador: el
  // SOLCOT-* que el backend genero al crear la cotizacion, y el COT-* que se
  // haya subido con la respuesta del proveedor (si existe).
  try {
    const supplier = await getSupplierByIdOrThrow(quote.supplierId);
    const businessPartner = await getBusinessPartnerByIdOrThrow(supplier.businessPartnerId);
    const sourceFolder = getQuoteRequestFolder(request.requestNumber);
    const destFolder = getAcquisitionFolder(request.requestNumber);

    const safeNationalId = sanitizeFilenameSegment(businessPartner.nationalId);
    copyIfExists(sourceFolder, destFolder, `SOLCOT-${safeNationalId}.pdf`);
    const cotFile = findFileByPrefix(sourceFolder, `COT-${safeNationalId}`);
    if (cotFile) copyIfExists(sourceFolder, destFolder, cotFile);
  } catch (err) {
    logger.error(
      { err, authorizationId: authorization.id },
      "No se pudo consolidar los documentos de la solicitud/cotizacion en la carpeta de adquisicion",
    );
  }

  // Cierre del paso 5->6: recien cuando TODAS las lineas APPROVED de la
  // solicitud tienen ya un ganador (no en la primera, ver
  // areAllApprovedLinesAuthorized) la solicitud pasa a QUOTE_APPROVED y se
  // notifica al solicitante que ya puede adjuntar la OC.
  if (await areAllApprovedLinesAuthorized(request.id)) {
    await updatePurchaseRequestStatus(request.id, "QUOTE_APPROVED", data.approverId);
    const requesterUser = await getUserByPersonId(request.requesterId);
    if (requesterUser) {
      notifyPendingPurchaseOrder(requesterUser.id, request);
    } else {
      logger.info(
        { requestId: request.id },
        "El solicitante no tiene cuenta de usuario -no se pudo notificar el pase a QUOTE_APPROVED",
      );
    }
  }

  return getAuthorizationByIdOrThrow(authorization.id);
}

// Correo o solicitud firmada que respalda la autorizacion -opcional, va a la
// carpeta consolidada de la adquisicion (misma que solicitud/cotizacion del
// proveedor ganador y, luego, el documento de recepcion).
export async function attachAuthorizationDocument(
  authorizationId: number,
  file: Express.Multer.File,
): Promise<string> {
  const authorization = await getAuthorizationByIdOrThrow(authorizationId);
  const line = await getLineByIdOrThrow(authorization.requestLineId);
  const request = await getPurchaseRequestByIdOrThrow(line.requestId);
  const supplier = await getSupplierByIdOrThrow(authorization.supplierId);
  const businessPartner = await getBusinessPartnerByIdOrThrow(supplier.businessPartnerId);

  const extension = getSafeExtension(file);
  const filename = `AUTORIZACION-${sanitizeFilenameSegment(businessPartner.nationalId)}${extension}`;
  saveBuffer(getAcquisitionFolder(request.requestNumber), filename, file.buffer);
  return filename;
}
