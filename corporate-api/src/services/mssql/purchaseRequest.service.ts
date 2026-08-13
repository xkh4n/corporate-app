import fs from "node:fs";
import path from "node:path";
import { Op } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PurchaseRequestModel } from "../../models/mssql/purchaseRequest.model";
import { PersonModel } from "../../models/mssql/person.model";
import { UserModel } from "../../models/mssql/user.model";
import { getPersonByIdOrThrow } from "./person.service";
import { getUserByIdOrThrow, listUsersByRoleIds } from "./user.service";
import { getCostCenterByIdOrThrow } from "../postgres/costCenter.service";
import { getRoleIdsWithPermission, roleGrantsPermission } from "../postgres/permission.service";
import { getSupplierByIdOrThrow } from "./supplier.service";
import { getBusinessPartnerByIdOrThrow } from "./businessPartner.service";
import { listAllLinesByRequest } from "./purchaseRequestLine.service";
import { listAllContactsBySupplier } from "./supplierContact.service";
import { getProductsByIds } from "../mongo/product.service";
import { getProductCategoriesByIds } from "../mongo/productCategory.service";
import { generateDocumentNumber } from "../../library/documentNumbering";
import { getQuoteRequestFolder } from "../../library/documentStorage";
import { sendMailViaMailer } from "../../library/mailerClient";
import { NotFoundError, BadRequestError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { QuoteRequestPdfData } from "../../library/pdf/quoteRequestPdf";
import type {
  PurchaseRequestCreationAttributes,
  PurchaseRequestUpdateAttributes,
} from "../../types/mssql/purchaseRequest.types";
import type { SafeUser } from "../../types/mssql/user.types";

const includeParties = [
  { model: PersonModel, as: "requester" },
  { model: PersonModel, as: "beneficiary" },
  { model: UserModel, as: "beneficiaryUser" },
  { model: UserModel, as: "approver" },
];

const SEARCH_FIELDS = ["requestNumber", "notes", "status", "priority"];

export async function listPurchaseRequests(
  params: PaginationParams,
): Promise<{ items: PurchaseRequestModel[]; total: number }> {
  const { rows, count } = await PurchaseRequestModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    include: includeParties,
  });
  return { items: rows, total: count };
}

export async function getPurchaseRequestById(id: number): Promise<PurchaseRequestModel | null> {
  return PurchaseRequestModel.findByPk(id, { include: includeParties });
}

// Solo lo que le corresponde revisar a ESTE usuario (ver decision de
// alcance: "solo las asignadas a mi", no todo el listado general -ese ya
// existe en listPurchaseRequests, detras de purchase-requests:read).
export async function listPurchaseRequestsForApprover(
  approverId: number,
  params: PaginationParams,
): Promise<{ items: PurchaseRequestModel[]; total: number }> {
  const { rows, count } = await PurchaseRequestModel.findAndCountAll({
    where: { ...buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like), approverId },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    include: includeParties,
  });
  return { items: rows, total: count };
}

// Personas elegibles para ser elegidas como aprobador al crear una
// solicitud (select en CreateRequest.tsx): cualquier usuario activo cuyo rol
// tenga purchase-requests:approve, resuelto cross-DB (roles/permisos en
// Postgres, usuarios en MSSQL -ver permission.service.ts).
export async function listApprovers(): Promise<SafeUser[]> {
  const roleIds = await getRoleIdsWithPermission("purchase-requests", "approve");
  return listUsersByRoleIds(roleIds);
}

export async function getPurchaseRequestByIdOrThrow(id: number): Promise<PurchaseRequestModel> {
  const request = await getPurchaseRequestById(id);
  if (!request) throw new NotFoundError(`La solicitud ${id} no existe`);
  return request;
}

// requestNumber (SOL000000001...) se genera dentro de la MISMA transaccion
// que el insert de la cabecera: si algo despues falla y se hace rollback,
// el numero tambien se revierte -no queda "quemado". Ver
// library/documentNumbering.ts.
export async function createPurchaseRequest(
  data: PurchaseRequestCreationAttributes,
): Promise<PurchaseRequestModel> {
  await getPersonByIdOrThrow(data.requesterId);
  await getPersonByIdOrThrow(data.beneficiaryId);
  if (data.beneficiaryUserId !== undefined && data.beneficiaryUserId !== null) {
    await getUserByIdOrThrow(data.beneficiaryUserId);
  }
  await getCostCenterByIdOrThrow(data.costCenterId);

  // El aprobador no es un dato de contacto libre (a diferencia de
  // beneficiaryUserId): tiene que ser realmente alguien cuyo rol tenga el
  // permiso purchase-requests:approve, o la solicitud quedaria asignada a
  // alguien que nunca va a poder actuar sobre ella (ver roleGrantsPermission,
  // mismo bypass de "admin" que el middleware authorize()).
  const approver = await getUserByIdOrThrow(data.approverId);
  const canApprove = await roleGrantsPermission(approver.roleId, "purchase-requests", "approve");
  if (!canApprove) {
    throw new BadRequestError(
      `El usuario ${data.approverId} no tiene permiso para aprobar solicitudes de compra`,
    );
  }

  const request = await mssql.transaction(async (transaction) => {
    const requestNumber = await generateDocumentNumber("SOL", transaction);
    return PurchaseRequestModel.create({ ...data, requestNumber }, { transaction });
  });

  return getPurchaseRequestByIdOrThrow(request.id);
}

export async function updatePurchaseRequest(
  id: number,
  data: PurchaseRequestUpdateAttributes,
): Promise<PurchaseRequestModel> {
  const request = await getPurchaseRequestByIdOrThrow(id);
  if (data.beneficiaryUserId !== undefined && data.beneficiaryUserId !== null) {
    await getUserByIdOrThrow(data.beneficiaryUserId);
  }
  await request.update(data);
  return request;
}

const VALID_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CLOSED", "CANCELLED"] as const;
export type PurchaseRequestStatus = (typeof VALID_STATUSES)[number];

export async function updatePurchaseRequestStatus(
  id: number,
  status: PurchaseRequestStatus,
  updatedBy?: number,
): Promise<PurchaseRequestModel> {
  const request = await getPurchaseRequestByIdOrThrow(id);
  await request.update({ status, updatedBy });
  return request;
}

// Datos para el documento de "solicitud de cotizacion" (PDF, ver
// library/pdf/quoteRequestPdf.ts): cabecera (folio, solicitante) + TODAS las
// lineas de la solicitud (cada producto viene de Mongo, incluye su
// categoria si tiene) y, si se indica supplierId, la razon social del
// proveedor destinatario -query param opcional, no toda solicitud tiene
// todavia un proveedor elegido.
export async function getQuoteRequestDocumentData(
  requestId: number,
  supplierId?: number,
): Promise<QuoteRequestPdfData> {
  const request = await getPurchaseRequestByIdOrThrow(requestId);
  const requester = await getPersonByIdOrThrow(request.requesterId);
  const lines = await listAllLinesByRequest(requestId);

  const products = await getProductsByIds(lines.map((line) => line.productId));
  const productsById = new Map(products.map((product) => [String(product._id), product]));

  const categoryIds = products
    .map((product) => product.categoryId)
    .filter((categoryId): categoryId is NonNullable<typeof categoryId> => Boolean(categoryId))
    .map((categoryId) => String(categoryId));
  const categories = await getProductCategoriesByIds(categoryIds);
  const categoriesById = new Map(categories.map((category) => [String(category._id), category.name]));

  const items = lines.map((line, index) => {
    const product = productsById.get(line.productId);
    if (!product) throw new NotFoundError(`El producto ${line.productId} no existe`);
    return {
      no: index + 1,
      productName: product.name,
      categoryName: product.categoryId ? (categoriesById.get(String(product.categoryId)) ?? null) : null,
      description: product.description,
      quantity: line.quantity,
    };
  });

  let supplierLegalName: string | null = null;
  let supplierNationalId: string | null = null;
  if (supplierId !== undefined) {
    const supplier = await getSupplierByIdOrThrow(supplierId);
    const businessPartner = await getBusinessPartnerByIdOrThrow(supplier.businessPartnerId);
    supplierLegalName = businessPartner.legalName;
    supplierNationalId = businessPartner.nationalId;
  }

  return {
    requestNumber: request.requestNumber,
    requesterName: `${requester.firstName} ${requester.lastName}`,
    supplierLegalName,
    supplierNationalId,
    items,
  };
}

// Envia por correo (via corporate-mailer, el unico contenedor con salida a
// internet) el PDF SOLCOT-* YA archivado -no se re-renderiza, para que el
// correo lleve exactamente el mismo documento que quedo archivado al crear
// el Quote (ver library/pdf/quoteRequestPdf.ts). Si el Quote para este
// proveedor todavia no existe, tampoco existe el archivo -NotFoundError, no
// tiene sentido generar uno nuevo aca-. Destinatarios: TODOS los contactos
// activos del proveedor (supplier_contacts no tiene campo "principal").
export async function sendQuoteRequestEmail(
  requestId: number,
  supplierId: number,
): Promise<{ sent: boolean; message: string }> {
  const request = await getPurchaseRequestByIdOrThrow(requestId);
  const supplier = await getSupplierByIdOrThrow(supplierId);
  const businessPartner = await getBusinessPartnerByIdOrThrow(supplier.businessPartnerId);

  const pdfPath = path.join(getQuoteRequestFolder(request.requestNumber), `SOLCOT-${businessPartner.nationalId}.pdf`);
  if (!fs.existsSync(pdfPath)) {
    throw new NotFoundError(
      `No existe todavia la solicitud de cotizacion para el proveedor ${supplierId} en la solicitud ${request.requestNumber} -crea el Quote primero`,
    );
  }

  const contacts = await listAllContactsBySupplier(supplierId);
  if (contacts.length === 0) {
    throw new BadRequestError(`El proveedor ${supplierId} no tiene contactos registrados para enviarle el correo`);
  }

  const result = await sendMailViaMailer({
    to: contacts.map((contact) => contact.email),
    subject: `Solicitud de cotización ${request.requestNumber}`,
    text:
      `Estimados, adjuntamos solicitud de cotización ${request.requestNumber} dirigida a ` +
      `${businessPartner.legalName}. Agradecemos su respuesta a la brevedad.`,
    attachment: {
      filename: `${request.requestNumber}.pdf`,
      content: fs.readFileSync(pdfPath),
      contentType: "application/pdf",
    },
  });

  return {
    sent: result.ok,
    message: result.ok ? "Correo enviado exitosamente" : (result.error ?? "No se pudo enviar el correo"),
  };
}
