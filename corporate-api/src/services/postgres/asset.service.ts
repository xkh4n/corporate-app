import { Op, QueryTypes, Transaction, col, fn, where as sequelizeWhere } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetModel } from "../../models/postgres/asset.model";
import { AssetStatusModel } from "../../models/postgres/assetStatus.model";
import { CostCenterModel } from "../../models/postgres/costCenter.model";
import { GoodsReceiptModel } from "../../models/mssql/goodsReceipt.model";
import { getAssetStatusByCodeOrThrow } from "./assetStatus.service";
import { recordAcquisition } from "./assetKardex.service";
import { getProductByIdOrThrow, getProductsByIds } from "../mongo/product.service";
import { NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { ProductType } from "../../types/mongo/product.types";
import type {
  AssetUpdateAttributes,
  CreateAssetFromInventoryInput,
  CreateAssetsFromReceiptInput,
} from "../../types/postgres/asset.types";

const PAD_LENGTH = 9;

// ARR/SRV/ACT segun lo pedido por el usuario: el prefijo del tag depende de
// si el producto recibido es un arriendo, un servicio o una compra
// (Product.productType, catalogo Mongo) -no del proveedor ni de la OC. "ACT"
// (no "PUR") porque una compra pasa a ser un activo propio de la empresa.
const TAG_PREFIX_BY_PRODUCT_TYPE: Record<ProductType, "ARR" | "SRV" | "ACT"> = {
  ARRIENDO: "ARR",
  SERVICIO: "SRV",
  COMPRA: "ACT",
};

async function generateAssetTag(prefix: "ARR" | "SRV" | "ACT", transaction: Transaction): Promise<string> {
  const rows = await postgres.query<{ next_seq: number }>(
    `UPDATE asset_tag_counters SET next_seq = next_seq + 1 WHERE prefix = :prefix RETURNING next_seq`,
    { replacements: { prefix }, type: QueryTypes.SELECT, transaction },
  );
  const nextSeq = rows[0]?.next_seq;
  if (nextSeq === undefined) {
    throw new Error(`No existe contador de tag de activo para el prefijo '${prefix}'`);
  }
  return `${prefix}${String(nextSeq).padStart(PAD_LENGTH, "0")}`;
}

const SEARCH_FIELDS = ["tag", "serialNumber"];

// goodsReceiptId opcional: cuando viene, restringe a los assets nacidos de
// ESA recepcion puntual -usado por ReceiveGoods.tsx (Fase D) para mostrar de
// inmediato los tags/series recien generados, mismo patron que el filtro
// requestId de listPurchaseOrders.
export async function listAssets(
  params: PaginationParams,
  goodsReceiptId?: number,
): Promise<{ items: AssetModel[]; total: number }> {
  const { rows, count } = await AssetModel.findAndCountAll({
    where: {
      ...buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.iLike),
      ...(goodsReceiptId !== undefined ? { goodsReceiptId } : {}),
    },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    // costCenter incluido para AssignAsset.tsx (pantalla independiente de
    // asignacion, ver menu-catalog.ts): busca por tag/serie y necesita
    // mostrar el centro de costo de solo lectura sin una segunda llamada.
    include: [
      { model: AssetStatusModel, as: "status" },
      { model: CostCenterModel, as: "costCenter" },
    ],
  });
  return { items: rows, total: count };
}

// Reverse-lookup cross-engine (GoodsReceipt vive en MSSQL, Asset en
// Postgres, sin FK real entre ambos): usado por AssignAssets.tsx (Fase E)
// para listar TODAS las unidades recibidas de una solicitud de una sola vez
// -sin paginar, la cantidad tipica es de unidades, no miles.
export async function getAssetsByRequestId(requestId: number): Promise<AssetModel[]> {
  const receipts = await GoodsReceiptModel.findAll({ where: { requestId }, attributes: ["id"] });
  if (receipts.length === 0) return [];
  return AssetModel.findAll({
    where: { goodsReceiptId: { [Op.in]: receipts.map((receipt) => receipt.id) } },
    include: [
      { model: AssetStatusModel, as: "status" },
      { model: CostCenterModel, as: "costCenter" },
    ],
    order: [["id", "ASC"]],
  });
}

// transaction opcional: sin el, Sequelize toma una conexion cualquiera del
// pool -si se llama DENTRO de una transaccion abierta en OTRA conexion (ej.
// desde assetKardex.service.ts al crear un asiento en la misma transaccion
// que crea el Asset), esa lectura no ve la fila todavia no confirmada y
// tira NotFoundError sobre un activo que en los hechos SI existe.
export async function getAssetById(id: number, transaction?: Transaction): Promise<AssetModel | null> {
  return AssetModel.findByPk(id, { include: [{ model: AssetStatusModel, as: "status" }], transaction });
}

export async function getAssetByIdOrThrow(id: number, transaction?: Transaction): Promise<AssetModel> {
  const asset = await getAssetById(id, transaction);
  if (!asset) throw new NotFoundError(`El activo ${id} no existe`);
  return asset;
}

// Coincidencia EXACTA por tag (listAssets solo busca con iLike, un tag
// parcial devolveria varios). Normaliza espacios y mayusculas: el lector de
// codigos de barras/QR puede agregar espacios o entregar el texto en minusculas.
export async function getAssetByTag(tag: string, transaction?: Transaction): Promise<AssetModel | null> {
  const normalized = tag.trim().toUpperCase();
  if (!normalized) return null;
  return AssetModel.findOne({
    where: { tag: normalized },
    include: [{ model: AssetStatusModel, as: "status" }],
    transaction,
  });
}

// TODAS las coincidencias de una serie (sin distinguir mayusculas ni espacios de
// borde), con su estado. Usado por la toma de inventario para encontrar el
// activo de un equipo por su serie y para no duplicar uno que ya existe: puede
// haber mas de una en datos legados, y en ese caso quien llama debe rechazar en
// vez de elegir una al azar.
export async function findAssetsBySerial(serialNumber: string, transaction?: Transaction): Promise<AssetModel[]> {
  if (!serialNumber.trim()) return [];
  return AssetModel.findAll({
    // Misma expresion que el indice ix_assets_serial_normalized y que la clave del advisory lock de la toma
    // (lower + btrim), calculada en SQL a ambos lados: JS y Postgres discrepan con tabs y caracteres no ASCII.
    where: sequelizeWhere(fn("lower", fn("btrim", col("serial_number"))), fn("lower", fn("btrim", serialNumber))),
    include: [{ model: AssetStatusModel, as: "status" }],
    order: [["id", "ASC"]],
    transaction,
  });
}

// Ubicacion = centro de costo. La toma de inventario mueve el activo al centro de
// costo donde el auditor lo encontro y, si el activo no tenia producto (activo
// legado), le completa el elegido. Corre dentro de la transaccion de quien llama.
export async function updateAssetLocation(
  assetId: number,
  input: { costCenterId: number; productIdIfMissing?: string | null; updatedBy?: number },
  transaction: Transaction,
): Promise<void> {
  await AssetModel.update(
    {
      costCenterId: input.costCenterId,
      ...(input.productIdIfMissing ? { productId: input.productIdIfMissing } : {}),
      ...(input.updatedBy !== undefined ? { updatedBy: input.updatedBy } : {}),
    },
    { where: { id: assetId }, transaction },
  );
}

// SELECT...FOR UPDATE sin join (a diferencia de getAssetById, que incluye
// status via belongsTo -Postgres rechaza FOR UPDATE sobre el lado nullable
// de un LEFT JOIN). Bloquea la fila ANTES de re-leer el estado con join,
// para serializar el guard de estado contra el UPDATE que lo sigue -mismo
// patron que lockAndGetPreviousBalance en assetKardex.service.ts. Debe
// llamarse dentro de la misma transaccion que el UPDATE de status.
export async function lockAssetRow(id: number, transaction: Transaction): Promise<void> {
  // NO KEY UPDATE (no UPDATE): igual de exclusivo para serializar los guards de estado, pero no
  // bloquea los INSERT de otras transacciones que solo referencian la fila por FK (movimientos, lineas).
  await postgres.query(`SELECT id FROM assets WHERE id = :id FOR NO KEY UPDATE`, {
    replacements: { id },
    transaction,
  });
}

// Se llama desde services/mssql/goodsReceipt.service.ts al confirmar una
// recepcion -escritura cross-engine real (MSSQL ya confirmado -> Postgres),
// no atomica entre los dos motores: si esto falla despues de confirmado el
// GoodsReceipt, queda un GoodsReceipt sin Assets, hay que reconciliar a mano
// (ver memoria project-erp-scope-and-data-classification).
//
// Un Asset POR UNIDAD (decision B del plan), no un Asset con campo cantidad
// -asi cada unidad se puede asignar a un empleado distinto mas adelante
// (Fase E). Loop SECUENCIAL, no Promise.all: generateAssetTag hace un
// UPDATE...RETURNING sobre la misma fila del contador dentro de la misma
// transaccion -correrlo en paralelo serializaria las queries o generaria
// deadlock, sin ninguna ganancia real (la cantidad tipica es de unidades,
// no miles).
//
// Nacen en RECEIVED y, si input.finalStatusCode viene (ej. "AVAILABLE"), se
// transicionan en la MISMA transaccion via setAssetStatus -en vez de nacer
// directo en el status final- para que RECEIVED->AVAILABLE quede como un
// paso real y rastreable (el status ya estaba sembrado en asset_statuses
// pero ningun codigo lo usaba hasta ahora), sin costo adicional.
export async function createAssetsFromReceipt(input: CreateAssetsFromReceiptInput): Promise<AssetModel[]> {
  const product = await getProductByIdOrThrow(input.productId);
  const prefix = TAG_PREFIX_BY_PRODUCT_TYPE[product.productType];
  const receivedStatus = await getAssetStatusByCodeOrThrow("RECEIVED");
  const finalStatus = input.finalStatusCode ? await getAssetStatusByCodeOrThrow(input.finalStatusCode) : null;

  const createdIds = await postgres.transaction(async (transaction) => {
    const ids: number[] = [];
    for (let i = 0; i < input.quantity; i++) {
      const tag = await generateAssetTag(prefix, transaction);
      const asset = await AssetModel.create(
        {
          tag,
          statusId: receivedStatus.id,
          serialNumber: input.serialNumbers?.[i] ?? null,
          warrantyExpiresAt: input.warrantyExpiresAt ?? null,
          value: input.value ?? null,
          receivedAt: input.receivedAt ?? new Date().toISOString().slice(0, 10),
          goodsReceiptId: input.goodsReceiptId,
          costCenterId: input.costCenterId ?? null,
          productId: input.productId,
          createdBy: input.createdBy ?? null,
        },
        { transaction },
      );
      if (finalStatus) {
        await setAssetStatus(asset.id, finalStatus.id, transaction, input.createdBy ?? undefined);
      }
      // Alta en el Kardex: un asiento ACQUISITION por unidad, en la MISMA
      // transaccion que crea el Asset -si el Kardex falla, la recepcion de
      // esa unidad se revierte junto con el, no puede quedar un Asset sin su
      // asiento de alta. Sin input.value no hay costo que registrar (no
      // debería pasar en el flujo real -goodsReceipt.service.ts siempre
      // manda quote.purchaseValue-, pero no es motivo para tumbar toda la
      // recepcion si algun caller nuevo lo omite).
      if (input.value) {
        await recordAcquisition(
          { assetId: asset.id, unitCost: input.value, reference: tag, createdBy: input.createdBy },
          transaction,
        );
      }
      ids.push(asset.id);
    }
    return ids;
  });

  return AssetModel.findAll({
    where: { id: { [Op.in]: createdIds } },
    include: [{ model: AssetStatusModel, as: "status" }],
  });
}

// Alta de UN activo desde una toma de inventario (inventoryCount.service.ts):
// el equipo existe fisicamente pero no en el sistema. Corre dentro de la
// transaccion de quien llama para que activo + movimiento + linea de la toma
// sean atomicos. Nace AVAILABLE (mismo primer estado operativo que un activo
// recibido) y el estado real declarado por el auditor se aplica despues con
// createAssetMovement/setAssetStatus. Sin goodsReceiptId ni asiento
// ACQUISITION: no hay recepcion ni costo conocido.
export async function createAssetFromInventory(
  input: CreateAssetFromInventoryInput,
  transaction: Transaction,
): Promise<AssetModel> {
  const availableStatus = await getAssetStatusByCodeOrThrow("AVAILABLE", transaction);
  const tag = await generateAssetTag(TAG_PREFIX_BY_PRODUCT_TYPE[input.productType], transaction);
  return AssetModel.create(
    {
      tag,
      statusId: availableStatus.id,
      serialNumber: input.serialNumber,
      warrantyExpiresAt: null,
      value: null,
      receivedAt: new Date().toISOString().slice(0, 10),
      goodsReceiptId: null,
      costCenterId: input.costCenterId,
      productId: input.productId,
      createdBy: input.createdBy ?? null,
      updatedBy: null,
    },
    { transaction },
  );
}

export async function updateAsset(id: number, data: AssetUpdateAttributes): Promise<AssetModel> {
  const asset = await getAssetByIdOrThrow(id);
  await asset.update(data);
  return asset;
}

// Datos para la etiqueta fisica (library/labels/assetLabelZpl.ts): batch por
// ids -evita N+1 contra Mongo al imprimir un lote (ver getProductsByIds,
// mismo patron ya usado por getQuoteRequestDocumentData/attachProduct).
// Assets sin productId (creados antes de esta fase) simplemente no llevan
// nombre de producto en la etiqueta.
export async function getAssetsLabelData(
  ids: number[],
): Promise<{ tag: string; serialNumber: string | null; productName: string | null }[]> {
  const assets = await AssetModel.findAll({ where: { id: { [Op.in]: ids } } });
  const productIds = [...new Set(assets.map((asset) => asset.productId).filter((id): id is string => id !== null))];
  const products = await getProductsByIds(productIds);
  const productNameById = new Map(products.map((product) => [String(product._id), product.name]));
  return assets.map((asset) => ({
    tag: asset.tag,
    serialNumber: asset.serialNumber,
    productName: asset.productId ? (productNameById.get(asset.productId) ?? null) : null,
  }));
}

export async function setAssetStatus(
  id: number,
  statusId: number,
  transaction?: Transaction,
  updatedBy?: number,
): Promise<void> {
  await AssetModel.update({ statusId, updatedBy }, { where: { id }, transaction });
}
