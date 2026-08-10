import { Op } from "sequelize";
import { GoodsReceiptModel } from "../../models/mssql/goodsReceipt.model";
import { getPurchaseOrderByIdOrThrow } from "./purchaseOrder.service";
import { getQuoteByIdOrThrow } from "./quote.service";
import { getPurchaseRequestByIdOrThrow } from "./purchaseRequest.service";
import { createAssetFromReceipt } from "../postgres/asset.service";
import { getAcquisitionFolder, saveBuffer, sanitizeFilenameSegment } from "../../library/documentStorage";
import { getSafeExtension } from "../../middlewares/upload";
import { NotFoundError } from "../../library/errors";
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
// realmente se compro). Al confirmarse, dispara la creacion del Asset
// correspondiente en Postgres -escritura cross-engine NO atomica: si el
// GoodsReceipt en MSSQL ya se confirmo pero la creacion del Asset falla, no
// se hace rollback del GoodsReceipt, queda pendiente de reconciliar a mano
// (ver memoria project-erp-scope-and-data-classification, es una decision
// deliberada, no un descuido).
export async function createGoodsReceipt(input: GoodsReceiptCreationInput): Promise<GoodsReceiptModel> {
  const order = await getPurchaseOrderByIdOrThrow(input.purchaseOrderId);
  const quote = await getQuoteByIdOrThrow(order.quoteId);
  const request = await getPurchaseRequestByIdOrThrow(quote.requestId);

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
    await createAssetFromReceipt({
      goodsReceiptId: receipt.id,
      productId: quote.productId,
      costCenterId: request.costCenterId,
      serialNumber: input.serialNumber ?? null,
      warrantyExpiresAt: input.warrantyExpiresAt ?? null,
      value: quote.purchaseValue,
      createdBy: input.createdBy ?? null,
    });
  } catch (err) {
    logger.error(
      { err, goodsReceiptId: receipt.id },
      "GoodsReceipt confirmado en MSSQL pero fallo la creacion del Asset en Postgres - requiere reconciliacion manual",
    );
    throw err;
  }

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
