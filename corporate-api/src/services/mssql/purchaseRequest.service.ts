import fs from "node:fs";
import path from "node:path";
import { Op, type Transaction } from "sequelize";
import { mssql } from "../../databases/mssql/connection";
import { PurchaseRequestModel } from "../../models/mssql/purchaseRequest.model";
import { PurchaseRequestLineModel } from "../../models/mssql/purchaseRequestLine.model";
import { PersonModel } from "../../models/mssql/person.model";
import { UserModel } from "../../models/mssql/user.model";
import { QuoteModel } from "../../models/mssql/quote.model";
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
import { getQuoteRequestFolder, sanitizeFilenameSegment } from "../../library/documentStorage";
import { sendMailViaMailer } from "../../library/mailerClient";
import { notifyPendingQuoteApproval, notifyPendingRequestApproval } from "../../library/realtime/notify";
import { NotFoundError, BadRequestError, ConflictError, ForbiddenError } from "../../library/errors";
import { emitPurchaseRequestStatusChanged } from "../../library/purchaseRequestEvents";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { QuoteRequestPdfData } from "../../library/pdf/quoteRequestPdf";
import { assertPurchaseRequestTransition } from "../../library/purchaseRequestStatus";
import type { PurchaseRequestStatus } from "../../library/purchaseRequestStatus";
import type {
  PurchaseRequestCreationAttributes,
  PurchaseRequestUpdateAttributes,
} from "../../types/mssql/purchaseRequest.types";
import type { SafeUser } from "../../types/mssql/user.types";

// Sin las columnas sensibles de users: estas filas salen tal cual en las respuestas (incluida "Mis
// solicitudes", que ve cualquier solicitante) y antes llevaban el hash de la password del aprobador.
const SAFE_USER_ATTRIBUTES = { exclude: ["passwordHash", "mfaTotpSecretEnc"] };

const includeParties = [
  { model: PersonModel, as: "requester" },
  { model: PersonModel, as: "beneficiary" },
  { model: UserModel, as: "beneficiaryUser", attributes: SAFE_USER_ATTRIBUTES },
  { model: UserModel, as: "approver", attributes: SAFE_USER_ATTRIBUTES },
];

const SEARCH_FIELDS = ["requestNumber", "notes", "status", "priority"];

function buildStatusWhere(status?: string[]): Record<string, unknown> {
  return status && status.length > 0 ? { status: { [Op.in]: status } } : {};
}

export async function listPurchaseRequests(
  params: PaginationParams,
): Promise<{ items: PurchaseRequestModel[]; total: number }> {
  const { rows, count } = await PurchaseRequestModel.findAndCountAll({
    where: { ...buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like), ...buildStatusWhere(params.status) },
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
    where: {
      ...buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
      ...buildStatusWhere(params.status),
      approverId,
    },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    include: includeParties,
  });
  return { items: rows, total: count };
}

// Solo lo que le corresponde SEGUIR al solicitante (badge de notificaciones
// de la Fase B, pantalla de adjuntar OC de la Fase C): espejo exacto de
// listPurchaseRequestsForApprover pero filtrando por requesterId en vez de
// approverId.
export async function listPurchaseRequestsForRequester(
  requesterId: number,
  params: PaginationParams,
): Promise<{ items: PurchaseRequestModel[]; total: number }> {
  const { rows, count } = await PurchaseRequestModel.findAndCountAll({
    where: {
      ...buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like),
      ...buildStatusWhere(params.status),
      requesterId,
    },
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

// Validaciones del alta, compartidas por "Nueva Solicitud" y por la solicitud
// de equipo del portal (createPurchaseRequestWithLines).
async function assertPurchaseRequestParties(data: PurchaseRequestCreationAttributes): Promise<void> {
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
}

// requestNumber (SOL000000001...) se genera dentro de la MISMA transaccion
// que el insert de la cabecera: si algo despues falla y se hace rollback,
// el numero tambien se revierte -no queda "quemado". Ver
// library/documentNumbering.ts.
export async function createPurchaseRequest(
  data: PurchaseRequestCreationAttributes,
): Promise<PurchaseRequestModel> {
  await assertPurchaseRequestParties(data);

  const request = await mssql.transaction(async (transaction) => {
    const requestNumber = await generateDocumentNumber("SOL", transaction);
    return PurchaseRequestModel.create({ ...data, requestNumber }, { transaction });
  });

  const created = await getPurchaseRequestByIdOrThrow(request.id);
  notifyPendingRequestApproval(data.approverId, created);
  return created;
}

export interface PurchaseRequestLineDraft {
  productId: string;
  quantity: number;
}

// Solicitud de equipo desde el portal (plan 010): cabecera y TODAS sus lineas
// en la transaccion del llamador -o queda la solicitud completa o no queda
// nada, a diferencia de "Nueva Solicitud", que mandaba una linea por request.
// El llamador hace el commit y recien despues avisa al aprobador con
// notifyPurchaseRequestCreated. equipmentType = nombre de la categoria del
// producto, igual que en "Nueva Solicitud".
export async function createPurchaseRequestWithLines(
  data: PurchaseRequestCreationAttributes,
  lines: PurchaseRequestLineDraft[],
  transaction: Transaction,
): Promise<PurchaseRequestModel> {
  if (lines.length === 0) throw new BadRequestError("La solicitud debe llevar al menos un producto");
  await assertPurchaseRequestParties(data);

  const productIds = [...new Set(lines.map((line) => line.productId))];
  const products = await getProductsByIds(productIds);
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  for (const productId of productIds) {
    if (!productsById.get(productId)?.isActive) throw new BadRequestError(`El producto ${productId} no existe o esta inactivo`);
  }
  const categoryIds = products.flatMap((product) => (product.categoryId ? [String(product.categoryId)] : []));
  const categories = await getProductCategoriesByIds(categoryIds);
  const categoryNames = new Map(categories.map((category) => [String(category._id), category.name]));

  const requestNumber = await generateDocumentNumber("SOL", transaction);
  const request = await PurchaseRequestModel.create({ ...data, requestNumber }, { transaction });
  await PurchaseRequestLineModel.bulkCreate(
    lines.map((line) => {
      const categoryId = productsById.get(line.productId)!.categoryId;
      return {
        requestId: request.id,
        productId: line.productId,
        quantity: line.quantity,
        equipmentType: categoryId ? (categoryNames.get(String(categoryId)) ?? null) : null,
        createdBy: data.createdBy ?? null,
      };
    }),
    { transaction },
  );
  return request;
}

export function notifyPurchaseRequestCreated(request: PurchaseRequestModel): void {
  if (request.approverId !== null) notifyPendingRequestApproval(request.approverId, request);
}

// El solicitante retira su propia solicitud antes de que alguien la apruebe
// (plan 010, al anular el ticket de la solicitud de equipo). No pasa por la
// regla del aprobador asignado: no decide sobre la compra, la desiste. El
// UPDATE condicionado evita la carrera con una aprobacion en curso.
export async function withdrawPurchaseRequest(id: number, updatedBy: number): Promise<void> {
  const [affected] = await PurchaseRequestModel.update(
    { status: "CANCELLED", updatedBy },
    { where: { id, status: { [Op.in]: ["DRAFT", "SUBMITTED"] } } },
  );
  if (affected === 0) {
    throw new ConflictError("La solicitud de compra ya se esta tramitando: pida la anulacion en un comentario");
  }
  emitPurchaseRequestStatusChanged(id);
}

// Estado actual de varias solicitudes (sincronizacion con los tickets del Service Desk).
export async function getPurchaseRequestStatuses(
  ids: number[],
): Promise<Map<number, { requestNumber: string; status: string; updatedBy: number | null }>> {
  if (ids.length === 0) return new Map();
  const rows = await PurchaseRequestModel.findAll({
    where: { id: { [Op.in]: [...new Set(ids)] } },
    attributes: ["id", "requestNumber", "status", "updatedBy"],
  });
  return new Map(rows.map((row) => [row.id, { requestNumber: row.requestNumber, status: row.status, updatedBy: row.updatedBy }]));
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

// Segregacion de funciones: solo el aprobador ASIGNADO a esta solicitud
// puede actuar sobre ella (aprobar/rechazar/cancelar el header, y en la Fase
// B tambien elegir la cotizacion ganadora) -no cualquier usuario con el
// permiso generico purchase-requests:approve. Deliberadamente SIN bypass de
// admin (a diferencia de authorize()): un admin saltandose esta regla ya no
// es segregacion de funciones. No "arreglar" esto agregando un atajo para
// admin mas adelante.
export function assertIsAssignedApprover(request: PurchaseRequestModel, userId: number): void {
  if (request.approverId !== userId) {
    throw new ForbiddenError("Solo el aprobador asignado a esta solicitud puede actuar sobre ella");
  }
}

export async function updatePurchaseRequestStatus(
  id: number,
  status: PurchaseRequestStatus,
  updatedBy?: number,
): Promise<PurchaseRequestModel> {
  const request = await getPurchaseRequestByIdOrThrow(id);
  assertPurchaseRequestTransition(request.status as PurchaseRequestStatus, status);
  if (status === "APPROVED" || status === "REJECTED" || status === "CANCELLED") {
    // Sin actor identificado no se puede verificar que sea el aprobador
    // asignado -fail closed, no se asume que esta bien.
    if (updatedBy === undefined) throw new ForbiddenError("No se pudo identificar al usuario que realiza la accion");
    assertIsAssignedApprover(request, updatedBy);
  }
  const changed = request.status !== status;
  await request.update({ status, updatedBy });
  if (changed) emitPurchaseRequestStatusChanged(id);
  return request;
}

// Paso 3 del flujo: el analista/supervisor de adquisiciones (quotes:create)
// abre la etapa de cotizacion sobre una solicitud ya APPROVED.
export async function requestQuotation(requestId: number, updatedBy: number): Promise<PurchaseRequestModel> {
  const request = await getPurchaseRequestByIdOrThrow(requestId);
  assertPurchaseRequestTransition(request.status as PurchaseRequestStatus, "IN_QUOTATION");
  await request.update({ status: "IN_QUOTATION", updatedBy });
  emitPurchaseRequestStatusChanged(requestId);
  return request;
}

// Paso 4 del flujo ("Solicitar Autorización"): cierra la carga de
// cotizaciones (ver el gate en quote.service.ts, createQuote/
// attachQuoteDocument exigen IN_QUOTATION) y deja la solicitud esperando que
// el aprobador asignado elija la cotizacion ganadora (Fase B).
export async function requestQuoteApproval(requestId: number, updatedBy: number): Promise<PurchaseRequestModel> {
  const request = await getPurchaseRequestByIdOrThrow(requestId);
  assertPurchaseRequestTransition(request.status as PurchaseRequestStatus, "APPROVE_QUOTE");
  const quoteCount = await QuoteModel.count({ where: { requestId } });
  if (quoteCount === 0) {
    throw new BadRequestError("La solicitud no tiene ninguna cotizacion cargada todavia");
  }
  await request.update({ status: "APPROVE_QUOTE", updatedBy });
  emitPurchaseRequestStatusChanged(requestId);
  if (request.approverId !== null) {
    notifyPendingQuoteApproval(request.approverId, request);
  }
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

  const pdfPath = path.join(
    getQuoteRequestFolder(request.requestNumber),
    `SOLCOT-${sanitizeFilenameSegment(businessPartner.nationalId)}.pdf`,
  );
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
