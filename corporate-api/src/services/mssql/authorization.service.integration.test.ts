import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { ConflictError, ForbiddenError } from "../../library/errors";
import { createPerson } from "./person.service";
import { createUser } from "./user.service";
import { createBusinessPartner } from "./businessPartner.service";
import { createSupplier } from "./supplier.service";
import { getSupplierServiceTypeByCode } from "./supplierServiceType.service";
import { getSupplierDeliveryTermsByCode } from "./supplierDeliveryTerms.service";
import { getRoleByName } from "../postgres/role.service";
import { createCostCenter } from "../postgres/costCenter.service";
import { createProduct } from "../mongo/product.service";
import { createLine, updateLine } from "./purchaseRequestLine.service";
import { createQuote, getQuoteByIdOrThrow } from "./quote.service";
import {
  createPurchaseRequest,
  getPurchaseRequestByIdOrThrow,
  requestQuotation,
  requestQuoteApproval,
  updatePurchaseRequestStatus,
} from "./purchaseRequest.service";
import { createAuthorization } from "./authorization.service";

let seq = 0;

const RESET_TABLES = {
  mssql: ["authorizations", "quotes", "purchase_request_lines", "purchase_requests", "suppliers", "business_partners", "users", "persons"],
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
    documentId: `TESTDOC-A${id}`,
    email: `test-auth-persona-${id}@example.com`,
  });
}

async function createFixtureApproverUser() {
  const adminRole = await getRoleByName("admin");
  if (!adminRole) throw new Error('Falta el rol "admin" sembrado -revisar migratePostgres()');
  const person = await createFixturePerson();
  return createUser({ personId: person.id, roleId: adminRole.id, username: `testauth${++seq}` });
}

async function createFixtureSupplier() {
  const id = ++seq;
  const businessPartner = await createBusinessPartner({
    legalName: `Proveedor de prueba A${id}`,
    nationalId: `TESTSUPA-${id}`,
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

// Request con UNA linea APPROVED y 2 cotizaciones competidoras (mismo
// producto, distinto proveedor) para esa linea, ya en APPROVE_QUOTE -listo
// para autorizar.
async function createFixtureReadyForAuthorization() {
  const requester = await createFixturePerson();
  const beneficiary = await createFixturePerson();
  const costCenter = await createCostCenter({ code: 84000 + seq++, name: "Centro de prueba" });
  const approver = await createFixtureApproverUser();
  const request = await createPurchaseRequest({
    requesterId: requester.id,
    beneficiaryId: beneficiary.id,
    costCenterId: costCenter.id,
    approverId: approver.id,
  });
  await updatePurchaseRequestStatus(request.id, "APPROVED", approver.id);
  await requestQuotation(request.id, approver.id);

  const product = await createProduct({ name: `Producto de prueba A${++seq}`, productType: "COMPRA" });
  const line = await createLine({ requestId: request.id, productId: String(product._id), quantity: 3 });
  await updateLine(line.id, { status: "APPROVED" });

  const winningSupplier = await createFixtureSupplier();
  const losingSupplier = await createFixtureSupplier();
  const winningQuote = await createQuote({
    requestId: request.id,
    productId: String(product._id),
    supplierId: winningSupplier.id,
    purchaseValue: "100.00",
  });
  const losingQuote = await createQuote({
    requestId: request.id,
    productId: String(product._id),
    supplierId: losingSupplier.id,
    purchaseValue: "120.00",
  });

  await requestQuoteApproval(request.id, approver.id);

  return { request, approver, requester, line, winningQuote, losingQuote, product };
}

describe("authorization.service (integracion, MSSQL real)", () => {
  describe("createAuthorization / decision A (approverId restringido al asignado)", () => {
    it("rechaza con ForbiddenError a un approverId distinto del asignado, incluso si el caller lo manda", async () => {
      const { line, winningQuote } = await createFixtureReadyForAuthorization();
      const otherApprover = await createFixtureApproverUser();

      await expect(
        createAuthorization({
          requestLineId: line.id,
          quoteId: winningQuote.id,
          approverId: otherApprover.id,
          approvedQuantity: 1,
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("rechaza (ConflictError) fuera de APPROVE_QUOTE", async () => {
      const requester = await createFixturePerson();
      const beneficiary = await createFixturePerson();
      const costCenter = await createCostCenter({ code: 84500 + seq++, name: "Centro de prueba" });
      const approver = await createFixtureApproverUser();
      const request = await createPurchaseRequest({
        requesterId: requester.id,
        beneficiaryId: beneficiary.id,
        costCenterId: costCenter.id,
        approverId: approver.id,
      });
      await updatePurchaseRequestStatus(request.id, "APPROVED", approver.id);
      await requestQuotation(request.id, approver.id);
      // Se queda en IN_QUOTATION a proposito -nunca llega a APPROVE_QUOTE.

      const product = await createProduct({ name: `Producto de prueba A${++seq}`, productType: "COMPRA" });
      const line = await createLine({ requestId: request.id, productId: String(product._id), quantity: 1 });
      await updateLine(line.id, { status: "APPROVED" });
      const supplier = await createFixtureSupplier();
      const quote = await createQuote({
        requestId: request.id,
        productId: String(product._id),
        supplierId: supplier.id,
        purchaseValue: "50.00",
      });

      await expect(
        createAuthorization({ requestLineId: line.id, quoteId: quote.id, approverId: approver.id, approvedQuantity: 1 }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("marca REJECTED las cotizaciones competidoras del mismo producto al elegir ganadora", async () => {
      const { approver, line, winningQuote, losingQuote } = await createFixtureReadyForAuthorization();

      await createAuthorization({
        requestLineId: line.id,
        quoteId: winningQuote.id,
        approverId: approver.id,
        approvedQuantity: line.quantity,
      });

      const refreshedWinner = await getQuoteByIdOrThrow(winningQuote.id);
      const refreshedLoser = await getQuoteByIdOrThrow(losingQuote.id);
      expect(refreshedWinner.status).toBe("SELECTED");
      expect(refreshedLoser.status).toBe("REJECTED");
    });
  });

  describe("cierre del paso 5->6 (QUOTE_APPROVED)", () => {
    it("pasa la solicitud a QUOTE_APPROVED solo cuando TODAS las lineas APPROVED tienen ganador, no en la primera", async () => {
      const requester = await createFixturePerson();
      const beneficiary = await createFixturePerson();
      const costCenter = await createCostCenter({ code: 85000 + seq++, name: "Centro de prueba" });
      const approver = await createFixtureApproverUser();
      const request = await createPurchaseRequest({
        requesterId: requester.id,
        beneficiaryId: beneficiary.id,
        costCenterId: costCenter.id,
        approverId: approver.id,
      });
      await updatePurchaseRequestStatus(request.id, "APPROVED", approver.id);
      await requestQuotation(request.id, approver.id);

      const productA = await createProduct({ name: `Producto A${++seq}`, productType: "COMPRA" });
      const productB = await createProduct({ name: `Producto B${++seq}`, productType: "COMPRA" });
      const lineA = await createLine({ requestId: request.id, productId: String(productA._id), quantity: 2 });
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
      const quoteB = await createQuote({
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
      expect((await getPurchaseRequestByIdOrThrow(request.id)).status).toBe("APPROVE_QUOTE");

      await createAuthorization({
        requestLineId: lineB.id,
        quoteId: quoteB.id,
        approverId: approver.id,
        approvedQuantity: lineB.quantity,
      });
      expect((await getPurchaseRequestByIdOrThrow(request.id)).status).toBe("QUOTE_APPROVED");
    });
  });
});
