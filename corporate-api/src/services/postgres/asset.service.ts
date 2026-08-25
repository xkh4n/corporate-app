import { Op, QueryTypes, Transaction } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetModel } from "../../models/postgres/asset.model";
import { AssetStatusModel } from "../../models/postgres/assetStatus.model";
import { getAssetStatusByCodeOrThrow } from "./assetStatus.service";
import { getProductByIdOrThrow } from "../mongo/product.service";
import { NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { ProductType } from "../../types/mongo/product.types";
import type { AssetUpdateAttributes, CreateAssetsFromReceiptInput } from "../../types/postgres/asset.types";

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
    include: [{ model: AssetStatusModel, as: "status" }],
  });
  return { items: rows, total: count };
}

export async function getAssetById(id: number): Promise<AssetModel | null> {
  return AssetModel.findByPk(id, { include: [{ model: AssetStatusModel, as: "status" }] });
}

export async function getAssetByIdOrThrow(id: number): Promise<AssetModel> {
  const asset = await getAssetById(id);
  if (!asset) throw new NotFoundError(`El activo ${id} no existe`);
  return asset;
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
          createdBy: input.createdBy ?? null,
        },
        { transaction },
      );
      if (finalStatus) {
        await setAssetStatus(asset.id, finalStatus.id, transaction, input.createdBy ?? undefined);
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

export async function updateAsset(id: number, data: AssetUpdateAttributes): Promise<AssetModel> {
  const asset = await getAssetByIdOrThrow(id);
  await asset.update(data);
  return asset;
}

export async function setAssetStatus(
  id: number,
  statusId: number,
  transaction?: Transaction,
  updatedBy?: number,
): Promise<void> {
  await AssetModel.update({ statusId, updatedBy }, { where: { id }, transaction });
}
