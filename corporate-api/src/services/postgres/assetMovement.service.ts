import { postgres } from "../../databases/postgres/connection";
import { AssetMovementModel } from "../../models/postgres/assetMovement.model";
import { AssetMovementUserModel } from "../../models/postgres/assetMovementUser.model";
import { getAssetByIdOrThrow, setAssetStatus } from "./asset.service";
import { getAssetStatusByCodeOrThrow } from "./assetStatus.service";
import { getUserByIdOrThrow } from "../mssql/user.service";
import { BadRequestError, ConflictError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder } from "../../library/sequelizeSearch";
import type { AssignAssetInput, CreateAssetMovementInput } from "../../types/postgres/assetMovement.types";

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

// Incluye los usuarios asignados en cada movimiento (asset_movement_users,
// escritos en createAssetMovement mas abajo) -antes quedaban invisibles via
// API: se escribian pero ningun endpoint los devolvia.
export async function listMovementsByAsset(
  assetId: number,
  params: PaginationParams,
): Promise<{ items: AssetMovementModel[]; total: number }> {
  const { rows, count } = await AssetMovementModel.findAndCountAll({
    where: { assetId },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    include: [{ model: AssetMovementUserModel, as: "movementUsers" }],
  });
  return { items: rows, total: count };
}

// userId es una referencia cross-engine hacia users (MSSQL), sin FK real
// -validada aca contra el service de MSSQL antes de insertar, mismo criterio
// que el resto de las referencias cross-engine de este proyecto.
export async function createAssetMovement(input: CreateAssetMovementInput): Promise<AssetMovementModel> {
  const asset = await getAssetByIdOrThrow(input.assetId);

  const userIds = input.userIds ?? [];
  if (MOVEMENT_TYPES_REQUIRING_USERS.has(input.movementType) && userIds.length === 0) {
    throw new BadRequestError(`El movimiento '${input.movementType}' requiere al menos un usuario`);
  }
  for (const userId of userIds) {
    await getUserByIdOrThrow(userId);
  }

  // Guards nuevos (Fase E) -hoy no habia ninguno: se podia "asignar" un
  // activo DECOMMISSIONED sin que nada lo impidiera.
  if (input.movementType === "ASSIGNED" && asset.status?.code !== "AVAILABLE") {
    throw new ConflictError(
      `El activo ${asset.tag} no esta disponible para asignar (estado actual: ${asset.status?.code ?? "desconocido"})`,
    );
  }
  if (input.movementType === "REASSIGNED" && asset.status?.code !== "ASSIGNED") {
    throw new ConflictError(
      `El activo ${asset.tag} no esta asignado, no se puede reasignar (estado actual: ${asset.status?.code ?? "desconocido"})`,
    );
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

    await setAssetStatus(input.assetId, newStatus.id, transaction, input.createdBy ?? undefined);

    return created;
  });

  return movement;
}

// Paso 9 del flujo: asigna UNA unidad a UN empleado. NO toca el estado de la
// PurchaseRequest -el cierre del ciclo de compra (DELIVERED) se dispara en
// createGoodsReceipt (ver isRequestFullyReceived en goodsReceipt.service.ts)
// cuando lo recibido cubre lo autorizado, sin importar si ya se asigno a
// alguien. Decision del usuario tras un caso real: una solicitud de 4
// notebooks para 3 personas + 1 de respaldo nunca cerraria si el cierre
// dependiera de que TODAS las unidades queden ASSIGNED, porque el respaldo
// se deja deliberadamente disponible sin asignar. Asignar es entonces un
// simple wrapper de createAssetMovement con userIds:[userId] -un ciclo de
// vida del activo aparte, sin relacion con el cierre de la solicitud.
export async function assignAssetToUser(input: AssignAssetInput): Promise<AssetMovementModel> {
  return createAssetMovement({
    assetId: input.assetId,
    movementType: "ASSIGNED",
    userIds: [input.userId],
    notes: input.notes,
    createdBy: input.createdBy,
  });
}
