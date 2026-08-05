import { postgres } from "../../databases/postgres/connection";
import { AssetMovementModel } from "../../models/postgres/assetMovement.model";
import { AssetMovementUserModel } from "../../models/postgres/assetMovementUser.model";
import { getAssetByIdOrThrow, setAssetStatus } from "./asset.service";
import { getAssetStatusByCodeOrThrow } from "./assetStatus.service";
import { getUserByIdOrThrow } from "../mssql/user.service";
import { BadRequestError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder } from "../../library/sequelizeSearch";
import type { CreateAssetMovementInput } from "../../types/postgres/assetMovement.types";

// El estado ACTUAL del activo (Asset.statusId) se actualiza aca como efecto
// del movimiento -no se recalcula despues buscando el ultimo movimiento
// (ver memoria project-erp-scope-and-data-classification, "modelo maestro +
// movimientos").
const STATUS_CODE_BY_MOVEMENT_TYPE = {
  ASSIGNED: "ASSIGNED",
  REASSIGNED: "ASSIGNED",
  SUPPORT: "SUPPORT",
  DECOMMISSIONED: "DECOMMISSIONED",
} as const;

const MOVEMENT_TYPES_REQUIRING_USERS = new Set(["ASSIGNED", "REASSIGNED"]);

export async function listMovementsByAsset(
  assetId: number,
  params: PaginationParams,
): Promise<{ items: AssetMovementModel[]; total: number }> {
  const { rows, count } = await AssetMovementModel.findAndCountAll({
    where: { assetId },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function getMovementUsers(assetMovementId: number): Promise<AssetMovementUserModel[]> {
  return AssetMovementUserModel.findAll({ where: { assetMovementId } });
}

// userId es una referencia cross-engine hacia users (MSSQL), sin FK real
// -validada aca contra el service de MSSQL antes de insertar, mismo criterio
// que el resto de las referencias cross-engine de este proyecto.
export async function createAssetMovement(input: CreateAssetMovementInput): Promise<AssetMovementModel> {
  await getAssetByIdOrThrow(input.assetId);

  const userIds = input.userIds ?? [];
  if (MOVEMENT_TYPES_REQUIRING_USERS.has(input.movementType) && userIds.length === 0) {
    throw new BadRequestError(`El movimiento '${input.movementType}' requiere al menos un usuario`);
  }
  for (const userId of userIds) {
    await getUserByIdOrThrow(userId);
  }

  const newStatus = await getAssetStatusByCodeOrThrow(STATUS_CODE_BY_MOVEMENT_TYPE[input.movementType]);

  const movement = await postgres.transaction(async (transaction) => {
    const created = await AssetMovementModel.create(
      {
        assetId: input.assetId,
        movementType: input.movementType,
        // Mismo motivo que PurchaseOrder.issuedAt: el DEFAULT now() de la
        // columna no se activa si Sequelize ya rechazo el insert del lado
        // del cliente por allowNull:false sin valor.
        movementDate: new Date(),
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
      },
      { transaction },
    );

    if (userIds.length > 0) {
      await AssetMovementUserModel.bulkCreate(
        userIds.map((userId) => ({ assetMovementId: created.id, userId })),
        { transaction },
      );
    }

    await setAssetStatus(input.assetId, newStatus.id, transaction);

    return created;
  });

  return movement;
}

export async function getMovementByIdOrThrow(id: number): Promise<AssetMovementModel> {
  const movement = await AssetMovementModel.findByPk(id);
  if (!movement) throw new NotFoundError(`El movimiento de activo ${id} no existe`);
  return movement;
}
