import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { ConflictError } from "../../library/errors";
import { createPerson } from "../mssql/person.service";
import { createUser } from "../mssql/user.service";
import { createBusinessPartner } from "../mssql/businessPartner.service";
import { createSupplier } from "../mssql/supplier.service";
import { createSupplierContact } from "../mssql/supplierContact.service";
import { getSupplierServiceTypeByCode } from "../mssql/supplierServiceType.service";
import { getSupplierDeliveryTermsByCode } from "../mssql/supplierDeliveryTerms.service";
import { getRoleByName } from "../postgres/role.service";
import { createCostCenter } from "./costCenter.service";
import { createProduct } from "../mongo/product.service";
import { createLine, updateLine } from "../mssql/purchaseRequestLine.service";
import { createQuote } from "../mssql/quote.service";
import {
  createPurchaseRequest,
  getPurchaseRequestByIdOrThrow,
  requestQuotation,
  requestQuoteApproval,
  updatePurchaseRequestStatus,
} from "../mssql/purchaseRequest.service";
import { createAuthorization } from "../mssql/authorization.service";
import { attachPurchaseOrderDocument, createPurchaseOrder, sendPurchaseOrderToSupplier } from "../mssql/purchaseOrder.service";
import * as mailerClient from "../../library/mailerClient";
import { createGoodsReceipt } from "../mssql/goodsReceipt.service";
import { createAssetsFromReceipt, getAssetsByRequestId } from "./asset.service";
import { assignAssetToUser, createAssetMovement } from "./assetMovement.service";

let seq = 0;

const RESET_TABLES = {
  mssql: [
    "goods_receipts",
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
  postgres: ["asset_movement_users", "asset_movements", "assets", "cost_centers"],
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
    lastName: `PersonaAM${id}`,
    documentId: `TESTDOC-AM${id}`,
    email: `test-am-persona-${id}@example.com`,
  });
}

async function createFixtureApproverUser() {
  const adminRole = await getRoleByName("admin");
  if (!adminRole) throw new Error('Falta el rol "admin" sembrado -revisar migratePostgres()');
  const person = await createFixturePerson();
  return createUser({ personId: person.id, roleId: adminRole.id, username: `testam${++seq}` });
}

async function createFixtureEmployeeUser() {
  const userRole = await getRoleByName("user");
  if (!userRole) throw new Error('Falta el rol "user" sembrado -revisar migratePostgres()');
  const person = await createFixturePerson();
  return createUser({ personId: person.id, roleId: userRole.id, username: `testamemp${++seq}` });
}

async function createFixtureSupplier() {
  const id = ++seq;
  const businessPartner = await createBusinessPartner({
    legalName: `Proveedor de prueba AM${id}`,
    nationalId: `TESTSUPAM-${id}`,
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
  await createSupplierContact({ supplierId: supplier.id, name: `Contacto ${id}`, email: `contacto-am-${id}@example.com` });
  return supplier;
}

const fakePdfFile = { mimetype: "application/pdf", buffer: Buffer.from("test") } as Express.Multer.File;

// Request con UNA linea APPROVED, autorizada por "quantity" unidades, con su
// OC ya emitida/adjuntada/enviada Y recepcionada -deja "quantity" Assets
// AVAILABLE listos para asignar (paso 9).
async function createFixtureWithAvailableAssets(quantity: number) {
  const requesterPerson = await createFixturePerson();
  const beneficiary = await createFixturePerson();
  const costCenter = await createCostCenter({ code: 88000 + seq++, name: "Centro de prueba AM" });
  const approver = await createFixtureApproverUser();
  const request = await createPurchaseRequest({
    requesterId: requesterPerson.id,
    beneficiaryId: beneficiary.id,
    costCenterId: costCenter.id,
    approverId: approver.id,
  });
  await updatePurchaseRequestStatus(request.id, "APPROVED", approver.id);
  await requestQuotation(request.id, approver.id);

  const product = await createProduct({ name: `Producto de prueba AM${++seq}`, productType: "COMPRA" });
  const line = await createLine({ requestId: request.id, productId: String(product._id), quantity });
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
    approvedQuantity: quantity,
  });

  const order = await createPurchaseOrder({ quoteId: quote.id }, requesterPerson.id);
  await attachPurchaseOrderDocument(order.id, fakePdfFile, approver.id);
  vi.spyOn(mailerClient, "sendMailViaMailer").mockResolvedValueOnce({ ok: true });
  await sendPurchaseOrderToSupplier(order.id, approver.id);

  await createGoodsReceipt({
    documentType: "GUIA_DESPACHO",
    documentNumber: `GD-AM-${seq}`,
    purchaseOrderId: order.id,
    receivedQuantity: quantity,
  });

  const assets = await getAssetsByRequestId(request.id);
  return { request, assets };
}

describe("assetMovement.service (integracion, Postgres + MSSQL reales)", () => {
  describe("createAssetMovement", () => {
    it("rechaza (ConflictError) ASSIGNED sobre un asset que no esta AVAILABLE", async () => {
      const product = await createProduct({ name: `Producto RECEIVED AM${++seq}`, productType: "COMPRA" });
      const [asset] = await createAssetsFromReceipt({
        goodsReceiptId: 777_001,
        productId: String(product._id),
        quantity: 1,
      });
      const employee = await createFixtureEmployeeUser();

      await expect(
        createAssetMovement({ assetId: asset!.id, movementType: "ASSIGNED", userIds: [employee.id] }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("rechaza (ConflictError) REASSIGNED sobre un asset que no esta ASSIGNED", async () => {
      const product = await createProduct({ name: `Producto AVAILABLE AM${++seq}`, productType: "COMPRA" });
      const [asset] = await createAssetsFromReceipt({
        goodsReceiptId: 777_002,
        productId: String(product._id),
        quantity: 1,
        finalStatusCode: "AVAILABLE",
      });
      const employee = await createFixtureEmployeeUser();

      await expect(
        createAssetMovement({ assetId: asset!.id, movementType: "REASSIGNED", userIds: [employee.id] }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("assignAssetToUser", () => {
    it("reparte unidades de una misma solicitud a usuarios distintos dejando una sin asignar (stock de respaldo), sin tocar el estado ya cerrado de la solicitud", async () => {
      const { request, assets } = await createFixtureWithAvailableAssets(3);
      expect(assets).toHaveLength(3);
      // La recepcion de la fixture ya cubrio el total autorizado -el ciclo de
      // compra ya cerro (DELIVERED) antes de asignar nada a nadie, exactamente
      // el escenario "4 notebooks + 1 de respaldo" que motivo este cambio.
      expect((await getPurchaseRequestByIdOrThrow(request.id)).status).toBe("DELIVERED");

      const employeeA = await createFixtureEmployeeUser();
      const employeeB = await createFixtureEmployeeUser();

      await assignAssetToUser({ assetId: assets[0]!.id, userId: employeeA.id });
      await assignAssetToUser({ assetId: assets[1]!.id, userId: employeeB.id });
      // La 3ra unidad (respaldo) se deja deliberadamente sin asignar -la
      // solicitud sigue DELIVERED, assignAssetToUser no la vuelve a tocar.
      expect((await getPurchaseRequestByIdOrThrow(request.id)).status).toBe("DELIVERED");

      const finalAssets = await getAssetsByRequestId(request.id);
      const assignedCount = finalAssets.filter((asset) => asset.status?.code === "ASSIGNED").length;
      const availableCount = finalAssets.filter((asset) => asset.status?.code === "AVAILABLE").length;
      expect(assignedCount).toBe(2);
      expect(availableCount).toBe(1);
    });
  });
});
