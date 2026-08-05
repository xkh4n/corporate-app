import { GoodsReceiptModel } from "../../models/mssql/goodsReceipt.model";
import { getPurchaseOrderByIdOrThrow } from "./purchaseOrder.service";
import { getQuoteByIdOrThrow } from "./quote.service";
import { createAssetFromReceipt } from "../postgres/asset.service";
import { NotFoundError } from "../../library/errors";
import { logger } from "../../library/logger";
import type { GoodsReceiptCreationInput } from "../../types/mssql/goodsReceipt.types";

export async function listGoodsReceiptsByOrder(purchaseOrderId: number): Promise<GoodsReceiptModel[]> {
  return GoodsReceiptModel.findAll({ where: { purchaseOrderId }, order: [["id", "ASC"]] });
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
