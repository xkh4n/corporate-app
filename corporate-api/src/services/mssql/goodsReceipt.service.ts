import { Op } from "sequelize";
import { GoodsReceiptModel } from "../../models/mssql/goodsReceipt.model";
import { AuthorizationModel } from "../../models/mssql/authorization.model";
import { getPurchaseOrderByIdOrThrow } from "./purchaseOrder.service";
import { getQuoteByIdOrThrow } from "./quote.service";
import { getPurchaseRequestByIdOrThrow, updatePurchaseRequestStatus } from "./purchaseRequest.service";
import { createAssetsFromReceipt } from "../postgres/asset.service";
import { getAcquisitionFolder, saveBuffer, sanitizeFilenameSegment } from "../../library/documentStorage";
import { getSafeExtension } from "../../middlewares/upload";
import { BadRequestError, ConflictError, NotFoundError } from "../../library/errors";
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

// quoteId/requestId/productId/supplierId/purchaseValue se copian de la
// PurchaseOrder -> Quote referenciada, nunca del cliente (evita que un
// GoodsReceipt quede apuntando a un producto/proveedor distinto del que
// realmente se compro). Al confirmarse, dispara la creacion de los Assets
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
export async function createGoodsReceipt(input: GoodsReceiptCreationInput): Promise<GoodsReceiptModel> {
  const order = await getPurchaseOrderByIdOrThrow(input.purchaseOrderId);
  const quote = await getQuoteByIdOrThrow(order.quoteId);
  const request = await getPurchaseRequestByIdOrThrow(quote.requestId);

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

  const authorization = await AuthorizationModel.findOne({ where: { quoteId: quote.id } });
  if (!authorization) {
    throw new NotFoundError(`No existe una autorizacion para la cotizacion ${quote.id} -no se puede recepcionar`);
  }
  const alreadyReceived =
    (await GoodsReceiptModel.sum("receivedQuantity", { where: { quoteId: quote.id } })) || 0;
  if (alreadyReceived + input.receivedQuantity > authorization.approvedQuantity) {
    throw new BadRequestError(
      `La cantidad recibida (${alreadyReceived + input.receivedQuantity}) superaria la cantidad autorizada ` +
        `(${authorization.approvedQuantity}) para esta cotizacion`,
    );
  }

  const receipt = await GoodsReceiptModel.create({
    documentType: input.documentType,
    documentNumber: input.documentNumber,
    purchaseOrderId: order.id,
    quoteId: quote.id,
    requestId: quote.requestId,
    productId: quote.productId,
    supplierId: quote.supplierId,
    purchaseValue: quote.purchaseValue,
    receivedQuantity: input.receivedQuantity,
    createdBy: input.createdBy ?? null,
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

  await updatePurchaseRequestStatus(request.id, "AVAILABLE", input.createdBy ?? undefined);

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
