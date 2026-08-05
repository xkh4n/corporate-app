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
import type { AssetUpdateAttributes, CreateAssetFromReceiptInput } from "../../types/postgres/asset.types";

const PAD_LENGTH = 9;

// ARR/SRV/ACT segun lo pedido por el usuario: el prefijo del tag depende de
// si el producto recibido es un arriendo, un servicio o una compra
// (Product.productType, catalogo Mongo) -no del proveedor ni de la OC. "ACT"
// (no "PUR") porque una compra pasa a ser un activo propio de la empresa.
const TAG_PREFIX_BY_PRODUCT_TYPE: Record<ProductType, "ARR" | "SRV" | "ACT"> = {
  LEASE: "ARR",
  SERVICE: "SRV",
  PURCHASE: "ACT",
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

export async function listAssets(params: PaginationParams): Promise<{ items: AssetModel[]; total: number }> {
  const { rows, count } = await AssetModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.iLike),
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
// GoodsReceipt, queda un GoodsReceipt sin Asset, hay que reconciliar a mano
// (ver memoria project-erp-scope-and-data-classification).
export async function createAssetFromReceipt(input: CreateAssetFromReceiptInput): Promise<AssetModel> {
  const product = await getProductByIdOrThrow(input.productId);
  const prefix = TAG_PREFIX_BY_PRODUCT_TYPE[product.productType];
  const receivedStatus = await getAssetStatusByCodeOrThrow("RECEIVED");

  const asset = await postgres.transaction(async (transaction) => {
    const tag = await generateAssetTag(prefix, transaction);
    return AssetModel.create(
      {
        tag,
        statusId: receivedStatus.id,
        serialNumber: input.serialNumber ?? null,
        warrantyExpiresAt: input.warrantyExpiresAt ?? null,
        value: input.value ?? null,
        receivedAt: input.receivedAt ?? new Date().toISOString().slice(0, 10),
        goodsReceiptId: input.goodsReceiptId,
        createdBy: input.createdBy ?? null,
      },
      { transaction },
    );
  });

  return getAssetByIdOrThrow(asset.id);
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
