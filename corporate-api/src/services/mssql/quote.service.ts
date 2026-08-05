import { mssql } from "../../databases/mssql/connection";
import { QuoteModel } from "../../models/mssql/quote.model";
import { getPurchaseRequestByIdOrThrow } from "./purchaseRequest.service";
import { getSupplierByIdOrThrow } from "./supplier.service";
import { getProductByIdOrThrow } from "../mongo/product.service";
import { generateDocumentNumber } from "../../library/documentNumbering";
import { NotFoundError } from "../../library/errors";
import type { QuoteCreationAttributes } from "../../types/mssql/quote.types";

export async function listQuotesByRequest(requestId: number): Promise<QuoteModel[]> {
  return QuoteModel.findAll({ where: { requestId }, order: [["id", "ASC"]] });
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
