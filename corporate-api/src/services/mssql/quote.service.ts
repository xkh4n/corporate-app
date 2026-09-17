import { Op } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { QuoteModel } from "../../models/mssql/quote.model";
import { getPurchaseRequestByIdOrThrow, getQuoteRequestDocumentData } from "./purchaseRequest.service";
import { getSupplierByIdOrThrow } from "./supplier.service";
import { getBusinessPartnerByIdOrThrow } from "./businessPartner.service";
import { getProductByIdOrThrow } from "../mongo/product.service";
import { archiveQuoteRequestPdf, renderQuoteRequestPdf } from "../../library/pdf/quoteRequestPdf";
import { getQuoteRequestFolder, sanitizeFilenameSegment, saveBuffer } from "../../library/documentStorage";
import { getSafeExtension } from "../../middlewares/upload";
import { generateDocumentNumber } from "../../library/documentNumbering";
import { ConflictError, NotFoundError } from "../../library/errors";
import { logger } from "../../library/logger";
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
  const request = await getPurchaseRequestByIdOrThrow(data.requestId);
  // Paso 4 del flujo: la carga de cotizaciones solo esta abierta mientras la
  // solicitud esta en IN_QUOTATION -"Solicitar Autorización" (ver
  // requestQuoteApproval en purchaseRequest.service.ts) la cierra.
  if (request.status !== "IN_QUOTATION") {
    throw new ConflictError(
      `No se pueden cargar cotizaciones: la solicitud ${request.requestNumber} esta en estado "${request.status}", no "IN_QUOTATION"`,
    );
  }
  await getProductByIdOrThrow(data.productId);
  await getSupplierByIdOrThrow(data.supplierId);

  const quote = await mssql.transaction(async (transaction) => {
    const quoteNumber = await generateDocumentNumber("COT", transaction);
    return QuoteModel.create({ ...data, quoteNumber }, { transaction });
  });

  const created = await getQuoteByIdOrThrow(quote.id);

  // Genera y archiva la "solicitud de cotizacion" (SOLCOT-<nationalId>.pdf)
  // dirigida a ESTE proveedor -best-effort: si falla (ej. disco lleno), se
  // loguea pero no se revierte ni falla la creacion de la cotizacion, mismo
  // criterio defensivo que el resto del pipeline (ver goodsReceipt.service).
  try {
    const pdfData = await getQuoteRequestDocumentData(created.requestId, created.supplierId);
    const doc = renderQuoteRequestPdf(pdfData);
    archiveQuoteRequestPdf(doc, pdfData.requestNumber, pdfData.supplierNationalId);
  } catch (err) {
    logger.error(
      { err, quoteId: created.id },
      "No se pudo generar/archivar el PDF de solicitud de cotizacion para la cotizacion creada",
    );
  }

  return created;
}

// Comprobante subido cuando el proveedor responde (correo, PDF, foto de la
// cotizacion recibida) -opcional, va en la misma carpeta que el SOLCOT-* de
// ese proveedor para esa solicitud (ver library/documentStorage.ts).
export async function attachQuoteDocument(quoteId: number, file: Express.Multer.File): Promise<string> {
  const quote = await getQuoteByIdOrThrow(quoteId);
  const request = await getPurchaseRequestByIdOrThrow(quote.requestId);
  if (request.status !== "IN_QUOTATION") {
    throw new ConflictError(
      `No se pueden adjuntar comprobantes de cotizacion: la solicitud ${request.requestNumber} esta en estado "${request.status}", no "IN_QUOTATION"`,
    );
  }
  const supplier = await getSupplierByIdOrThrow(quote.supplierId);
  const businessPartner = await getBusinessPartnerByIdOrThrow(supplier.businessPartnerId);

  const extension = getSafeExtension(file);
  const filename = `COT-${sanitizeFilenameSegment(businessPartner.nationalId)}${extension}`;
  saveBuffer(getQuoteRequestFolder(request.requestNumber), filename, file.buffer);
  return filename;
}
