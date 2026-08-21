import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { createPerson } from "./person.service";
import { createUser } from "./user.service";
import { createBusinessPartner } from "./businessPartner.service";
import { createSupplier } from "./supplier.service";
import { getSupplierServiceTypeByCode } from "./supplierServiceType.service";
import { getSupplierDeliveryTermsByCode } from "./supplierDeliveryTerms.service";
import { getRoleByName } from "../postgres/role.service";
import { createCostCenter } from "../postgres/costCenter.service";
import { createPurchaseRequest, requestQuotation, requestQuoteApproval, updatePurchaseRequestStatus } from "./purchaseRequest.service";
import { QuoteModel } from "../../models/mssql/quote.model";
import { getPendingSummary } from "./notification.service";

let seq = 0;

const RESET_TABLES = {
  mssql: ["quotes", "purchase_requests", "suppliers", "business_partners", "users", "persons"],
  postgres: ["cost_centers"],
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
    documentId: `TESTDOC-N${id}`,
    email: `test-notif-persona-${id}@example.com`,
  });
}

async function createFixtureApproverUser() {
  const adminRole = await getRoleByName("admin");
  if (!adminRole) throw new Error('Falta el rol "admin" sembrado -revisar migratePostgres()');
  const person = await createFixturePerson();
  return createUser({ personId: person.id, roleId: adminRole.id, username: `testnotif${++seq}` });
}

async function createFixtureSupplier() {
  const id = ++seq;
  const businessPartner = await createBusinessPartner({
    legalName: `Proveedor de prueba N${id}`,
    nationalId: `TESTSUPN-${id}`,
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

async function createFixtureRequest(approverId: number, requesterId?: number) {
  const resolvedRequesterId = requesterId ?? (await createFixturePerson()).id;
  const beneficiary = await createFixturePerson();
  const costCenter = await createCostCenter({ code: 83000 + seq++, name: "Centro de prueba" });

  return createPurchaseRequest({
    requesterId: resolvedRequesterId,
    beneficiaryId: beneficiary.id,
    costCenterId: costCenter.id,
    approverId,
  });
}

describe("notification.service (integracion, MSSQL real)", () => {
  it("getPendingSummary cuenta correctamente los 3 tipos, aislados por usuario", async () => {
    const approver = await createFixtureApproverUser();
    const otherApprover = await createFixtureApproverUser();
    const requesterPerson = await createFixturePerson();

    // 1) DRAFT asignada a "approver" -pendingRequestApprovals.
    await createFixtureRequest(approver.id);

    // 2) DRAFT asignada a OTRO aprobador -no debe contarse para "approver".
    await createFixtureRequest(otherApprover.id);

    // 3) APPROVE_QUOTE asignada a "approver" -pendingQuoteApprovals.
    const quoteRequest = await createFixtureRequest(approver.id);
    await updatePurchaseRequestStatus(quoteRequest.id, "APPROVED", approver.id);
    await requestQuotation(quoteRequest.id, approver.id);
    const supplier = await createFixtureSupplier();
    await QuoteModel.create({
      quoteNumber: `COT-NOTIF-${quoteRequest.id}`,
      requestId: quoteRequest.id,
      productId: "000000000000000000000001",
      supplierId: supplier.id,
      purchaseValue: "100.00",
    });
    await requestQuoteApproval(quoteRequest.id, approver.id);

    // 4) QUOTE_APPROVED cuyo requesterId ES requesterPerson -pendingPurchaseOrders,
    // contado por personId, no por userId (distinto de los dos de arriba).
    const poRequest = await createFixtureRequest(approver.id, requesterPerson.id);
    await updatePurchaseRequestStatus(poRequest.id, "APPROVED", approver.id);
    await updatePurchaseRequestStatus(poRequest.id, "IN_QUOTATION", approver.id);
    await updatePurchaseRequestStatus(poRequest.id, "APPROVE_QUOTE", approver.id);
    await updatePurchaseRequestStatus(poRequest.id, "QUOTE_APPROVED", approver.id);

    const summary = await getPendingSummary(approver.id, requesterPerson.id);

    expect(summary.pendingRequestApprovals).toBe(1);
    expect(summary.pendingQuoteApprovals).toBe(1);
    expect(summary.pendingPurchaseOrders).toBe(1);
    expect(summary.total).toBe(3);
  });

  it("devuelve todo en cero para un usuario sin nada pendiente", async () => {
    const approver = await createFixtureApproverUser();
    const summary = await getPendingSummary(approver.id, 999999);
    expect(summary).toEqual({
      pendingRequestApprovals: 0,
      pendingQuoteApprovals: 0,
      pendingPurchaseOrders: 0,
      total: 0,
    });
  });
});
