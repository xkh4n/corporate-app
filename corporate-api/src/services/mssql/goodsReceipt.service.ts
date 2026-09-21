import { Op, Transaction } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { GoodsReceiptModel } from "../../models/mssql/goodsReceipt.model";
import { AuthorizationModel } from "../../models/mssql/authorization.model";
import { PurchaseRequestLineModel } from "../../models/mssql/purchaseRequestLine.model";
import { PurchaseOrderQuoteModel } from "../../models/mssql/purchaseOrderQuote.model";
import { getPurchaseOrderByIdOrThrow } from "./purchaseOrder.service";
import { getQuoteByIdOrThrow } from "./quote.service";
import { getPurchaseRequestByIdOrThrow, updatePurchaseRequestStatus } from "./purchaseRequest.service";
import { createAssetsFromReceipt } from "../postgres/asset.service";
import { getAcquisitionFolder, saveBuffer, sanitizeFilenameSegment } from "../../library/documentStorage";
import { getSafeExtension } from "../../middlewares/upload";
import { BadRequestError, ConflictError, NotFoundError, isUniqueConstraintError } from "../../library/errors";
import { logger } from "../../library/logger";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { GoodsReceiptCreationInput } from "../../types/mssql/goodsReceipt.types";

const SEARCH_FIELDS = ["documentNumber", "documentType"];

export async function listGoodsReceiptsByOrder(
  purchaseOrderId: number,
  params: PaginationParams,
): Promise<{ items: GoodsReceiptModel[]; total: number }> {
  const searchWhere = buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like);
  const { rows, count } = await GoodsReceiptModel.findAndCountAll({
    where: { purchaseOrderId, ...searchWhere },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getGoodsReceiptById(id: number): Promise<GoodsReceiptModel | null> {
  return GoodsReceiptModel.findByPk(id);
}

export async function getGoodsReceiptByIdOrThrow(id: number): Promise<GoodsReceiptModel> {
  const receipt = await getGoodsReceiptById(id);
  if (!receipt) throw new NotFoundError(`El documento de recepcion ${id} no existe`);
  return receipt;
}

// requestId/productId/supplierId/purchaseValue se copian de la Quote
// indicada, nunca del cliente (evita que un GoodsReceipt quede apuntando a
// un producto/proveedor distinto del que realmente se compro). quoteId SI es
// input del cliente -una OC ahora puede cubrir varias cotizaciones, asi que
// la orden por si sola ya no alcanza para saber contra que producto se esta
// recepcionando-, validado contra purchase_order_quotes para que no se pueda
// recepcionar contra la cotizacion de otra orden. Al confirmarse, dispara la
// creacion de los Assets
// correspondientes en Postgres (uno por unidad, decision B) -escritura
// cross-engine NO atomica: si el GoodsReceipt en MSSQL ya se confirmo pero
// la creacion de los Assets falla, no se hace rollback del GoodsReceipt,
// queda pendiente de reconciliar a mano (ver memoria
// project-erp-scope-and-data-classification, es una decision deliberada, no
// un descuido).
//
// Paso 8 del flujo: la solicitud tiene que estar PENDING_DELIVERY (la OC ya
// se envio al proveedor, ver purchaseOrder.service.ts) y lo recibido no
// puede superar lo autorizado para esa cotizacion (Authorization.
// approvedQuantity, ver authorization.service.ts) sumado a lo ya recibido en
// recepciones anteriores -las recepciones parciales siguen soportadas
// (varias por PO).
//
// Pasa la solicitud a AVAILABLE en la PRIMERA recepcion, no solo cuando se
// completa todo lo pedido: el paso 8 describe un evento de recepcion
// puntual, exigir recepcion completa dejaria solicitudes con envio parcial
// del proveedor sin ninguna pantalla para destrabarlas. Por eso el guard
// acepta tanto PENDING_DELIVERY como AVAILABLE -mismo patron dual-accept que
// sendPurchaseOrderToSupplier (OC_GENERATED/PENDING_DELIVERY): sin esto, la
// SEGUNDA recepcion parcial de la misma solicitud quedaria bloqueada para
// siempre, porque la primera ya dejo la solicitud en AVAILABLE. Recepciones
// siguientes reintentan la misma transicion AVAILABLE->AVAILABLE, que
// assertPurchaseRequestTransition ya trata como no-op (from===to).
//
// El cierre a DELIVERED se dispara aca (isRequestFullyReceived), no en
// assignAssetToUser -decision del usuario tras un caso real: una solicitud
// de 4 notebooks para 3 personas + 1 de respaldo nunca terminaria si el
// cierre dependiera de que TODAS las unidades queden asignadas, porque el
// respaldo se deja deliberadamente sin asignar. El ciclo de COMPRA (esta
// solicitud) se completa cuando lo recibido cubre lo autorizado; a quien se
// le asigna cada unidad despues es un ciclo de vida del activo aparte (ver
// assetMovement.service.ts), que puede no completarse nunca.
// Analogo a areAllApprovedLinesAuthorized/areAllWinningQuotesOrdered: una
// solicitud puede tener varias lineas aprobadas, cada una con su propia
// cotizacion ganadora, Authorization y por lo tanto sus propias recepciones.
// Solo cuando lo recibido acumulado de CADA Authorization ya alcanza su
// approvedQuantity la solicitud esta realmente completa -no en la primera
// recepcion parcial. Sin lineas aprobadas o sin Authorizations se considera
// "no completo" (fail closed, mismo criterio que las otras dos funciones).
async function isRequestFullyReceived(requestId: number): Promise<boolean> {
  const approvedLines = await PurchaseRequestLineModel.findAll({
    where: { requestId, status: "APPROVED" },
    attributes: ["id"],
  });
  if (approvedLines.length === 0) return false;

  const authorizations = await AuthorizationModel.findAll({
    where: { requestLineId: { [Op.in]: approvedLines.map((line) => line.id) } },
  });
  if (authorizations.length === 0) return false;

  for (const authorization of authorizations) {
    const received =
      (await GoodsReceiptModel.sum("receivedQuantity", { where: { quoteId: authorization.quoteId } })) || 0;
    if (received < authorization.approvedQuantity) return false;
  }
  return true;
}

export async function createGoodsReceipt(input: GoodsReceiptCreationInput): Promise<GoodsReceiptModel> {
  const order = await getPurchaseOrderByIdOrThrow(input.purchaseOrderId);
  // La orden ya no determina por si sola contra que producto se recepciona
  // (cubre N cotizaciones): el cliente indica cual, y aca se verifica que
  // esa cotizacion este efectivamente cubierta por ESTA orden -si no, se
  // podria recepcionar contra la cotizacion de otra orden/proveedor.
  const link = await PurchaseOrderQuoteModel.findOne({
    where: { purchaseOrderId: order.id, quoteId: input.quoteId },
  });
  if (!link) {
    throw new BadRequestError(`La cotizacion ${input.quoteId} no pertenece a la orden de compra ${order.orderNumber}`);
  }
  const quote = await getQuoteByIdOrThrow(input.quoteId);
  const request = await getPurchaseRequestByIdOrThrow(order.requestId);

  if (request.status !== "PENDING_DELIVERY" && request.status !== "AVAILABLE") {
    throw new ConflictError(
      `No se puede recepcionar: la solicitud ${request.requestNumber} esta en estado "${request.status}", no "PENDING_DELIVERY"`,
    );
  }
  // Guard mas fino que el de arriba: en una solicitud con varias OC (una por
  // proveedor ganador), request.status ya puede ser PENDING_DELIVERY/
  // AVAILABLE por el envio de OTRA orden -order.sentAt (ver
  // purchaseOrder.service.ts) es la unica senal real de que ESTA orden en
  // particular ya salio al proveedor.
  if (!order.sentAt) {
    throw new ConflictError(
      `No se puede recepcionar: la orden de compra ${order.orderNumber} todavia no fue enviada al proveedor`,
    );
  }

  // Lock explicito sobre la Authorization de esta cotizacion (WITH (UPDLOCK)
  // via Transaction.LOCK.UPDATE): sin esto, dos recepciones casi simultaneas
  // contra la MISMA cotizacion (doble clic, reintento de red, o abuso
  // deliberado) pueden ambas leer "alreadyReceived" antes de que la primera
  // commitee su INSERT, pasando las dos el check de abajo -deja Assets reales
  // en Postgres respaldados por MAS unidades de las que la autorizacion
  // permitio (hallazgo de auditoria de seguridad, condicion de carrera real,
  // no solo teorica: misma clase de bug que ya se corrigio una vez en la
  // migracion de MSSQL al arrancar 3 replicas). UPDLOCK alcanza (no hace
  // falta HOLDLOCK): a diferencia de un lock compartido, uno de actualizacion
  // se mantiene hasta el fin de la transaccion incluso bajo READ COMMITTED
  // -es exactamente el hint que Microsoft documenta para este patron
  // leer-decidir-escribir. La segunda transaccion queda bloqueada en este
  // SELECT hasta que la primera termine (commit o rollback); recien ahi lee
  // "alreadyReceived" ya actualizado con lo que la primera confirmo.
  const receipt = await mssql.transaction(async (transaction) => {
    const authorization = await AuthorizationModel.findOne({
      where: { quoteId: quote.id },
      transaction,
      lock: Transaction.LOCK.UPDATE,
    });
    if (!authorization) {
      throw new NotFoundError(`No existe una autorizacion para la cotizacion ${quote.id} -no se puede recepcionar`);
    }
    const alreadyReceived =
      (await GoodsReceiptModel.sum("receivedQuantity", { where: { quoteId: quote.id }, transaction })) || 0;
    if (alreadyReceived + input.receivedQuantity > authorization.approvedQuantity) {
      throw new BadRequestError(
        `La cantidad recibida (${alreadyReceived + input.receivedQuantity}) superaria la cantidad autorizada ` +
          `(${authorization.approvedQuantity}) para esta cotizacion`,
      );
    }

    try {
      return await GoodsReceiptModel.create(
        {
          documentType: input.documentType,
          documentNumber: input.documentNumber,
          purchaseOrderId: order.id,
          quoteId: quote.id,
          requestId: order.requestId,
          productId: quote.productId,
          supplierId: quote.supplierId,
          purchaseValue: quote.purchaseValue,
          receivedQuantity: input.receivedQuantity,
          createdBy: input.createdBy ?? null,
        },
        { transaction },
      );
    } catch (err) {
      // ux_goods_receipts_order_quote_document (migrate.ts): mismo documento
      // del proveedor (guia/boleta/factura) ya recepcionado contra esta orden
      // Y esta cotizacion. quote_id entro a la clave porque una OC
      // multi-cotizacion puede recibir dos productos distintos en la MISMA
      // guia fisica. Sin este catch, el 500 crudo del driver no dice nada
      // util al usuario.
      if (isUniqueConstraintError(err)) {
        throw new ConflictError(
          `Ya existe una recepcion con el documento "${input.documentNumber}" para esta cotizacion en la orden de compra ${order.orderNumber}`,
        );
      }
      throw err;
    }
  });

  try {
    await createAssetsFromReceipt({
      goodsReceiptId: receipt.id,
      productId: quote.productId,
      quantity: input.receivedQuantity,
      costCenterId: request.costCenterId,
      serialNumbers: input.serialNumbers,
      warrantyExpiresAt: input.warrantyExpiresAt ?? null,
      value: quote.purchaseValue,
      finalStatusCode: "AVAILABLE",
      createdBy: input.createdBy ?? null,
    });
  } catch (err) {
    logger.error(
      { err, goodsReceiptId: receipt.id },
      "GoodsReceipt confirmado en MSSQL pero fallo la creacion de los Assets en Postgres - requiere reconciliacion manual",
    );
    throw err;
  }

  const nextStatus = (await isRequestFullyReceived(request.id)) ? "DELIVERED" : "AVAILABLE";
  await updatePurchaseRequestStatus(request.id, nextStatus, input.createdBy ?? undefined);

  return receipt;
}

// Guia de despacho/factura/boleta: va a la misma carpeta consolidada de la
// adquisicion (junto a la solicitud/cotizacion/autorizacion del proveedor
// ganador). documentNumber es texto libre del proveedor -se sanea antes de
// usarlo en el nombre del archivo.
export async function attachGoodsReceiptDocument(
  receiptId: number,
  file: Express.Multer.File,
): Promise<string> {
  const receipt = await getGoodsReceiptByIdOrThrow(receiptId);
  const request = await getPurchaseRequestByIdOrThrow(receipt.requestId);

  const extension = getSafeExtension(file);
  const documentNumber = sanitizeFilenameSegment(receipt.documentNumber);
  const filename = `${receipt.documentType}-${documentNumber}${extension}`;
  saveBuffer(getAcquisitionFolder(request.requestNumber), filename, file.buffer);
  return filename;
}
