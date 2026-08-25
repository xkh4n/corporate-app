import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { ConflictError, ForbiddenError } from "../../library/errors";
import { createPerson } from "./person.service";
import { createUser } from "./user.service";
import { createBusinessPartner } from "./businessPartner.service";
import { createSupplier } from "./supplier.service";
import { createSupplierContact } from "./supplierContact.service";
import { getSupplierServiceTypeByCode } from "./supplierServiceType.service";
import { getSupplierDeliveryTermsByCode } from "./supplierDeliveryTerms.service";
import { getRoleByName } from "../postgres/role.service";
import { createCostCenter } from "../postgres/costCenter.service";
import { createProduct } from "../mongo/product.service";
import { createLine, updateLine } from "./purchaseRequestLine.service";
import { createQuote } from "./quote.service";
import {
  createPurchaseRequest,
  getPurchaseRequestByIdOrThrow,
  requestQuotation,
  requestQuoteApproval,
  updatePurchaseRequestStatus,
} from "./purchaseRequest.service";
import { createAuthorization } from "./authorization.service";
import { attachPurchaseOrderDocument, createPurchaseOrder, sendPurchaseOrderToSupplier } from "./purchaseOrder.service";
import * as mailerClient from "../../library/mailerClient";

let seq = 0;

const RESET_TABLES = {
  mssql: [
    "purchase_orders",
    "authorizations",
    "quotes",
    "purchase_request_lines",
    "purchase_requests",
    "supplier_contacts",
    "suppliers",
    "business_partners",
    "users",
    "persons",
  ],
  postgres: ["cost_centers"],
  mongo: ["Product"],
};

beforeEach(async () => {
  await resetTestData(RESET_TABLES);
});

afterEach(async () => {
  await resetTestData(RESET_TABLES);
  vi.restoreAllMocks();
});

async function createFixturePerson() {
  const id = ++seq;
  return createPerson({
    firstName: "Test",
    lastName: `Persona${id}`,
    documentId: `TESTDOC-PO${id}`,
    email: `test-po-persona-${id}@example.com`,
  });
}

async function createFixtureApproverUser() {
  const adminRole = await getRoleByName("admin");
  if (!adminRole) throw new Error('Falta el rol "admin" sembrado -revisar migratePostgres()');
  const person = await createFixturePerson();
  return createUser({ personId: person.id, roleId: adminRole.id, username: `testpo${++seq}` });
}

async function createFixtureSupplier() {
  const id = ++seq;
  const businessPartner = await createBusinessPartner({
    legalName: `Proveedor de prueba PO${id}`,
    nationalId: `TESTSUPPO-${id}`,
  });
  const serviceType = await getSupplierServiceTypeByCode("ARRIENDO");
  const deliveryTerms = await getSupplierDeliveryTermsByCode("CREDITO");
  if (!serviceType || !deliveryTerms) {
    throw new Error('Faltan los lookups sembrados "ARRIENDO"/"CREDITO" -revisar migrateSupplierLookups()');
  }
  const supplier = await createSupplier({
    businessPartnerId: businessPartner.id,
    serviceTypeId: serviceType.id,
    deliveryTermsId: deliveryTerms.id,
  });
  await createSupplierContact({ supplierId: supplier.id, name: `Contacto ${id}`, email: `contacto-po-${id}@example.com` });
  return supplier;
}

// Request con UNA linea APPROVED, su cotizacion ya SELECTED (autorizada) y
// la solicitud en QUOTE_APPROVED -listo para emitir la OC.
async function createFixtureAtQuoteApproved() {
  const requesterPerson = await createFixturePerson();
  const beneficiary = await createFixturePerson();
  const costCenter = await createCostCenter({ code: 86000 + seq++, name: "Centro de prueba" });
  const approver = await createFixtureApproverUser();
  const request = await createPurchaseRequest({
    requesterId: requesterPerson.id,
    beneficiaryId: beneficiary.id,
    costCenterId: costCenter.id,
    approverId: approver.id,
  });
  await updatePurchaseRequestStatus(request.id, "APPROVED", approver.id);
  await requestQuotation(request.id, approver.id);

  const product = await createProduct({ name: `Producto de prueba PO${++seq}`, productType: "COMPRA" });
  const line = await createLine({ requestId: request.id, productId: String(product._id), quantity: 2 });
  await updateLine(line.id, { status: "APPROVED" });

  const supplier = await createFixtureSupplier();
  const quote = await createQuote({
    requestId: request.id,
    productId: String(product._id),
    supplierId: supplier.id,
    purchaseValue: "500.00",
  });

  await requestQuoteApproval(request.id, approver.id);
  await createAuthorization({
    requestLineId: line.id,
    quoteId: quote.id,
    approverId: approver.id,
    approvedQuantity: line.quantity,
  });

  return { request, approver, requesterPerson, line, quote, supplier };
}

const fakePdfFile = { mimetype: "application/pdf", buffer: Buffer.from("test") } as Express.Multer.File;

describe("purchaseOrder.service (integracion, MSSQL real)", () => {
  describe("createPurchaseOrder", () => {
    it("emite la OC cuando la solicitud esta QUOTE_APPROVED y el actor es el solicitante", async () => {
      const { requesterPerson, quote } = await createFixtureAtQuoteApproved();
      const order = await createPurchaseOrder({ quoteId: quote.id }, requesterPerson.id);
      expect(order.quoteId).toBe(quote.id);
      expect(order.supplierId).toBe(quote.supplierId);
    });

    it("rechaza (ConflictError) fuera de QUOTE_APPROVED (cotizacion ya SELECTED pero otra linea de la misma solicitud todavia sin autorizar)", async () => {
      // Solicitud con 2 lineas APPROVED: autorizar SOLO la primera deja la
      // cotizacion en SELECTED pero la solicitud sigue en APPROVE_QUOTE (ver
      // areAllApprovedLinesAuthorized) -mismo escenario multi-linea que
      // ejercita el guard "no en la primera" de attachPurchaseOrderDocument.
      const requesterPerson = await createFixturePerson();
      const beneficiary = await createFixturePerson();
      const costCenter = await createCostCenter({ code: 86500 + seq++, name: "Centro de prueba" });
      const approver = await createFixtureApproverUser();
      const request = await createPurchaseRequest({
        requesterId: requesterPerson.id,
        beneficiaryId: beneficiary.id,
        costCenterId: costCenter.id,
        approverId: approver.id,
      });
      await updatePurchaseRequestStatus(request.id, "APPROVED", approver.id);
      await requestQuotation(request.id, approver.id);

      const productA = await createProduct({ name: `Producto A PO${++seq}`, productType: "COMPRA" });
      const productB = await createProduct({ name: `Producto B PO${++seq}`, productType: "COMPRA" });
      const lineA = await createLine({ requestId: request.id, productId: String(productA._id), quantity: 1 });
      const lineB = await createLine({ requestId: request.id, productId: String(productB._id), quantity: 1 });
      await updateLine(lineA.id, { status: "APPROVED" });
      await updateLine(lineB.id, { status: "APPROVED" });

      const supplier = await createFixtureSupplier();
      const quoteA = await createQuote({
        requestId: request.id,
        productId: String(productA._id),
        supplierId: supplier.id,
        purchaseValue: "10.00",
      });
      await createQuote({
        requestId: request.id,
        productId: String(productB._id),
        supplierId: supplier.id,
        purchaseValue: "20.00",
      });

      await requestQuoteApproval(request.id, approver.id);
      await createAuthorization({
        requestLineId: lineA.id,
        quoteId: quoteA.id,
        approverId: approver.id,
        approvedQuantity: lineA.quantity,
      });
      // lineB nunca se autoriza -la solicitud queda en APPROVE_QUOTE.
      expect((await getPurchaseRequestByIdOrThrow(request.id)).status).toBe("APPROVE_QUOTE");

      await expect(createPurchaseOrder({ quoteId: quoteA.id }, requesterPerson.id)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("rechaza con ForbiddenError a un actor distinto del solicitante original", async () => {
      const { quote } = await createFixtureAtQuoteApproved();
      const otherPerson = await createFixturePerson();
      await expect(createPurchaseOrder({ quoteId: quote.id }, otherPerson.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("rechaza (ConflictError) una segunda OC para la misma cotizacion", async () => {
      const { requesterPerson, quote } = await createFixtureAtQuoteApproved();
      await createPurchaseOrder({ quoteId: quote.id }, requesterPerson.id);
      await expect(createPurchaseOrder({ quoteId: quote.id }, requesterPerson.id)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });
  });

  describe("attachPurchaseOrderDocument", () => {
    it("flipea la solicitud a OC_GENERATED cuando la unica cotizacion ganadora ya tiene su OC adjuntada", async () => {
      const { requesterPerson, approver, quote, request } = await createFixtureAtQuoteApproved();
      const order = await createPurchaseOrder({ quoteId: quote.id }, requesterPerson.id);

      // userId (tercer argumento, ver makeAttachmentHandler): un User real
      // cualquiera con permiso para actuar -no tiene que ser el solicitante
      // en si (que es un Person, no necesariamente tiene cuenta).
      await attachPurchaseOrderDocument(order.id, fakePdfFile, approver.id);

      const refreshed = await getPurchaseRequestByIdOrThrow(request.id);
      expect(refreshed.status).toBe("OC_GENERATED");
    });
  });

  describe("sendPurchaseOrderToSupplier", () => {
    it("flipea a PENDING_DELIVERY solo si el mailer responde ok (mockeado)", async () => {
      const { requesterPerson, approver, quote, request } = await createFixtureAtQuoteApproved();
      const order = await createPurchaseOrder({ quoteId: quote.id }, requesterPerson.id);
      await attachPurchaseOrderDocument(order.id, fakePdfFile, approver.id);

      vi.spyOn(mailerClient, "sendMailViaMailer").mockResolvedValueOnce({ ok: false, error: "simulado: mailer caido" });
      const failedResult = await sendPurchaseOrderToSupplier(order.id, approver.id);
      expect(failedResult.sent).toBe(false);
      expect((await getPurchaseRequestByIdOrThrow(request.id)).status).toBe("OC_GENERATED");

      vi.spyOn(mailerClient, "sendMailViaMailer").mockResolvedValueOnce({ ok: true });
      const okResult = await sendPurchaseOrderToSupplier(order.id, approver.id);
      expect(okResult.sent).toBe(true);
      expect((await getPurchaseRequestByIdOrThrow(request.id)).status).toBe("PENDING_DELIVERY");
    });

    it("rechaza (ConflictError) antes de que exista el PDF de la OC (todavia no adjuntada)", async () => {
      const { requesterPerson, approver, quote } = await createFixtureAtQuoteApproved();
      const order = await createPurchaseOrder({ quoteId: quote.id }, requesterPerson.id);
      // Sin attachPurchaseOrderDocument: la solicitud sigue en QUOTE_APPROVED,
      // no en OC_GENERATED/PENDING_DELIVERY.
      await expect(sendPurchaseOrderToSupplier(order.id, approver.id)).rejects.toBeInstanceOf(ConflictError);
    });
  });
});
