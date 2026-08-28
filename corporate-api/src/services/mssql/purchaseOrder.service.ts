import fs from "node:fs";
import path from "node:path";
import { Op } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PurchaseOrderModel } from "../../models/mssql/purchaseOrder.model";
import { QuoteModel } from "../../models/mssql/quote.model";
import { getQuoteByIdOrThrow } from "./quote.service";
import { getSupplierByIdOrThrow } from "./supplier.service";
import { getBusinessPartnerByIdOrThrow } from "./businessPartner.service";
import { listAllContactsBySupplier } from "./supplierContact.service";
import { getPurchaseRequestByIdOrThrow, updatePurchaseRequestStatus } from "./purchaseRequest.service";
import { generateDocumentNumber } from "../../library/documentNumbering";
import { findFileByPrefix, getAcquisitionFolder, listFiles, saveBuffer } from "../../library/documentStorage";
import { getSafeExtension } from "../../middlewares/upload";
import { sendMailViaMailer } from "../../library/mailerClient";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { PurchaseOrderCreationAttributes } from "../../types/mssql/purchaseOrder.types";

const SEARCH_FIELDS = ["orderNumber", "paymentTerms"];

// Adjuntos que este servicio puede terminar mandando por correo no siempre
// son PDF (OC-*/COT-* se suben con el mismo whitelist que quotes/
// authorizations: PDF, JPG, PNG, EML, MSG -ver middlewares/upload.ts).
// Inverso de EXTENSION_BY_MIME_TYPE, mantenido local: es la unica funcion de
// este archivo que necesita ir de extension a Content-Type.
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".eml": "message/rfc822",
  ".msg": "application/vnd.ms-outlook",
};

function guessContentType(filename: string): string {
  return CONTENT_TYPE_BY_EXTENSION[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

// requestId opcional: cuando viene, restringe a las ordenes de compra de ESA
// solicitud -via la asociacion Sequelize ya existente PurchaseOrderModel
// belongsTo QuoteModel (purchase_orders no tiene columna request_id propia,
// se llega a traves de la cotizacion). Usado por AttachPurchaseOrder.tsx/
// SendPurchaseOrder.tsx para listar las ordenes de UNA solicitud puntual.
export async function listPurchaseOrders(
  params: PaginationParams,
  requestId?: number,
): Promise<{ items: PurchaseOrderModel[]; total: number }> {
  const { rows, count } = await PurchaseOrderModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    include: requestId !== undefined ? [{ model: QuoteModel, as: "quote", where: { requestId } }] : undefined,
  });
  return { items: rows, total: count };
}

export async function getPurchaseOrderById(id: number): Promise<PurchaseOrderModel | null> {
  return PurchaseOrderModel.findByPk(id);
}

export async function getPurchaseOrderByIdOrThrow(id: number): Promise<PurchaseOrderModel> {
  const order = await getPurchaseOrderById(id);
  if (!order) throw new NotFoundError(`La orden de compra ${id} no existe`);
  return order;
}

// Solo se puede emitir una OC sobre una cotizacion ya SELECTED (autorizada,
// ver authorization.service.ts) -de lo contrario se estaria comprando algo
// que nadie aprobo. supplierId se copia de la Quote; paymentTerms, si no se
// entrega, se completa desde Supplier.paymentTermDays para no tener que
// volver a escribirlo a mano.
//
// actorPersonId: el solicitante ORIGINAL de la compra (personId del usuario
// autenticado) es quien emite la OC -paso 6 del flujo, "el mismo que pidio
// la compra la formaliza"-, no un analista ni el aprobador. Sin bypass de
// admin, mismo criterio que assertIsAssignedApprover en
// purchaseRequest.service.ts.
export async function createPurchaseOrder(
  data: PurchaseOrderCreationAttributes,
  actorPersonId: number,
): Promise<PurchaseOrderModel> {
  const quote = await getQuoteByIdOrThrow(data.quoteId);
  if (quote.status !== "SELECTED") {
    throw new BadRequestError(
      `La cotizacion ${data.quoteId} todavia no fue autorizada (status actual: ${quote.status})`,
    );
  }

  const request = await getPurchaseRequestByIdOrThrow(quote.requestId);
  if (request.status !== "QUOTE_APPROVED") {
    throw new ConflictError(
      `No se puede emitir la orden de compra: la solicitud ${request.requestNumber} esta en estado "${request.status}", no "QUOTE_APPROVED"`,
    );
  }
  if (request.requesterId !== actorPersonId) {
    throw new ForbiddenError("Solo el solicitante de esta compra puede emitir su orden de compra");
  }

  // Una solicitud con varias lineas aprobadas tiene una cotizacion ganadora
  // por linea (PurchaseOrder esta atado a UN quoteId, no a la solicitud
  // completa) -sin este guard, nada impedia emitir dos OC para la misma
  // cotizacion (quote_id no tiene UNIQUE a nivel de BD, solo la asociacion
  // Sequelize lo modela como 1:1).
  const existing = await PurchaseOrderModel.findOne({ where: { quoteId: data.quoteId } });
  if (existing) {
    throw new ConflictError(`Ya existe una orden de compra (${existing.orderNumber}) para la cotizacion ${data.quoteId}`);
  }

  const supplier = await getSupplierByIdOrThrow(quote.supplierId);

  const order = await mssql.transaction(async (transaction) => {
    const orderNumber = await generateDocumentNumber("OC", transaction);
    return PurchaseOrderModel.create(
      {
        orderNumber,
        quoteId: data.quoteId,
        // issuedAt: el DEFAULT SYSUTCDATETIME() de la columna nunca se activa
        // aca -Sequelize valida allowNull:false del lado del cliente antes de
        // llegar a la BD, asi que hay que pasarlo explicito.
        issuedAt: new Date(),
        supplierId: quote.supplierId,
        paymentTerms: data.paymentTerms ?? `${supplier.paymentTermDays} dias`,
        createdBy: data.createdBy ?? null,
      },
      { transaction },
    );
  });

  return getPurchaseOrderByIdOrThrow(order.id);
}

// Cierre analogo al de QUOTE_APPROVED en authorization.service.ts
// (areAllApprovedLinesAuthorized): una solicitud puede tener varias lineas
// aprobadas, cada una con su propia cotizacion ganadora y por lo tanto su
// propia OC. Solo cuando CADA cotizacion SELECTED de la solicitud ya tiene
// una PurchaseOrder Y esa orden ya tiene su PDF adjuntado en disco, la
// solicitud pasa a OC_GENERATED -no en la primera. Sin este guard,
// attachPurchaseOrderDocument flipearia el status apenas se adjuntara LA
// PRIMERA orden, y createPurchaseOrder para la segunda cotizacion ganadora
// (que exige status==="QUOTE_APPROVED") quedaria bloqueado para siempre.
async function areAllWinningQuotesOrdered(requestId: number): Promise<boolean> {
  const winningQuotes = await QuoteModel.findAll({ where: { requestId, status: "SELECTED" }, attributes: ["id"] });
  if (winningQuotes.length === 0) return false;

  const orders = await PurchaseOrderModel.findAll({
    where: { quoteId: { [Op.in]: winningQuotes.map((quote) => quote.id) } },
  });
  if (orders.length !== winningQuotes.length) return false;

  const request = await getPurchaseRequestByIdOrThrow(requestId);
  const folder = getAcquisitionFolder(request.requestNumber);
  return orders.every((order) => findFileByPrefix(folder, `OC-${order.orderNumber}`) !== null);
}

// Sin columna nueva en la BD para el PDF de la OC -se guarda en filesystem
// como OC-<orderNumber>.<ext> en la misma carpeta consolidada de la
// adquisicion que ya usan SOLCOT-*/COT-*/AUTORIZACION-* (ver
// documentStorage.ts), consistencia con esas 3 convenciones existentes en
// vez de una columna aislada.
export async function attachPurchaseOrderDocument(
  orderId: number,
  file: Express.Multer.File,
  userId?: number,
): Promise<string> {
  const order = await getPurchaseOrderByIdOrThrow(orderId);
  const quote = await getQuoteByIdOrThrow(order.quoteId);
  const request = await getPurchaseRequestByIdOrThrow(quote.requestId);

  const extension = getSafeExtension(file);
  const filename = `OC-${order.orderNumber}${extension}`;
  saveBuffer(getAcquisitionFolder(request.requestNumber), filename, file.buffer);

  if (await areAllWinningQuotesOrdered(request.id)) {
    await updatePurchaseRequestStatus(request.id, "OC_GENERATED", userId);
  }

  return filename;
}

// Resuelve la carpeta consolidada de la adquisicion dueña de esta orden (se
// llega a la solicitud a traves de la cotizacion, purchase_orders no tiene
// columna request_id propia) -compartido entre listAcquisitionDocuments y el
// controller (que hace la resolucion+guard de path-traversal para la
// descarga puntual, mismo patron que downloadQuoteDocumentFile en
// purchaseRequest.controller.ts).
export async function getAcquisitionFolderForOrder(orderId: number): Promise<string> {
  const order = await getPurchaseOrderByIdOrThrow(orderId);
  const quote = await getQuoteByIdOrThrow(order.quoteId);
  const request = await getPurchaseRequestByIdOrThrow(quote.requestId);
  return getAcquisitionFolder(request.requestNumber);
}

// Archivos consolidados en la carpeta de la adquisicion para ESTA orden
// -usado por SendPurchaseOrder.tsx para mostrar/descargar la OC y el
// respaldo de la cotizacion ganadora antes de mandarlos al proveedor.
export async function listAcquisitionDocuments(orderId: number): Promise<string[]> {
  return listFiles(await getAcquisitionFolderForOrder(orderId));
}

// Paso 7 del flujo: envia al proveedor, por correo, la OC (adjuntada en
// attachPurchaseOrderDocument) + el respaldo de la cotizacion ganadora
// (SOLCOT-*/COT-*, ya consolidados en esta misma carpeta por
// createAuthorization) -mismo patron de findFileByPrefix que usa ese
// archivo.
//
// Acepta tanto OC_GENERATED como PENDING_DELIVERY: una solicitud con varias
// ordenes de compra (una por cotizacion ganadora) puede necesitar mandar
// cada una a un proveedor distinto: la primera que se envia flipea el
// status a PENDING_DELIVERY, y updatePurchaseRequestStatus es idempotente
// para "from === to" (ver assertPurchaseRequestTransition), asi que
// reenviar/enviar OTRA orden de la misma solicitud no vuelve a fallar por
// status.
export async function sendPurchaseOrderToSupplier(
  orderId: number,
  userId: number,
): Promise<{ sent: boolean; message: string }> {
  const order = await getPurchaseOrderByIdOrThrow(orderId);
  const quote = await getQuoteByIdOrThrow(order.quoteId);
  const request = await getPurchaseRequestByIdOrThrow(quote.requestId);

  if (request.status !== "OC_GENERATED" && request.status !== "PENDING_DELIVERY") {
    throw new ConflictError(
      `No se puede enviar: la solicitud ${request.requestNumber} esta en estado "${request.status}", no "OC_GENERATED"`,
    );
  }

  const supplier = await getSupplierByIdOrThrow(order.supplierId);
  const businessPartner = await getBusinessPartnerByIdOrThrow(supplier.businessPartnerId);
  const folder = getAcquisitionFolder(request.requestNumber);

  const ocFile = findFileByPrefix(folder, `OC-${order.orderNumber}`);
  if (!ocFile) {
    throw new NotFoundError(`No existe todavia el PDF de la orden de compra ${order.orderNumber} -adjuntalo primero`);
  }
  const quoteFile =
    findFileByPrefix(folder, `SOLCOT-${businessPartner.nationalId}`) ??
    findFileByPrefix(folder, `COT-${businessPartner.nationalId}`);

  const contacts = await listAllContactsBySupplier(order.supplierId);
  if (contacts.length === 0) {
    throw new BadRequestError(`El proveedor ${order.supplierId} no tiene contactos registrados para enviarle el correo`);
  }

  const attachments = [
    { filename: ocFile, content: fs.readFileSync(path.join(folder, ocFile)), contentType: guessContentType(ocFile) },
  ];
  if (quoteFile) {
    attachments.push({
      filename: quoteFile,
      content: fs.readFileSync(path.join(folder, quoteFile)),
      contentType: guessContentType(quoteFile),
    });
  }

  const result = await sendMailViaMailer({
    to: contacts.map((contact) => contact.email),
    subject: `Orden de compra ${order.orderNumber}`,
    text:
      `Estimados, adjuntamos la orden de compra ${order.orderNumber} dirigida a ` +
      `${businessPartner.legalName}. Agradecemos confirmar recepcion.`,
    attachments,
  });

  if (result.ok) {
    // Por-orden, no por-solicitud: una solicitud con varias OC (una por
    // cotizacion ganadora) puede reenviar cualquiera de ellas de forma
    // independiente -sentAt es lo unico que distingue "ya se mando esta" de
    // "todavia no" ya que el status de la solicitud es idempotente entre
    // OC_GENERATED/PENDING_DELIVERY (ver comentario arriba).
    await order.update({ sentAt: new Date(), updatedBy: userId });
    await updatePurchaseRequestStatus(request.id, "PENDING_DELIVERY", userId);
  }

  return {
    sent: result.ok,
    message: result.ok ? "Correo enviado exitosamente" : (result.error ?? "No se pudo enviar el correo"),
  };
}
