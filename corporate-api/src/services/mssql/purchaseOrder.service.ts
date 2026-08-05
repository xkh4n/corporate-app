import { Op } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PurchaseOrderModel } from "../../models/mssql/purchaseOrder.model";
import { getQuoteByIdOrThrow } from "./quote.service";
import { getSupplierByIdOrThrow } from "./supplier.service";
import { generateDocumentNumber } from "../../library/documentNumbering";
import { BadRequestError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { PurchaseOrderCreationAttributes } from "../../types/mssql/purchaseOrder.types";

const SEARCH_FIELDS = ["orderNumber", "paymentTerms"];

export async function listPurchaseOrders(
  params: PaginationParams,
): Promise<{ items: PurchaseOrderModel[]; total: number }> {
  const { rows, count } = await PurchaseOrderModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
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
export async function createPurchaseOrder(
  data: PurchaseOrderCreationAttributes,
): Promise<PurchaseOrderModel> {
  const quote = await getQuoteByIdOrThrow(data.quoteId);
  if (quote.status !== "SELECTED") {
    throw new BadRequestError(
      `La cotizacion ${data.quoteId} todavia no fue autorizada (status actual: ${quote.status})`,
    );
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
