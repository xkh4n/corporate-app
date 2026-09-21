import { Op, type Transaction } from "sequelize";
import { AssetStatusModel } from "../../models/postgres/assetStatus.model";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type {
  AssetStatusCreationAttributes,
  AssetStatusUpdateAttributes,
} from "../../types/postgres/assetStatus.types";

const SEARCH_FIELDS = ["code", "name", "description"];

export async function listAssetStatuses(
  params: PaginationParams,
): Promise<{ items: AssetStatusModel[]; total: number }> {
  const { rows, count } = await AssetStatusModel.findAndCountAll({
    where: buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.iLike),
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getAssetStatusById(id: number): Promise<AssetStatusModel | null> {
  return AssetStatusModel.findByPk(id);
}

export async function getAssetStatusByIdOrThrow(id: number): Promise<AssetStatusModel> {
  const status = await getAssetStatusById(id);
  if (!status) throw new NotFoundError(`El estado de activo ${id} no existe`);
  return status;
}

// transaction: quien ya tiene una transaccion abierta debe pasarla; si no, la consulta toma OTRA
// conexion del pool mientras retiene la suya y, con suficientes requests simultaneas, el pool se agota.
export async function getAssetStatusByCode(code: string, transaction?: Transaction): Promise<AssetStatusModel | null> {
  return AssetStatusModel.findOne({ where: { code }, transaction });
}

export async function getAssetStatusByCodeOrThrow(code: string, transaction?: Transaction): Promise<AssetStatusModel> {
  const status = await getAssetStatusByCode(code, transaction);
  if (!status) throw new NotFoundError(`No existe el estado de activo con codigo '${code}'`);
  return status;
}

// Lista abierta ("etc." segun el usuario, ver memoria
// project-erp-scope-and-data-classification) -por eso hay createAssetStatus,
// a diferencia de countries/cities/states que se cargan solo por seed.
export async function createAssetStatus(data: AssetStatusCreationAttributes): Promise<AssetStatusModel> {
  const existing = await getAssetStatusByCode(data.code);
  if (existing) throw new ConflictError(`Ya existe un estado de activo con codigo '${data.code}'`);
  return AssetStatusModel.create(data);
}

export async function updateAssetStatus(
  id: number,
  data: AssetStatusUpdateAttributes,
): Promise<AssetStatusModel> {
  const status = await getAssetStatusByIdOrThrow(id);
  await status.update(data);
  return status;
}
