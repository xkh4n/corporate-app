import { mssql } from "../../databases/mssql/connection";
import { AuthorizationModel } from "../../models/mssql/authorization.model";
import { getLineByIdOrThrow } from "./purchaseRequestLine.service";
import { getPurchaseRequestByIdOrThrow } from "./purchaseRequest.service";
import { getQuoteByIdOrThrow } from "./quote.service";
import { getUserByIdOrThrow } from "./user.service";
import { getSupplierByIdOrThrow } from "./supplier.service";
import { getBusinessPartnerByIdOrThrow } from "./businessPartner.service";
import { copyIfExists, findFileByPrefix, getAcquisitionFolder, getQuoteRequestFolder, saveBuffer } from "../../library/documentStorage";
import { getSafeExtension } from "../../middlewares/upload";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../library/errors";
import { logger } from "../../library/logger";
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
    await quote.update({ status: "SELECTED", updatedBy: data.approverId }, { transaction });
    return created;
  });

  // Consolida en la carpeta de la adquisicion (best-effort, no bloquea la
  // autorizacion ya confirmada) el respaldo del proveedor ganador: el
  // SOLCOT-* que el backend genero al crear la cotizacion, y el COT-* que se
  // haya subido con la respuesta del proveedor (si existe).
  try {
    const supplier = await getSupplierByIdOrThrow(quote.supplierId);
    const businessPartner = await getBusinessPartnerByIdOrThrow(supplier.businessPartnerId);
    const sourceFolder = getQuoteRequestFolder(request.requestNumber);
    const destFolder = getAcquisitionFolder(request.requestNumber);

    copyIfExists(sourceFolder, destFolder, `SOLCOT-${businessPartner.nationalId}.pdf`);
    const cotFile = findFileByPrefix(sourceFolder, `COT-${businessPartner.nationalId}`);
    if (cotFile) copyIfExists(sourceFolder, destFolder, cotFile);
  } catch (err) {
    logger.error(
      { err, authorizationId: authorization.id },
      "No se pudo consolidar los documentos de la solicitud/cotizacion en la carpeta de adquisicion",
    );
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
  const filename = `AUTORIZACION-${businessPartner.nationalId}${extension}`;
  saveBuffer(getAcquisitionFolder(request.requestNumber), filename, file.buffer);
  return filename;
}
