import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { BadRequestError, ConflictError, ForbiddenError } from "../../library/errors";
import { createPerson } from "./person.service";
import { createUser } from "./user.service";
import { createBusinessPartner } from "./businessPartner.service";
import { createSupplier } from "./supplier.service";
import { getSupplierServiceTypeByCode } from "./supplierServiceType.service";
import { getSupplierDeliveryTermsByCode } from "./supplierDeliveryTerms.service";
import { getRoleByName } from "../postgres/role.service";
import { createCostCenter } from "../postgres/costCenter.service";
import { QuoteModel } from "../../models/mssql/quote.model";
import {
  assertIsAssignedApprover,
  createPurchaseRequest,
  requestQuotation,
  requestQuoteApproval,
  updatePurchaseRequestStatus,
} from "./purchaseRequest.service";

// admin ya viene sembrado (migratePostgres) con TODOS los permisos tras
// seedPermissions() (ver test/setupIntegration.ts) -alcanza como rol de
// fixture para el aprobador de estos tests, sin tener que armar un rol +
// role_permissions propio solo para esto.
let adminRoleId: number;
let seq = 0;

beforeAll(async () => {
  const adminRole = await getRoleByName("admin");
  if (!adminRole) throw new Error('Falta el rol "admin" sembrado -revisar migratePostgres()');
  adminRoleId = adminRole.id;
});

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
    documentId: `TESTDOC-${id}`,
    email: `test-persona-${id}@example.com`,
  });
}

async function createFixtureApproverUser() {
  const person = await createFixturePerson();
  return createUser({ personId: person.id, roleId: adminRoleId, username: `testappr${++seq}` });
}

// ARRIENDO/CREDITO ya vienen sembrados por migrateMssql() (ver migrate.ts,
// migrateSupplierLookups) -no se crean de nuevo por test, se reusan como
// referencia compartida (nunca se borran en resetTestData).
async function createFixtureSupplier() {
  const id = ++seq;
  const businessPartner = await createBusinessPartner({
    legalName: `Proveedor de prueba ${id}`,
    nationalId: `TESTSUP-${id}`,
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

async function createFixtureRequest() {
  const requester = await createFixturePerson();
  const beneficiary = await createFixturePerson();
  const costCenter = await createCostCenter({ code: 80000 + seq++, name: "Centro de prueba" });
  const approver = await createFixtureApproverUser();

  return createPurchaseRequest({
    requesterId: requester.id,
    beneficiaryId: beneficiary.id,
    costCenterId: costCenter.id,
    approverId: approver.id,
  });
}

describe("purchaseRequest.service (integracion, MSSQL real)", () => {
  describe("requestQuotation", () => {
    it("pasa de APPROVED a IN_QUOTATION", async () => {
      const request = await createFixtureRequest();
      await updatePurchaseRequestStatus(request.id, "APPROVED", request.approverId!);

      const updated = await requestQuotation(request.id, request.approverId!);
      expect(updated.status).toBe("IN_QUOTATION");
    });

    it("rechaza (ConflictError) si la solicitud no esta APPROVED", async () => {
      const request = await createFixtureRequest();
      expect(request.status).toBe("DRAFT");

      await expect(requestQuotation(request.id, request.approverId!)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("requestQuoteApproval", () => {
    it("rechaza con BadRequestError si no hay ninguna cotizacion cargada", async () => {
      const request = await createFixtureRequest();
      await updatePurchaseRequestStatus(request.id, "APPROVED", request.approverId!);
      await requestQuotation(request.id, request.approverId!);

      await expect(requestQuoteApproval(request.id, request.approverId!)).rejects.toBeInstanceOf(BadRequestError);
    });

    it("pasa de IN_QUOTATION a APPROVE_QUOTE cuando hay al menos una cotizacion", async () => {
      const request = await createFixtureRequest();
      await updatePurchaseRequestStatus(request.id, "APPROVED", request.approverId!);
      await requestQuotation(request.id, request.approverId!);

      // Insertado directo por Sequelize (no via createQuote/quote.service.ts):
      // este archivo prueba SOLO requestQuoteApproval, no el pipeline
      // completo de creacion de cotizaciones (eso vive en
      // quote.service.integration.test.ts).
      const supplier = await createFixtureSupplier();
      await QuoteModel.create({
        quoteNumber: `COT-TEST-${request.id}`,
        requestId: request.id,
        productId: "000000000000000000000001",
        supplierId: supplier.id,
        purchaseValue: "100.00",
      });

      const updated = await requestQuoteApproval(request.id, request.approverId!);
      expect(updated.status).toBe("APPROVE_QUOTE");
    });

    it("rechaza (ConflictError) si la solicitud no esta IN_QUOTATION", async () => {
      const request = await createFixtureRequest();
      await expect(requestQuoteApproval(request.id, request.approverId!)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("assertIsAssignedApprover / updatePurchaseRequestStatus", () => {
    it("rechaza con ForbiddenError a un aprobador distinto del asignado", async () => {
      const request = await createFixtureRequest();
      const otherApprover = await createFixtureApproverUser();

      expect(() => assertIsAssignedApprover(request, otherApprover.id)).toThrow(ForbiddenError);
      await expect(updatePurchaseRequestStatus(request.id, "APPROVED", otherApprover.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("permite al aprobador asignado pasar a APPROVED/REJECTED", async () => {
      const request = await createFixtureRequest();

      const approved = await updatePurchaseRequestStatus(request.id, "APPROVED", request.approverId!);
      expect(approved.status).toBe("APPROVED");
    });

    it("respeta la maquina de estados (409 al saltar directo a un estado no alcanzable)", async () => {
      const request = await createFixtureRequest();
      await expect(
        updatePurchaseRequestStatus(request.id, "AVAILABLE", request.approverId!),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });
});
