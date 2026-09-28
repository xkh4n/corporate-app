import { Op } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetModel } from "../../models/postgres/asset.model";
import { AssetStatusModel } from "../../models/postgres/assetStatus.model";
import { CostCenterModel } from "../../models/postgres/costCenter.model";
import { getAssetByIdOrThrow, lockAssetRow } from "./asset.service";
import { recordAcquisition } from "./assetKardex.service";
import { getProductsByIds } from "../mongo/product.service";
import { AppError, BadRequestError, ConflictError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";

// Valorizacion posterior a la toma de inventario (Adquisiciones TI): los activos
// creados por la toma no tienen costo conocido (assets.value = NULL, sin asiento
// de Kardex). Aqui se les asigna valor por primera vez, lo que ademas escribe
// el asiento ACQUISITION de alta -igual que una recepcion. Corregir un valor ya
// cargado NO se hace aca: es un ajuste manual de contabilidad (asset-kardex).

// Sin valor pendiente: DECOMMISSIONED ya paso por su baja (WRITE_OFF) y
// DEVALUATED tiene valor 0 a proposito; asignarles costo reviviria un saldo.
const NOT_VALUABLE_STATUS_CODES = ["DECOMMISSIONED", "WRITTEN_OFF", "DEVALUATED"];

const SEARCH_FIELDS = ["tag", "serialNumber"];

export const VALUATION_NOTE = "Valorización posterior a toma de inventario";

export interface PendingValuationAsset {
  id: number;
  tag: string;
  serialNumber: string | null;
  status: { code: string; name: string };
  costCenter: { id: number; code: number; name: string } | null;
  productName: string | null;
  createdAt: Date;
}

// Activos con value NULL y un estado valorizable. Solo ese filtro define el
// pendiente: no importa si el activo nacio de una recepcion o de una toma.
export async function listAssetsPendingValuation(
  params: PaginationParams,
): Promise<{ items: PendingValuationAsset[]; total: number }> {
  const { rows, count } = await AssetModel.findAndCountAll({
    where: { value: null, ...buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.iLike) },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    include: [
      {
        model: AssetStatusModel,
        as: "status",
        required: true,
        where: { code: { [Op.notIn]: NOT_VALUABLE_STATUS_CODES } },
      },
      { model: CostCenterModel, as: "costCenter" },
    ],
  });

  const productIds = [...new Set(rows.map((asset) => asset.productId).filter((id): id is string => !!id))];
  const products = await getProductsByIds(productIds);
  const productNames = new Map(products.map((product) => [String(product._id), product.name]));

  return {
    items: rows.map((asset) => ({
      id: asset.id,
      tag: asset.tag,
      serialNumber: asset.serialNumber,
      status: { code: asset.status?.code ?? "", name: asset.status?.name ?? "" },
      costCenter: asset.costCenter
        ? { id: asset.costCenter.id, code: asset.costCenter.code, name: asset.costCenter.name }
        : null,
      productName: asset.productId ? (productNames.get(asset.productId) ?? null) : null,
      createdAt: asset.createdAt,
    })),
    total: count,
  };
}

export interface ValuationItemResult {
  assetId: number;
  ok: boolean;
  tag?: string;
  error?: string;
}

// Un activo: fija assets.value y escribe el ACQUISITION en la MISMA transaccion
// (o ambos o ninguno). Exige que el activo no tenga valor todavia.
async function valueOneAsset(assetId: number, value: number, createdBy: number): Promise<string> {
  const unitCost = value.toFixed(2);
  // Defensa en profundidad (el Zod exige >= 0.01): 0.00 esta reservado a DEVALUATED y dejaria el activo
  // "con valor" en cero, imposible de valorizar despues.
  if (!(Number(unitCost) > 0)) throw new BadRequestError("El valor debe ser de al menos 0,01");
  return postgres.transaction(async (transaction) => {
    await lockAssetRow(assetId, transaction);
    const asset = await getAssetByIdOrThrow(assetId, transaction);
    if (asset.value !== null) {
      throw new ConflictError(`El activo ${asset.tag} ya tiene valor: corríjalo con un ajuste de Kardex`);
    }
    if (NOT_VALUABLE_STATUS_CODES.includes(asset.status?.code ?? "")) {
      throw new ConflictError(`El activo ${asset.tag} está ${asset.status?.name ?? "dado de baja"} y no se valoriza`);
    }
    await AssetModel.update({ value: unitCost, updatedBy: createdBy }, { where: { id: assetId }, transaction });
    await recordAcquisition(
      { assetId, unitCost, reference: asset.tag, notes: VALUATION_NOTE, createdBy },
      transaction,
    );
    return asset.tag;
  });
}

// Lote: cada activo en su PROPIA transaccion, un fallo no aborta el resto. Solo
// se traducen a resultado los errores de negocio (AppError); un error
// inesperado (BD caida, bug) si se propaga.
export async function valueAssets(
  items: { assetId: number; value: number }[],
  createdBy: number,
): Promise<ValuationItemResult[]> {
  const results: ValuationItemResult[] = [];
  for (const item of items) {
    try {
      const tag = await valueOneAsset(item.assetId, item.value, createdBy);
      results.push({ assetId: item.assetId, ok: true, tag });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      results.push({ assetId: item.assetId, ok: false, error: err.message });
    }
  }
  return results;
}
