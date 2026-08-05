import { Op } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { QuoteModel } from "../../models/mssql/quote.model";
import { getPurchaseRequestByIdOrThrow } from "./purchaseRequest.service";
import { getSupplierByIdOrThrow } from "./supplier.service";
import { getProductByIdOrThrow } from "../mongo/product.service";
import { generateDocumentNumber } from "../../library/documentNumbering";
import { NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { QuoteCreationAttributes } from "../../types/mssql/quote.types";

const SEARCH_FIELDS = ["quoteNumber", "model", "productCode", "status"];

export async function listQuotesByRequest(
  requestId: number,
  params: PaginationParams,
): Promise<{ items: QuoteModel[]; total: number }> {
  const searchWhere = buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like);
  const { rows, count } = await QuoteModel.findAndCountAll({
    where: { requestId, ...searchWhere },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getQuoteById(id: number): Promise<QuoteModel | null> {
  return QuoteModel.findByPk(id);
}

export async function getQuoteByIdOrThrow(id: number): Promise<QuoteModel> {
  const quote = await getQuoteById(id);
  if (!quote) throw new NotFoundError(`La cotizacion ${id} no existe`);
  return quote;
}

// quoteNumber (COT000000001...) se genera dentro de la MISMA transaccion que
// el insert de la cabecera, mismo criterio que PurchaseRequest. Varias
// cotizaciones pueden competir por la misma requestId+productId (distintos
// proveedores); cual gana se decide recien en Authorization.
export async function createQuote(data: QuoteCreationAttributes): Promise<QuoteModel> {
  await getPurchaseRequestByIdOrThrow(data.requestId);
  await getProductByIdOrThrow(data.productId);
  await getSupplierByIdOrThrow(data.supplierId);

  const quote = await mssql.transaction(async (transaction) => {
    const quoteNumber = await generateDocumentNumber("COT", transaction);
    return QuoteModel.create({ ...data, quoteNumber }, { transaction });
  });

  return getQuoteByIdOrThrow(quote.id);
}
