import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { ConflictError } from "../../library/errors";
import { createPerson } from "./person.service";
import { createUser } from "./user.service";
import { createBusinessPartner } from "./businessPartner.service";
import { createSupplier } from "./supplier.service";
import { getSupplierServiceTypeByCode } from "./supplierServiceType.service";
import { getSupplierDeliveryTermsByCode } from "./supplierDeliveryTerms.service";
import {
  createPurchaseRequest,
  requestQuotation,
  requestQuoteApproval,
  updatePurchaseRequestStatus,
} from "./purchaseRequest.service";
import { getRoleByName } from "../postgres/role.service";
import { createCostCenter } from "../postgres/costCenter.service";
import { createProduct } from "../mongo/product.service";
import { attachQuoteDocument, createQuote } from "./quote.service";

let seq = 0;

const RESET_TABLES = {
  mssql: ["quotes", "purchase_requests", "suppliers", "business_partners", "users", "persons"],
  postgres: ["cost_centers"],
  mongo: ["Product"],
};

beforeEach(async () => {
  await resetTestData(RESET_TABLES);
});

afterEach(async () => {
  await resetTestData(RESET_TABLES);
});

async function createFixturePerson() {
  const id = ++seq;
  return createPerson({
    firstName: "Test",
    lastName: `Persona${id}`,
    documentId: `TESTDOC-Q${id}`,
    email: `test-quote-persona-${id}@example.com`,
  });
}

async function createFixtureApproverUser() {
  const adminRole = await getRoleByName("admin");
  if (!adminRole) throw new Error('Falta el rol "admin" sembrado -revisar migratePostgres()');
  const person = await createFixturePerson();
  return createUser({ personId: person.id, roleId: adminRole.id, username: `testqappr${++seq}` });
}

async function createFixtureSupplier() {
  const id = ++seq;
  const businessPartner = await createBusinessPartner({
    legalName: `Proveedor de prueba Q${id}`,
    nationalId: `TESTSUPQ-${id}`,
  });
  const serviceType = await getSupplierServiceTypeByCode("ARRIENDO");
  const deliveryTerms = await getSupplierDeliveryTermsByCode("CREDITO");
  if (!serviceType || !deliveryTerms) {
    throw new Error('Faltan los lookups sembrados "ARRIENDO"/"CREDITO" -revisar migrateSupplierLookups()');
  }
  return createSupplier({
    businessPartnerId: businessPartner.id,
    serviceTypeId: serviceType.id,
    deliveryTermsId: deliveryTerms.id,
  });
}

// Request en IN_QUOTATION (el unico estado donde createQuote/
// attachQuoteDocument aceptan trabajo) -atraviesa DRAFT->APPROVED->
// IN_QUOTATION igual que lo haria el flujo real (pasos 2 y 3).
async function createFixtureRequestInQuotation() {
  const requester = await createFixturePerson();
  const beneficiary = await createFixturePerson();
  const costCenter = await createCostCenter({ code: 81000 + seq++, name: "Centro de prueba" });
  const approver = await createFixtureApproverUser();
  const request = await createPurchaseRequest({
    requesterId: requester.id,
    beneficiaryId: beneficiary.id,
    costCenterId: costCenter.id,
    approverId: approver.id,
  });
  await updatePurchaseRequestStatus(request.id, "APPROVED", approver.id);
  return requestQuotation(request.id, approver.id);
}

describe("quote.service (integracion, MSSQL real)", () => {
  describe("createQuote", () => {
    it("crea la cotizacion cuando la solicitud esta IN_QUOTATION", async () => {
      const request = await createFixtureRequestInQuotation();
      const supplier = await createFixtureSupplier();
      const product = await createProduct({ name: `Producto de prueba ${++seq}`, productType: "COMPRA" });

      const quote = await createQuote({
        requestId: request.id,
        productId: String(product._id),
        supplierId: supplier.id,
        purchaseValue: "150.50",
      });

      expect(quote.requestId).toBe(request.id);
      expect(quote.status).toBe("PENDING");
    });

    it("rechaza (ConflictError) fuera de IN_QUOTATION", async () => {
      const requester = await createFixturePerson();
      const beneficiary = await createFixturePerson();
      const costCenter = await createCostCenter({ code: 82000 + seq++, name: "Centro de prueba" });
      const approver = await createFixtureApproverUser();
      // Se queda en DRAFT a proposito -nunca pasa por APPROVED/IN_QUOTATION.
      const request = await createPurchaseRequest({
        requesterId: requester.id,
        beneficiaryId: beneficiary.id,
        costCenterId: costCenter.id,
        approverId: approver.id,
      });
      const supplier = await createFixtureSupplier();
      const product = await createProduct({ name: `Producto de prueba ${++seq}`, productType: "COMPRA" });

      await expect(
        createQuote({ requestId: request.id, productId: String(product._id), supplierId: supplier.id, purchaseValue: "10.00" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("attachQuoteDocument", () => {
    it("rechaza (ConflictError) si la solicitud ya salio de IN_QUOTATION", async () => {
      const request = await createFixtureRequestInQuotation();
      const supplier = await createFixtureSupplier();
      const product = await createProduct({ name: `Producto de prueba ${++seq}`, productType: "COMPRA" });
      const quote = await createQuote({
        requestId: request.id,
        productId: String(product._id),
        supplierId: supplier.id,
        purchaseValue: "200.00",
      });

      // "Solicitar Autorización" (paso 4): cierra la carga de cotizaciones.
      await requestQuoteApproval(request.id, request.approverId!);

      const fakeFile = { mimetype: "application/pdf", buffer: Buffer.from("test") } as Express.Multer.File;
      await expect(attachQuoteDocument(quote.id, fakeFile)).rejects.toBeInstanceOf(ConflictError);
    });
  });
});
