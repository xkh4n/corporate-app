import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../library/errors";
import { getAssetReturnsFolder } from "../../library/documentStorage";
import { AssetMovementModel } from "../../models/postgres/assetMovement.model";
import { createPerson } from "../mssql/person.service";
import { createUser } from "../mssql/user.service";
import { getRoleByName } from "./role.service";
import { createCostCenter } from "./costCenter.service";
import { createProduct } from "../mongo/product.service";
import { createProductCategory } from "../mongo/productCategory.service";
import { createAssetsFromReceipt, getAssetByTag } from "./asset.service";
import { assignAssetToUser, createAssetMovement, listCurrentHoldersByAssetIds } from "./assetMovement.service";
import { addInventoryLine, lookupAsset, startInventoryCount } from "./inventoryCount.service";
import type { AssetReturnActor } from "../../types/postgres/assetReturn.types";
import {
  addAssetReturnLines,
  attachAssetReturnDocument,
  cancelAssetReturn,
  createAssetReturn,
  getAssetReturnDetail,
  getAssetReturnDocument,
  listAssetReturns,
  listReturnCandidates,
  receiveAssetReturn,
  removeAssetReturnLine,
  sendAssetReturn,
} from "./assetReturn.service";

let seq = 0;

const RESET_TABLES = {
  mssql: ["users", "persons"],
  postgres: [
    "asset_return_lines",
    "asset_returns",
    "inventory_count_missing_assets",
    "inventory_count_lines",
    "inventory_counts",
    "inventory_count_counters",
    "asset_movement_users",
    "asset_movements",
    "asset_kardex_entries",
    "assets",
    "cost_centers",
  ],
  mongo: ["Product", "ProductCategory"],
};

// Guias escritas en disco por los tests: se borran al terminar cada uno.
const writtenFiles = new Set<string>();

function cleanupFiles() {
  for (const filename of writtenFiles) fs.rmSync(path.join(getAssetReturnsFolder(), filename), { force: true });
  writtenFiles.clear();
}

beforeEach(async () => {
  await resetTestData(RESET_TABLES);
});

afterEach(async () => {
  cleanupFiles();
  await resetTestData(RESET_TABLES);
});

async function createFixtureUser() {
  const role = await getRoleByName("user");
  if (!role) throw new Error('Falta el rol "user" sembrado -revisar migratePostgres()');
  const id = ++seq;
  const person = await createPerson({
    firstName: "Test",
    lastName: `DevolucionAR${id}`,
    documentId: `TESTDOC-AR${id}`,
    email: `test-ar-${id}@example.com`,
  });
  return createUser({ personId: person.id, roleId: role.id, username: `testar${id}` });
}

async function createFixtureCatalog() {
  const costCenter = await createCostCenter({ code: 5800 + ++seq, name: "Centro de prueba AR" });
  const otherCostCenter = await createCostCenter({ code: 5800 + ++seq, name: "Otro centro AR" });
  const category = await createProductCategory({ name: `Categoria AR${++seq}` });
  const product = await createProduct({
    name: `Notebook AR${++seq}`,
    productType: "COMPRA",
    categoryId: String(category._id),
  });
  return { costCenter, otherCostCenter, categoryId: String(category._id), productId: String(product._id) };
}
type Catalog = Awaited<ReturnType<typeof createFixtureCatalog>>;

// Activo asignado a `holder`, en el centro de costo `costCenterId` del catalogo.
async function createAssignedAsset(catalog: Catalog, serial: string, holderId: number, costCenterId?: number) {
  const [asset] = await createAssetsFromReceipt({
    goodsReceiptId: 990000 + ++seq,
    productId: catalog.productId,
    quantity: 1,
    costCenterId: costCenterId ?? catalog.costCenter.id,
    serialNumbers: [serial],
    finalStatusCode: "AVAILABLE",
  });
  await assignAssetToUser({ assetId: asset!.id, userId: holderId });
  return asset!;
}

const actorOf = (user: { id: number }, isAdmin = false): AssetReturnActor => ({ userId: user.id, isAdmin });

// Candidatos "equipos de otro usuario" de un centro de costo, vistos por el solicitante.
const othersOf = (user: { id: number }, costCenterId: number) => ({
  scope: "OTHERS" as const,
  costCenterId,
  actor: actorOf(user),
});

const pdfFile = (content = "%PDF-1.4 guia de despacho") =>
  ({ mimetype: "application/pdf", buffer: Buffer.from(content), originalname: "guia.pdf" }) as Express.Multer.File;

async function attach(id: number, actor: AssetReturnActor, content?: string) {
  const result = await attachAssetReturnDocument(id, pdfFile(content), actor);
  writtenFiles.add(result.filename);
  return result;
}

const statusOf = async (tag: string) => (await getAssetByTag(tag))!.status!.code;

// Devolucion en borrador con 2 activos y la guia ya adjunta.
async function draftWithDocument() {
  const requester = await createFixtureUser();
  const holderA = await createFixtureUser();
  const holderB = await createFixtureUser();
  const catalog = await createFixtureCatalog();
  const a = await createAssignedAsset(catalog, "SN-AR-A", holderA.id);
  const b = await createAssignedAsset(catalog, "SN-AR-B", holderB.id);
  const detail = await createAssetReturn({
    costCenterId: catalog.costCenter.id,
    assetIds: [a.id, b.id],
    notes: "Recambio de equipos",
    requestedBy: requester.id,
  });
  const { code } = await attach(detail.id, actorOf(requester));
  return { requester, holderA, holderB, catalog, a, b, id: detail.id, code };
}

describe("listReturnCandidates", () => {
  it("solo asignados del centro elegido, sin devolucion vigente, con su tenedor", async () => {
    const requester = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const assigned = await createAssignedAsset(catalog, "SN-C-ASIG", holder.id);
    await createAssignedAsset(catalog, "SN-C-OTRO", holder.id, catalog.otherCostCenter.id);
    const [available] = await createAssetsFromReceipt({
      goodsReceiptId: 990000 + ++seq,
      productId: catalog.productId,
      quantity: 1,
      costCenterId: catalog.costCenter.id,
      serialNumbers: ["SN-C-DISP"],
      finalStatusCode: "AVAILABLE",
    });
    expect(available).toBeDefined();
    const taken = await createAssignedAsset(catalog, "SN-C-TOMADO", holder.id);
    await createAssetReturn({ costCenterId: catalog.costCenter.id, assetIds: [taken.id], requestedBy: requester.id });

    const { items, total } = await listReturnCandidates(othersOf(requester, catalog.costCenter.id), {
      page: 1,
      limit: 50,
      sortBy: "tag",
      sortOrder: "asc",
    });

    expect(total).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ assetId: assigned.id, tag: assigned.tag, statusCode: "ASSIGNED" });
    expect(items[0]!.holder?.userId).toBe(holder.id);
  });
});

describe("createAssetReturn / addAssetReturnLines / removeAssetReturnLine", () => {
  it("crea el borrador con su foto de tenedor y sin codigo ni guia", async () => {
    const requester = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createAssignedAsset(catalog, "SN-N-1", holder.id);

    const detail = await createAssetReturn({
      costCenterId: catalog.costCenter.id,
      assetIds: [asset.id],
      notes: " con nota ",
      requestedBy: requester.id,
    });

    expect(detail).toMatchObject({ status: "DRAFT", code: null, hasDocument: false, lineCount: 1, notes: "con nota" });
    expect(detail.costCenter?.id).toBe(catalog.costCenter.id);
    expect(detail.requestedBy?.userId).toBe(requester.id);
    expect(detail.lines[0]).toMatchObject({ assetId: asset.id, previousStatusCode: "ASSIGNED", statusCode: "ASSIGNED" });
    expect(detail.lines[0]!.holder?.userId).toBe(holder.id);
    // Minimizacion de PII: ninguna respuesta de devoluciones incluye el RUT.
    expect(detail.lines[0]!.holder).not.toHaveProperty("documentId");
    expect(detail.requestedBy).not.toHaveProperty("documentId");
  });

  it("rechaza un activo no asignado o de otro centro y no deja nada creado", async () => {
    const requester = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const ok = await createAssignedAsset(catalog, "SN-R-OK", holder.id);
    const otherCenter = await createAssignedAsset(catalog, "SN-R-CC", holder.id, catalog.otherCostCenter.id);
    const [available] = await createAssetsFromReceipt({
      goodsReceiptId: 990000 + ++seq,
      productId: catalog.productId,
      quantity: 1,
      costCenterId: catalog.costCenter.id,
      serialNumbers: ["SN-R-DISP"],
      finalStatusCode: "AVAILABLE",
    });

    await expect(
      createAssetReturn({ costCenterId: catalog.costCenter.id, assetIds: [ok.id, otherCenter.id], requestedBy: requester.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createAssetReturn({ costCenterId: catalog.costCenter.id, assetIds: [ok.id, available!.id], requestedBy: requester.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createAssetReturn({ costCenterId: catalog.costCenter.id, assetIds: [ok.id, 999999], requestedBy: requester.id }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const list = await listAssetReturns({ page: 1, limit: 10, sortBy: "id", sortOrder: "desc" });
    expect(list.total).toBe(0);
  });

  it("un activo no puede estar en dos devoluciones vigentes, tampoco en una carrera", async () => {
    const requester = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createAssignedAsset(catalog, "SN-D-1", holder.id);

    const results = await Promise.allSettled([
      createAssetReturn({ costCenterId: catalog.costCenter.id, assetIds: [asset.id], requestedBy: requester.id }),
      createAssetReturn({ costCenterId: catalog.costCenter.id, assetIds: [asset.id], requestedBy: requester.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);

    const list = await listAssetReturns({ page: 1, limit: 10, sortBy: "id", sortOrder: "desc" });
    expect(list.total).toBe(1);
  });

  it("agrega y quita activos solo en borrador", async () => {
    const requester = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const first = await createAssignedAsset(catalog, "SN-L-1", holder.id);
    const second = await createAssignedAsset(catalog, "SN-L-2", holder.id);
    const detail = await createAssetReturn({ costCenterId: catalog.costCenter.id, assetIds: [first.id], requestedBy: requester.id });

    const added = await addAssetReturnLines(detail.id, [second.id], actorOf(requester));
    expect(added.lineCount).toBe(2);

    const removed = await removeAssetReturnLine(detail.id, added.lines[0]!.id, actorOf(requester));
    expect(removed.lineCount).toBe(1);
    await expect(removeAssetReturnLine(detail.id, 999999, actorOf(requester))).rejects.toBeInstanceOf(NotFoundError);

    await attach(detail.id, actorOf(requester));
    await sendAssetReturn(detail.id, actorOf(requester));
    await expect(addAssetReturnLines(detail.id, [first.id], actorOf(requester))).rejects.toBeInstanceOf(ConflictError);
    await expect(removeAssetReturnLine(detail.id, removed.lines[0]!.id, actorOf(requester))).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("guia de despacho", () => {
  it("solo acepta PDF", async () => {
    const requester = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createAssignedAsset(catalog, "SN-G-1", holder.id);
    const detail = await createAssetReturn({ costCenterId: catalog.costCenter.id, assetIds: [asset.id], requestedBy: requester.id });

    await expect(
      attachAssetReturnDocument(
        detail.id,
        { mimetype: "image/png", buffer: Buffer.from("x") } as Express.Multer.File,
        actorOf(requester),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("la primera vez asigna el codigo DEV<centro><aaaammddHHmmssSSS> y guarda uploads/devoluciones/<codigo>.pdf; reemplazar conserva el codigo", async () => {
    const requester = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createAssignedAsset(catalog, "SN-G-2", holder.id);
    const detail = await createAssetReturn({ costCenterId: catalog.costCenter.id, assetIds: [asset.id], requestedBy: requester.id });

    const first = await attach(detail.id, actorOf(requester), "%PDF-1.4 primera");
    expect(first.code).toMatch(new RegExp(`^DEV${catalog.costCenter.code}\\d{17}$`));
    expect(first.filename).toBe(`${first.code}.pdf`);

    const stored = await getAssetReturnDocument(detail.id);
    expect(stored.filename).toBe(first.filename);
    expect(stored.filePath).toBe(path.join(getAssetReturnsFolder(), first.filename));
    expect(fs.readFileSync(stored.filePath, "utf8")).toBe("%PDF-1.4 primera");

    const second = await attach(detail.id, actorOf(requester), "%PDF-1.4 segunda");
    expect(second.code).toBe(first.code);
    expect(fs.readFileSync(stored.filePath, "utf8")).toBe("%PDF-1.4 segunda");

    const after = await getAssetReturnDetail(detail.id);
    expect(after).toMatchObject({ code: first.code, hasDocument: true });
  });

  it("no hay guia que entregar antes de adjuntarla", async () => {
    const requester = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createAssignedAsset(catalog, "SN-G-3", holder.id);
    const detail = await createAssetReturn({ costCenterId: catalog.costCenter.id, assetIds: [asset.id], requestedBy: requester.id });

    await expect(getAssetReturnDocument(detail.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("sendAssetReturn", () => {
  it("exige la guia adjunta", async () => {
    const requester = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const asset = await createAssignedAsset(catalog, "SN-S-0", holder.id);
    const detail = await createAssetReturn({ costCenterId: catalog.costCenter.id, assetIds: [asset.id], requestedBy: requester.id });

    await expect(sendAssetReturn(detail.id, actorOf(requester))).rejects.toBeInstanceOf(BadRequestError);
    expect(await statusOf(asset.tag)).toBe("ASSIGNED");
  });

  it("pasa los activos a MOVE_TO_RETURNED, sin tenedor, con su movimiento", async () => {
    const { requester, a, b, id, code } = await draftWithDocument();

    const sent = await sendAssetReturn(id, actorOf(requester));

    expect(sent).toMatchObject({ status: "SENT", code });
    expect(sent.sentAt).not.toBeNull();
    expect(sent.sentBy?.userId).toBe(requester.id);
    expect(sent.lines.map((line) => line.statusCode)).toEqual(["MOVE_TO_RETURNED", "MOVE_TO_RETURNED"]);
    expect(await statusOf(a.tag)).toBe("MOVE_TO_RETURNED");
    expect(await statusOf(b.tag)).toBe("MOVE_TO_RETURNED");
    expect((await listCurrentHoldersByAssetIds([a.id, b.id])).size).toBe(0);

    const movements = await AssetMovementModel.findAll({ where: { assetId: a.id, movementType: "MOVE_TO_RETURNED" } });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.notes).toContain(code);
    // El tenedor original queda en la linea de la devolucion.
    expect(sent.lines[0]!.holder).not.toBeNull();

    await expect(sendAssetReturn(id, actorOf(requester))).rejects.toBeInstanceOf(ConflictError);
  });

  it("es todo o nada: si un activo ya no es devolvible no se envia ninguno y se lista cual", async () => {
    const { requester, a, b, id } = await draftWithDocument();
    // Entre el borrador y el envio, alguien mando el activo B a soporte.
    await createAssetMovement({ assetId: b.id, movementType: "SUPPORT" });

    const error = await sendAssetReturn(id, actorOf(requester)).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toContain(b.tag);
    expect(await statusOf(a.tag)).toBe("ASSIGNED");
    expect((await getAssetReturnDetail(id)).status).toBe("DRAFT");
  });
});

describe("receiveAssetReturn", () => {
  it("recibe por activo (parcial) y luego el resto; la devolucion se cierra al llegar todos", async () => {
    const { requester, a, b, id } = await draftWithDocument();
    const receiver = await createFixtureUser();
    const sent = await sendAssetReturn(id, actorOf(requester));

    const partial = await receiveAssetReturn(id, [sent.lines[0]!.id], actorOf(receiver));
    expect(partial).toMatchObject({ status: "SENT", receivedCount: 1, lineCount: 2 });
    expect(await statusOf(a.tag)).toBe("RETURNED");
    expect(await statusOf(b.tag)).toBe("MOVE_TO_RETURNED");
    expect(partial.lines[0]!.receivedAt).not.toBeNull();

    // Recibir dos veces la misma linea no es posible.
    await expect(receiveAssetReturn(id, [sent.lines[0]!.id], actorOf(receiver))).rejects.toBeInstanceOf(BadRequestError);

    const done = await receiveAssetReturn(id, undefined, actorOf(receiver));
    expect(done).toMatchObject({ status: "RECEIVED", receivedCount: 2 });
    expect(done.receivedAt).not.toBeNull();
    expect(await statusOf(b.tag)).toBe("RETURNED");

    await expect(receiveAssetReturn(id, undefined, actorOf(receiver))).rejects.toBeInstanceOf(ConflictError);
    const movements = await AssetMovementModel.findAll({ where: { assetId: b.id, movementType: "RETURNED" } });
    expect(movements).toHaveLength(1);
  });

  it("no se recibe un borrador ni una linea ajena", async () => {
    const { requester, id } = await draftWithDocument();
    const receiver = await createFixtureUser();
    await expect(receiveAssetReturn(id, undefined, actorOf(receiver))).rejects.toBeInstanceOf(ConflictError);

    await sendAssetReturn(id, actorOf(requester));
    await expect(receiveAssetReturn(id, [999999], actorOf(receiver))).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe("cancelAssetReturn", () => {
  it("cancela un borrador: libera los activos y borra la guia", async () => {
    const { requester, catalog, a, id, code } = await draftWithDocument();
    const { filePath } = await getAssetReturnDocument(id);
    expect(fs.existsSync(filePath)).toBe(true);

    const cancelled = await cancelAssetReturn(id, actorOf(requester));

    expect(cancelled.status).toBe("CANCELLED");
    expect(fs.existsSync(filePath)).toBe(false);
    expect(code).toBeTruthy();
    const { total } = await listReturnCandidates(othersOf(requester, catalog.costCenter.id), { page: 1, limit: 10, sortBy: "tag", sortOrder: "asc" });
    expect(total).toBe(2);
    // El activo puede entrar en otra devolucion.
    await expect(
      createAssetReturn({ costCenterId: catalog.costCenter.id, assetIds: [a.id], requestedBy: requester.id }),
    ).resolves.toMatchObject({ status: "DRAFT" });
  });

  it("no se cancela una devolucion ya enviada", async () => {
    const { requester, id } = await draftWithDocument();
    await sendAssetReturn(id, actorOf(requester));
    await expect(cancelAssetReturn(id, actorOf(requester))).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("toma de inventario con un activo en transito de devolucion", () => {
  it("lo rechaza con la instruccion y no ofrece estados", async () => {
    const { requester, catalog, a, id } = await draftWithDocument();
    const auditor = await createFixtureUser();
    await sendAssetReturn(id, actorOf(requester));
    const { count } = await startInventoryCount({ createdBy: auditor.id });

    const found = await lookupAsset(count.id, "TAG", a.tag, actorOf(auditor));
    expect(found?.statusCode).toBe("MOVE_TO_RETURNED");
    expect(found?.allowedStatusCodes).toEqual([]);
    expect(found?.instruction).toContain("tránsito");

    await expect(
      addInventoryLine(count.id, {
        lookupBy: "TAG",
        tag: a.tag,
        productCategoryId: catalog.categoryId,
        productId: catalog.productId,
        costCenterId: catalog.costCenter.id,
        statusCode: "ASSIGNED",
        createdBy: auditor.id,
      }, actorOf(auditor)),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(await statusOf(a.tag)).toBe("MOVE_TO_RETURNED");
  });
});

describe("limites de la devolucion", () => {
  it("un solicitante no puede tener mas de 10 borradores abiertos", async () => {
    const requester = await createFixtureUser();
    const holder = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    for (let i = 0; i < 10; i++) {
      const asset = await createAssignedAsset(catalog, `SN-CAP-${i}`, holder.id);
      await createAssetReturn({ costCenterId: catalog.costCenter.id, assetIds: [asset.id], requestedBy: requester.id });
    }
    const extra = await createAssignedAsset(catalog, "SN-CAP-X", holder.id);
    await expect(
      createAssetReturn({ costCenterId: catalog.costCenter.id, assetIds: [extra.id], requestedBy: requester.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    // Otro solicitante no se ve afectado.
    const other = await createFixtureUser();
    await expect(
      createAssetReturn({ costCenterId: catalog.costCenter.id, assetIds: [extra.id], requestedBy: other.id }),
    ).resolves.toMatchObject({ status: "DRAFT" });
  });

  it("el tenedor queda registrado al despachar, no al agregar el activo al borrador", async () => {
    const { requester, catalog, a, id } = await draftWithDocument();
    const newHolder = await createFixtureUser();
    // Entre el borrador y el envio el equipo se reasigna a otra persona.
    await createAssetMovement({ assetId: a.id, movementType: "REASSIGNED", userIds: [newHolder.id] });
    expect(catalog.costCenter.id).toBeGreaterThan(0);

    const sent = await sendAssetReturn(id, actorOf(requester));
    const line = sent.lines.find((item) => item.assetId === a.id);
    expect(line?.holder?.userId).toBe(newHolder.id);
  });

  it("no se envia si la guia adjunta ya no esta en el almacenamiento", async () => {
    const { requester, id } = await draftWithDocument();
    const { filePath } = await getAssetReturnDocument(id);
    fs.rmSync(filePath, { force: true });
    await expect(sendAssetReturn(id, actorOf(requester))).rejects.toBeInstanceOf(BadRequestError);
    expect((await getAssetReturnDetail(id)).status).toBe("DRAFT");
  });
});

describe("propiedad de la devolucion y separacion de funciones", () => {
  it("solo el solicitante o un administrador puede agregar, quitar, adjuntar, enviar o cancelar", async () => {
    const { requester, catalog, a, id } = await draftWithDocument();
    const stranger = await createFixtureUser();
    const holder = await createFixtureUser();
    const extra = await createAssignedAsset(catalog, "SN-OWN-X", holder.id);
    const detail = await getAssetReturnDetail(id);
    const other = actorOf(stranger);

    await expect(addAssetReturnLines(id, [extra.id], other)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removeAssetReturnLine(id, detail.lines[0]!.id, other)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(attachAssetReturnDocument(id, pdfFile(), other)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sendAssetReturn(id, other)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cancelAssetReturn(id, other)).rejects.toBeInstanceOf(ForbiddenError);

    // Nada cambio: sigue en borrador con los mismos activos y el activo sin tocar.
    const unchanged = await getAssetReturnDetail(id);
    expect(unchanged).toMatchObject({ status: "DRAFT", lineCount: 2 });
    expect(await statusOf(a.tag)).toBe("ASSIGNED");

    // El administrador si puede, aunque no sea el solicitante.
    const admin = actorOf(stranger, true);
    const added = await addAssetReturnLines(id, [extra.id], admin);
    expect(added.lineCount).toBe(3);
    await expect(sendAssetReturn(id, admin)).resolves.toMatchObject({ status: "SENT", sentBy: { userId: stranger.id } });
    expect(requester.id).not.toBe(stranger.id);
  });

  it("ni quien solicito ni quien envio la devolucion puede recibirla, salvo un administrador", async () => {
    const { requester, a, id } = await draftWithDocument();
    const admin = await createFixtureUser();
    // Un admin envia por cuenta del solicitante: el solicitante tampoco puede recibirla.
    await sendAssetReturn(id, actorOf(admin, true));

    await expect(receiveAssetReturn(id, undefined, actorOf(requester))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(receiveAssetReturn(id, undefined, actorOf(admin))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await statusOf(a.tag)).toBe("MOVE_TO_RETURNED");

    // Otro usuario (Adquisiciones) si; el admin tambien aunque haya enviado.
    const receiver = await createFixtureUser();
    await expect(receiveAssetReturn(id, undefined, actorOf(receiver))).resolves.toMatchObject({ status: "RECEIVED" });
  });
});

describe("modos por tenedor: mis equipos / equipos de otro usuario", () => {
  const page = { page: 1, limit: 50, sortBy: "tag", sortOrder: "asc" } as const;

  it("mis equipos: el centro de costo lo define el activo y solo admite equipos propios", async () => {
    const requester = await createFixtureUser();
    const other = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const mine = await createAssignedAsset(catalog, "SN-OWN-1", requester.id, catalog.otherCostCenter.id);
    const theirs = await createAssignedAsset(catalog, "SN-OWN-2", other.id, catalog.otherCostCenter.id);

    const draft = await createAssetReturn({ scope: "OWN", assetIds: [mine.id], requestedBy: requester.id });
    expect(draft).toMatchObject({ scope: "OWN", costCenter: { id: catalog.otherCostCenter.id } });

    // No se agrega un equipo de otro usuario, ni se puede forzar un centro de costo distinto al del activo.
    await expect(addAssetReturnLines(draft.id, [theirs.id], actorOf(requester))).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createAssetReturn({ scope: "OWN", costCenterId: catalog.costCenter.id, assetIds: [mine.id], requestedBy: requester.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await getAssetReturnDetail(draft.id)).lineCount).toBe(1);
  });

  it("mis equipos: equipos de distintos centros de costo requieren una devolucion por centro", async () => {
    const requester = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const a = await createAssignedAsset(catalog, "SN-OWN-C1", requester.id, catalog.costCenter.id);
    const b = await createAssignedAsset(catalog, "SN-OWN-C2", requester.id, catalog.otherCostCenter.id);

    await expect(createAssetReturn({ scope: "OWN", assetIds: [a.id, b.id], requestedBy: requester.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
    const draft = await createAssetReturn({ scope: "OWN", assetIds: [a.id], requestedBy: requester.id });
    // Ya fijado el centro de costo por el primer activo, el de otro centro no entra.
    await expect(addAssetReturnLines(draft.id, [b.id], actorOf(requester))).rejects.toBeInstanceOf(ConflictError);
  });

  it("equipos de otro usuario: el centro de costo es obligatorio y un equipo propio se rechaza", async () => {
    const requester = await createFixtureUser();
    const other = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const mine = await createAssignedAsset(catalog, "SN-OTH-1", requester.id);
    const theirs = await createAssignedAsset(catalog, "SN-OTH-2", other.id);

    await expect(createAssetReturn({ assetIds: [theirs.id], requestedBy: requester.id })).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      createAssetReturn({ scope: "OTHERS", costCenterId: catalog.costCenter.id, assetIds: [mine.id], requestedBy: requester.id }),
    ).rejects.toBeInstanceOf(ConflictError);

    const draft = await createAssetReturn({ scope: "OTHERS", costCenterId: catalog.costCenter.id, assetIds: [theirs.id], requestedBy: requester.id });
    expect(draft).toMatchObject({ scope: "OTHERS", costCenter: { id: catalog.costCenter.id } });
    await expect(addAssetReturnLines(draft.id, [mine.id], actorOf(requester))).rejects.toBeInstanceOf(ConflictError);
  });

  it("un administrador queda exento de la regla de tenedor", async () => {
    const admin = await createFixtureUser();
    const other = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    const mine = await createAssignedAsset(catalog, "SN-ADM-1", admin.id);
    const theirs = await createAssignedAsset(catalog, "SN-ADM-2", other.id);

    const draft = await createAssetReturn({
      scope: "OTHERS",
      costCenterId: catalog.costCenter.id,
      assetIds: [mine.id, theirs.id],
      requestedBy: admin.id,
      isAdmin: true,
    });
    expect(draft.lineCount).toBe(2);
  });

  it("candidatos: mis equipos (de cualquier centro) y, por separado, los de otros del centro elegido", async () => {
    const requester = await createFixtureUser();
    const other = await createFixtureUser();
    const catalog = await createFixtureCatalog();
    await createAssignedAsset(catalog, "SN-CAN-M1", requester.id, catalog.costCenter.id);
    await createAssignedAsset(catalog, "SN-CAN-M2", requester.id, catalog.otherCostCenter.id);
    await createAssignedAsset(catalog, "SN-CAN-O1", other.id, catalog.costCenter.id);
    const actor = actorOf(requester);

    const own = await listReturnCandidates({ scope: "OWN", actor }, page);
    expect(own.items.map((item) => item.serialNumber).sort()).toEqual(["SN-CAN-M1", "SN-CAN-M2"]);
    expect(own.items.every((item) => item.holder?.userId === requester.id && item.costCenter !== null)).toBe(true);

    const ownFiltered = await listReturnCandidates({ scope: "OWN", costCenterId: catalog.otherCostCenter.id, actor }, page);
    expect(ownFiltered.items.map((item) => item.serialNumber)).toEqual(["SN-CAN-M2"]);

    const others = await listReturnCandidates(othersOf(requester, catalog.costCenter.id), page);
    expect(others.items.map((item) => item.serialNumber)).toEqual(["SN-CAN-O1"]);

    // El administrador ve tambien los propios en "otros"; sin centro de costo no hay listado de otros.
    const admin = await listReturnCandidates({ scope: "OTHERS", costCenterId: catalog.costCenter.id, actor: actorOf(requester, true) }, page);
    expect(admin.total).toBe(2);
    await expect(listReturnCandidates({ scope: "OTHERS", actor }, page)).rejects.toBeInstanceOf(BadRequestError);
  });
});
