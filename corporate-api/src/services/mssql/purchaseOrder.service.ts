import fs from "node:fs";
import path from "node:path";
import { Op } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PurchaseOrderModel } from "../../models/mssql/purchaseOrder.model";
import { PurchaseOrderQuoteModel } from "../../models/mssql/purchaseOrderQuote.model";
import { QuoteModel } from "../../models/mssql/quote.model";
import { getSupplierByIdOrThrow } from "./supplier.service";
import { getBusinessPartnerByIdOrThrow } from "./businessPartner.service";
import { listAllContactsBySupplier } from "./supplierContact.service";
import { getPurchaseRequestByIdOrThrow, updatePurchaseRequestStatus } from "./purchaseRequest.service";
import { generateDocumentNumber } from "../../library/documentNumbering";
import { findFileByPrefix, getAcquisitionFolder, listFiles, saveBuffer } from "../../library/documentStorage";
import { getSafeExtension } from "../../middlewares/upload";
import { sendMailViaMailer } from "../../library/mailerClient";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, isUniqueConstraintError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { CreatePurchaseOrderInput } from "../../types/mssql/purchaseOrder.types";

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

// requestId opcional: filtra directo por la columna propia
// purchase_orders.request_id (antes habia que llegar a la solicitud via un
// include de Quote, porque la orden solo guardaba quoteId). El include de
// quotes es N:M via purchase_order_quotes -through:{attributes:[]} deja
// afuera la fila puente, que no le sirve a nadie del otro lado. distinct:true
// porque sin el, count() cuenta una fila por cotizacion cubierta en el join
// N:M y el total de la paginacion sale inflado.
export async function listPurchaseOrders(
  params: PaginationParams,
  requestId?: number,
): Promise<{ items: PurchaseOrderModel[]; total: number }> {
  const { rows, count } = await PurchaseOrderModel.findAndCountAll({
    where: {
      ...buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
      ...(requestId !== undefined ? { requestId } : {}),
    },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    include: [{ model: QuoteModel, as: "quotes", through: { attributes: [] } }],
    distinct: true,
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

// Solo se puede emitir una OC sobre cotizaciones ya SELECTED (autorizadas,
// ver authorization.service.ts) -de lo contrario se estaria comprando algo
// que nadie aprobo. Una OC puede cubrir VARIAS cotizaciones ganadoras a la
// vez, siempre que sean de la MISMA solicitud y del MISMO proveedor -una OC
// nunca puede cruzar dos proveedores, restriccion real del negocio, no una
// decision de diseño-. supplierId/requestId se derivan de las cotizaciones
// indicadas (validado que todas coincidan), no son input del cliente;
// paymentTerms, si no se entrega, se completa desde Supplier.paymentTermDays.
//
// actorPersonId: el solicitante ORIGINAL de la compra (personId del usuario
// autenticado) es quien emite la OC -paso 6 del flujo, "el mismo que pidio
// la compra la formaliza"-, no un analista ni el aprobador. Sin bypass de
// admin, mismo criterio que assertIsAssignedApprover en
// purchaseRequest.service.ts.
export async function createPurchaseOrder(
  data: CreatePurchaseOrderInput,
  actorPersonId: number,
): Promise<PurchaseOrderModel> {
  // Dedupe defensivo: {quoteIds:[7,7]} chocaria contra
  // uq_purchase_order_quotes_quote consigo mismo y daria un ConflictError
  // incomprensible ("ya existe una OC") por una orden que nunca existio.
  const quoteIds = [...new Set(data.quoteIds)];
  if (quoteIds.length === 0) {
    throw new BadRequestError("Debe indicar al menos una cotizacion ganadora para emitir la orden de compra");
  }

  const quotes = await QuoteModel.findAll({ where: { id: { [Op.in]: quoteIds } } });
  if (quotes.length !== quoteIds.length) {
    const found = new Set(quotes.map((quote) => quote.id));
    const missing = quoteIds.filter((id) => !found.has(id));
    throw new NotFoundError(`No existe(n) la(s) cotizacion(es) ${missing.join(", ")}`);
  }

  const notSelected = quotes.find((quote) => quote.status !== "SELECTED");
  if (notSelected) {
    throw new BadRequestError(
      `La cotizacion ${notSelected.id} todavia no fue autorizada (status actual: ${notSelected.status})`,
    );
  }

  // Las dos restricciones duras del rediseño: una OC cubre cotizaciones de
  // UNA sola solicitud y de UN solo proveedor.
  const requestIds = [...new Set(quotes.map((quote) => quote.requestId))];
  if (requestIds.length > 1) {
    throw new BadRequestError(
      `Una orden de compra no puede cubrir cotizaciones de solicitudes distintas (${requestIds.join(", ")})`,
    );
  }
  const supplierIds = [...new Set(quotes.map((quote) => quote.supplierId))];
  if (supplierIds.length > 1) {
    throw new BadRequestError(
      `Una orden de compra no puede cubrir cotizaciones de proveedores distintos (${supplierIds.join(", ")}) ` +
        "-emita una orden por proveedor",
    );
  }
  // Non-null: quotes.length >= 1 (verificado arriba), asi que requestIds/
  // supplierIds tienen al menos un elemento.
  const requestId = requestIds[0]!;
  const supplierId = supplierIds[0]!;

  const request = await getPurchaseRequestByIdOrThrow(requestId);
  if (request.status !== "QUOTE_APPROVED") {
    throw new ConflictError(
      `No se puede emitir la orden de compra: la solicitud ${request.requestNumber} esta en estado "${request.status}", no "QUOTE_APPROVED"`,
    );
  }
  if (request.requesterId !== actorPersonId) {
    throw new ForbiddenError("Solo el solicitante de esta compra puede emitir su orden de compra");
  }

  // Chequeo previo SOLO para dar un mensaje util; el guard real es
  // uq_purchase_order_quotes_quote (ver el catch de abajo) -sin esto, dos
  // solicitudes casi simultaneas sobre la misma cotizacion igual quedarian
  // resueltas de forma segura, solo con un mensaje generico.
  const alreadyOrdered = await PurchaseOrderQuoteModel.findAll({ where: { quoteId: { [Op.in]: quoteIds } } });
  if (alreadyOrdered.length > 0) {
    const existing = await getPurchaseOrderByIdOrThrow(alreadyOrdered[0]!.purchaseOrderId);
    throw new ConflictError(
      `Ya existe una orden de compra (${existing.orderNumber}) para la cotizacion ${alreadyOrdered[0]!.quoteId}`,
    );
  }

  const supplier = await getSupplierByIdOrThrow(supplierId);

  const order = await mssql.transaction(async (transaction) => {
    const orderNumber = await generateDocumentNumber("OC", transaction);
    const created = await PurchaseOrderModel.create(
      {
        orderNumber,
        requestId,
        // issuedAt: el DEFAULT SYSUTCDATETIME() de la columna nunca se activa
        // aca -Sequelize valida allowNull:false del lado del cliente antes de
        // llegar a la BD, asi que hay que pasarlo explicito.
        issuedAt: new Date(),
        supplierId,
        paymentTerms: data.paymentTerms ?? `${supplier.paymentTermDays} dias`,
        createdBy: data.createdBy ?? null,
      },
      { transaction },
    );

    try {
      await PurchaseOrderQuoteModel.bulkCreate(
        quoteIds.map((quoteId) => ({ purchaseOrderId: created.id, quoteId })),
        { transaction },
      );
    } catch (err) {
      // Carrera real: dos solicitudes casi simultaneas (doble clic, dos
      // pestañas) emitiendo sobre la misma cotizacion ganadora pasan las dos
      // el chequeo previo de arriba. El rollback revierte tambien el numero
      // de OC consumido -generateDocumentNumber corre en ESTA transaccion.
      if (isUniqueConstraintError(err)) {
        throw new ConflictError(
          "Alguna de las cotizaciones seleccionadas ya quedo cubierta por otra orden de compra -recargue la pantalla",
        );
      }
      throw err;
    }

    return created;
  });

  return getPurchaseOrderByIdOrThrow(order.id);
}

// Cierre analogo al de QUOTE_APPROVED en authorization.service.ts
// (areAllApprovedLinesAuthorized): una solicitud puede tener varias lineas
// aprobadas, cada una con su propia cotizacion ganadora, y varias de esas
// cotizaciones pueden terminar cubiertas por LA MISMA orden (mismo
// proveedor). Solo cuando CADA cotizacion SELECTED de la solicitud quedo
// cubierta por ALGUNA orden Y cada una de esas ordenes ya tiene su PDF
// adjuntado en disco, la solicitud pasa a OC_GENERATED -no en la primera.
// Comparar cantidades (orders.length === winningQuotes.length, como antes)
// dejo de servir apenas una sola OC cubre 2+ cotizaciones; cobertura por
// conjunto si sigue funcionando aunque las cotizaciones ganadoras vengan de
// proveedores distintos (varias OC, una por proveedor, y hacen falta todas).
async function areAllWinningQuotesOrdered(requestId: number): Promise<boolean> {
  const winningQuotes = await QuoteModel.findAll({ where: { requestId, status: "SELECTED" }, attributes: ["id"] });
  if (winningQuotes.length === 0) return false;

  const winningIds = winningQuotes.map((quote) => quote.id);
  const links = await PurchaseOrderQuoteModel.findAll({ where: { quoteId: { [Op.in]: winningIds } } });
  const coveredIds = new Set(links.map((link) => link.quoteId));
  if (winningIds.some((id) => !coveredIds.has(id))) return false;

  const orders = await PurchaseOrderModel.findAll({
    where: { id: { [Op.in]: [...new Set(links.map((link) => link.purchaseOrderId))] } },
    attributes: ["orderNumber"],
  });

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
  const request = await getPurchaseRequestByIdOrThrow(order.requestId);

  const extension = getSafeExtension(file);
  const filename = `OC-${order.orderNumber}${extension}`;
  saveBuffer(getAcquisitionFolder(request.requestNumber), filename, file.buffer);

  if (await areAllWinningQuotesOrdered(request.id)) {
    await updatePurchaseRequestStatus(request.id, "OC_GENERATED", userId);
  }

  return filename;
}

// Resuelve la carpeta consolidada de la adquisicion dueña de esta orden
// (purchase_orders.request_id, directo -antes habia que pasar por la
// cotizacion). Compartido entre listAcquisitionDocuments y el controller
// (que hace la resolucion+guard de path-traversal para la descarga puntual,
// mismo patron que downloadQuoteDocumentFile en purchaseRequest.controller.ts).
export async function getAcquisitionFolderForOrder(orderId: number): Promise<string> {
  const order = await getPurchaseOrderByIdOrThrow(orderId);
  const request = await getPurchaseRequestByIdOrThrow(order.requestId);
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
// ordenes de compra (una por proveedor ganador) puede necesitar mandar cada
// una a un proveedor distinto: la primera que se envia flipea el status a
// PENDING_DELIVERY, y updatePurchaseRequestStatus es idempotente para
// "from === to" (ver assertPurchaseRequestTransition), asi que reenviar/
// enviar OTRA orden de la misma solicitud no vuelve a fallar por status.
export async function sendPurchaseOrderToSupplier(
  orderId: number,
  userId: number,
): Promise<{ sent: boolean; message: string }> {
  const order = await getPurchaseOrderByIdOrThrow(orderId);
  const request = await getPurchaseRequestByIdOrThrow(order.requestId);

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
    // proveedor ganador) puede reenviar cualquiera de ellas de forma
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
