import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { BadRequestError, ConflictError } from "../../library/errors";
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
import { listAssets } from "../postgres/asset.service";
import { createGoodsReceipt } from "./goodsReceipt.service";

let seq = 0;

const RESET_TABLES = {
  mssql: [
    "goods_receipts",
    "purchase_order_quotes",
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
  postgres: ["cost_centers", "assets"],
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
    lastName: `PersonaGR${id}`,
    documentId: `TESTDOC-GR${id}`,
    email: `test-gr-persona-${id}@example.com`,
  });
}

async function createFixtureApproverUser() {
  const adminRole = await getRoleByName("admin");
  if (!adminRole) throw new Error('Falta el rol "admin" sembrado -revisar migratePostgres()');
  const person = await createFixturePerson();
  return createUser({ personId: person.id, roleId: adminRole.id, username: `testgr${++seq}` });
}

async function createFixtureSupplier() {
  const id = ++seq;
  const businessPartner = await createBusinessPartner({
    legalName: `Proveedor de prueba GR${id}`,
    nationalId: `TESTSUPGR-${id}`,
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
  await createSupplierContact({ supplierId: supplier.id, name: `Contacto ${id}`, email: `contacto-gr-${id}@example.com` });
  return supplier;
}

const fakePdfFile = { mimetype: "application/pdf", buffer: Buffer.from("test") } as Express.Multer.File;

// Request con UNA linea APPROVED, autorizada por "approvedQuantity" unidades,
// con su OC ya emitida/adjuntada/enviada -lista para recepcionar
// (PENDING_DELIVERY, paso 8).
async function createFixtureAtPendingDelivery(approvedQuantity: number) {
  const requesterPerson = await createFixturePerson();
  const beneficiary = await createFixturePerson();
  const costCenter = await createCostCenter({ code: 87000 + seq++, name: "Centro de prueba GR" });
  const approver = await createFixtureApproverUser();
  const request = await createPurchaseRequest({
    requesterId: requesterPerson.id,
    beneficiaryId: beneficiary.id,
    costCenterId: costCenter.id,
    approverId: approver.id,
  });
  await updatePurchaseRequestStatus(request.id, "APPROVED", approver.id);
  await requestQuotation(request.id, approver.id);

  const product = await createProduct({ name: `Producto de prueba GR${++seq}`, productType: "COMPRA" });
  const line = await createLine({ requestId: request.id, productId: String(product._id), quantity: approvedQuantity });
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
    approvedQuantity,
  });

  const order = await createPurchaseOrder({ quoteIds: [quote.id] }, requesterPerson.id);
  await attachPurchaseOrderDocument(order.id, fakePdfFile, approver.id);
  vi.spyOn(mailerClient, "sendMailViaMailer").mockResolvedValueOnce({ ok: true });
  await sendPurchaseOrderToSupplier(order.id, approver.id);

  return { request, order, quote, approver, requesterPerson, product };
}

// Request con DOS lineas APPROVED, ambas autorizadas y cubiertas por UNA
// sola OC consolidada (mismo proveedor) ya enviada -para los tests que
// ejercitan la recepcion por-cotizacion dentro de una orden multi-cotizacion.
async function createFixtureAtPendingDeliveryConsolidated(approvedQuantityA: number, approvedQuantityB: number) {
  const requesterPerson = await createFixturePerson();
  const beneficiary = await createFixturePerson();
  const costCenter = await createCostCenter({ code: 87700 + seq++, name: "Centro de prueba GR consolidado" });
  const approver = await createFixtureApproverUser();
  const request = await createPurchaseRequest({
    requesterId: requesterPerson.id,
    beneficiaryId: beneficiary.id,
    costCenterId: costCenter.id,
    approverId: approver.id,
  });
  await updatePurchaseRequestStatus(request.id, "APPROVED", approver.id);
  await requestQuotation(request.id, approver.id);

  const productA = await createProduct({ name: `Producto A GR${++seq}`, productType: "COMPRA" });
  const productB = await createProduct({ name: `Producto B GR${++seq}`, productType: "COMPRA" });
  const lineA = await createLine({ requestId: request.id, productId: String(productA._id), quantity: approvedQuantityA });
  const lineB = await createLine({ requestId: request.id, productId: String(productB._id), quantity: approvedQuantityB });
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
  await createAuthorization({ requestLineId: lineA.id, quoteId: quoteA.id, approverId: approver.id, approvedQuantity: approvedQuantityA });
  await createAuthorization({ requestLineId: lineB.id, quoteId: quoteB.id, approverId: approver.id, approvedQuantity: approvedQuantityB });

  const order = await createPurchaseOrder({ quoteIds: [quoteA.id, quoteB.id] }, requesterPerson.id);
  await attachPurchaseOrderDocument(order.id, fakePdfFile, approver.id);
  vi.spyOn(mailerClient, "sendMailViaMailer").mockResolvedValueOnce({ ok: true });
  await sendPurchaseOrderToSupplier(order.id, approver.id);

  return { request, order, quoteA, quoteB, approver, requesterPerson };
}

describe("goodsReceipt.service (integracion, MSSQL + Postgres reales)", () => {
  describe("createGoodsReceipt", () => {
    it("recepciona completo en un solo envio y pasa la solicitud directo a DELIVERED, creando un Asset por unidad", async () => {
      const { request, order, quote } = await createFixtureAtPendingDelivery(3);

      const receipt = await createGoodsReceipt({
        documentType: "GUIA_DESPACHO",
        documentNumber: "GD-0001",
        purchaseOrderId: order.id,
        quoteId: quote.id,
        receivedQuantity: 3,
        serialNumbers: ["SN-1", "SN-2", "SN-3"],
      });

      expect(receipt.receivedQuantity).toBe(3);
      // Recepcion unica que ya cubre lo autorizado -salta AVAILABLE, cierra
      // el ciclo de compra directo (isRequestFullyReceived), sin depender de
      // que las unidades se le asignen a alguien despues.
      expect((await getPurchaseRequestByIdOrThrow(request.id)).status).toBe("DELIVERED");

      const { items, total } = await listAssets({ page: 1, limit: 10, sortBy: "id", sortOrder: "asc" }, receipt.id);
      expect(total).toBe(3);
      expect(items.map((asset) => asset.serialNumber).sort()).toEqual(["SN-1", "SN-2", "SN-3"]);
      expect(items.every((asset) => asset.status?.code === "AVAILABLE")).toBe(true);
    });

    it("acepta recepciones parciales: AVAILABLE mientras falte recibir, DELIVERED recien al completar -sin asignar nada a nadie", async () => {
      const { request, order, quote } = await createFixtureAtPendingDelivery(5);

      const firstReceipt = await createGoodsReceipt({
        documentType: "GUIA_DESPACHO",
        documentNumber: "GD-0002",
        purchaseOrderId: order.id,
        quoteId: quote.id,
        receivedQuantity: 2,
      });
      expect((await getPurchaseRequestByIdOrThrow(request.id)).status).toBe("AVAILABLE");

      const secondReceipt = await createGoodsReceipt({
        documentType: "FACTURA",
        documentNumber: "F-0001",
        purchaseOrderId: order.id,
        quoteId: quote.id,
        receivedQuantity: 3,
      });
      // 2 + 3 = 5 = approvedQuantity -queda completo, cierra a DELIVERED aun
      // cuando ningun Asset fue asignado todavia (caso "stock de respaldo").
      expect((await getPurchaseRequestByIdOrThrow(request.id)).status).toBe("DELIVERED");

      const { total: totalFirst } = await listAssets({ page: 1, limit: 10, sortBy: "id", sortOrder: "asc" }, firstReceipt.id);
      const { total: totalSecond } = await listAssets({ page: 1, limit: 10, sortBy: "id", sortOrder: "asc" }, secondReceipt.id);
      expect(totalFirst).toBe(2);
      expect(totalSecond).toBe(3);
    });

    it("rechaza (BadRequestError) si la cantidad acumulada supera lo autorizado", async () => {
      // approvedQuantity:3 con una primera recepcion PARCIAL de 2 -a
      // diferencia del resto de los tests de esta suite, no puede recibirse
      // completo de entrada: eso cerraria la solicitud a DELIVERED antes de
      // llegar al guard de cantidad que este test quiere ejercitar.
      const { order, quote } = await createFixtureAtPendingDelivery(3);

      await createGoodsReceipt({
        documentType: "GUIA_DESPACHO",
        documentNumber: "GD-0003",
        purchaseOrderId: order.id,
        quoteId: quote.id,
        receivedQuantity: 2,
      });

      await expect(
        createGoodsReceipt({
          documentType: "GUIA_DESPACHO",
          documentNumber: "GD-0004",
          purchaseOrderId: order.id,
          quoteId: quote.id,
          receivedQuantity: 2,
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("el tope por cotizacion no se mezcla entre cotizaciones de una OC consolidada", async () => {
      const { order, quoteA, quoteB } = await createFixtureAtPendingDeliveryConsolidated(2, 3);

      await expect(
        createGoodsReceipt({
          documentType: "GUIA_DESPACHO",
          documentNumber: "GD-CONS-1",
          purchaseOrderId: order.id,
          quoteId: quoteA.id,
          receivedQuantity: 3,
        }),
      ).rejects.toBeInstanceOf(BadRequestError);

      const receiptB = await createGoodsReceipt({
        documentType: "GUIA_DESPACHO",
        documentNumber: "GD-CONS-2",
        purchaseOrderId: order.id,
        quoteId: quoteB.id,
        receivedQuantity: 3,
      });
      expect(receiptB.receivedQuantity).toBe(3);
    });

    it("rechaza (BadRequestError) una cotizacion que no pertenece a la orden indicada", async () => {
      const { order: orderA } = await createFixtureAtPendingDelivery(1);
      const { quote: quoteB } = await createFixtureAtPendingDelivery(1);

      await expect(
        createGoodsReceipt({
          documentType: "GUIA_DESPACHO",
          documentNumber: "GD-CRUZADA",
          purchaseOrderId: orderA.id,
          quoteId: quoteB.id,
          receivedQuantity: 1,
        }),
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it("permite dos recepciones con el MISMO documento fisico contra dos cotizaciones distintas de una OC consolidada", async () => {
      const { order, quoteA, quoteB } = await createFixtureAtPendingDeliveryConsolidated(10, 10);

      const receiptA = await createGoodsReceipt({
        documentType: "GUIA_DESPACHO",
        documentNumber: "GD-MISMA-GUIA",
        purchaseOrderId: order.id,
        quoteId: quoteA.id,
        receivedQuantity: 2,
      });
      const receiptB = await createGoodsReceipt({
        documentType: "GUIA_DESPACHO",
        documentNumber: "GD-MISMA-GUIA",
        purchaseOrderId: order.id,
        quoteId: quoteB.id,
        receivedQuantity: 2,
      });
      expect(receiptA.id).not.toBe(receiptB.id);

      // Mismo (orden, cotizacion, tipo, numero) que receiptA: el indice
      // unico lo bloquea aunque la cantidad siga bajo lo autorizado.
      await expect(
        createGoodsReceipt({
          documentType: "GUIA_DESPACHO",
          documentNumber: "GD-MISMA-GUIA",
          purchaseOrderId: order.id,
          quoteId: quoteA.id,
          receivedQuantity: 1,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("rechaza (ConflictError) fuera de PENDING_DELIVERY", async () => {
      const requesterPerson = await createFixturePerson();
      const beneficiary = await createFixturePerson();
      const costCenter = await createCostCenter({ code: 87500 + seq++, name: "Centro de prueba GR" });
      const approver = await createFixtureApproverUser();
      const request = await createPurchaseRequest({
        requesterId: requesterPerson.id,
        beneficiaryId: beneficiary.id,
        costCenterId: costCenter.id,
        approverId: approver.id,
      });
      await updatePurchaseRequestStatus(request.id, "APPROVED", approver.id);
      await requestQuotation(request.id, approver.id);

      const product = await createProduct({ name: `Producto sin enviar GR${++seq}`, productType: "COMPRA" });
      const line = await createLine({ requestId: request.id, productId: String(product._id), quantity: 1 });
      await updateLine(line.id, { status: "APPROVED" });

      const supplier = await createFixtureSupplier();
      const quote = await createQuote({
        requestId: request.id,
        productId: String(product._id),
        supplierId: supplier.id,
        purchaseValue: "10.00",
      });

      await requestQuoteApproval(request.id, approver.id);
      await createAuthorization({
        requestLineId: line.id,
        quoteId: quote.id,
        approverId: approver.id,
        approvedQuantity: 1,
      });

      const order = await createPurchaseOrder({ quoteIds: [quote.id] }, requesterPerson.id);
      await attachPurchaseOrderDocument(order.id, fakePdfFile, approver.id);
      // Sin sendPurchaseOrderToSupplier: la solicitud sigue en OC_GENERATED,
      // no en PENDING_DELIVERY.

      await expect(
        createGoodsReceipt({
          documentType: "GUIA_DESPACHO",
          documentNumber: "GD-0005",
          purchaseOrderId: order.id,
          quoteId: quote.id,
          receivedQuantity: 1,
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });
});
