import { postgres } from "../../databases/postgres/connection";
import { AssetMovementModel } from "../../models/postgres/assetMovement.model";
import { AssetMovementUserModel } from "../../models/postgres/assetMovementUser.model";
import { getAssetByIdOrThrow, setAssetStatus } from "./asset.service";
import { getAssetStatusByCodeOrThrow } from "./assetStatus.service";
import { recordWriteOff } from "./assetKardex.service";
import { getUserByIdOrThrow } from "../mssql/user.service";
import { getEmployeeByPersonId } from "../mssql/employee.service";
import { GoodsReceiptModel } from "../../models/mssql/goodsReceipt.model";
import { getSupplierByIdOrThrow } from "../mssql/supplier.service";
import { getBusinessPartnerByIdOrThrow } from "../mssql/businessPartner.service";
import { getCostCenterById } from "./costCenter.service";
import { getPositionById } from "../mongo/position.service";
import { getProductById } from "../mongo/product.service";
import { BadRequestError, ConflictError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder } from "../../library/sequelizeSearch";
import type { AssignAssetInput, CreateAssetMovementInput } from "../../types/postgres/assetMovement.types";
import type { AssetHandoverPdfData } from "../../library/pdf/assetHandoverPdf";

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
        supervisorName: input.supervisorName ?? null,
        macAddress: input.macAddress ?? null,
        storageCapacity: input.storageCapacity ?? null,
        ramCapacity: input.ramCapacity ?? null,
        hasBag: input.hasBag ?? null,
        hasLock: input.hasLock ?? null,
        hasCharger: input.hasCharger ?? null,
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

    // Baja del Kardex: la unidad deja de tener valor en libros al darse de
    // baja, en la MISMA transaccion que el resto del movimiento. Asignar
    // NO escribe al Kardex a proposito -mover un activo entre personas no
    // cambia su valorizacion.
    if (input.movementType === "DECOMMISSIONED") {
      await recordWriteOff({ assetId: input.assetId, reference: asset.tag }, transaction);
    }

    return created;
  });

  return movement;
}

// Compone los datos del acta de entrega (library/pdf/assetHandoverPdf.ts)
// cruzando los 3 motores: el movimiento y el activo (Postgres), el usuario
// asignado -> persona -> colaborador (MSSQL), y cargo/producto (Mongo).
// Solo tiene sentido para ASSIGNED/REASSIGNED (los unicos con usuario
// asociado) -SUPPORT/DECOMMISSIONED no generan acta.
export async function getAssetHandoverData(movementId: number): Promise<AssetHandoverPdfData> {
  const movement = await AssetMovementModel.findByPk(movementId, {
    include: [{ model: AssetMovementUserModel, as: "movementUsers" }],
  });
  if (!movement) throw new NotFoundError(`El movimiento ${movementId} no existe`);
  const assignedUserId = movement.movementUsers?.[0]?.userId;
  if (!assignedUserId) {
    throw new BadRequestError(`El movimiento ${movementId} no tiene un usuario asignado, no genera acta`);
  }

  const [asset, user] = await Promise.all([getAssetByIdOrThrow(movement.assetId), getUserByIdOrThrow(assignedUserId)]);
  const person = user.person;
  if (!person) throw new NotFoundError(`El usuario ${assignedUserId} no tiene una persona asociada`);

  const employee = await getEmployeeByPersonId(person.id);
  // Proveedor: Asset -> GoodsReceipt (MSSQL, via goodsReceiptId) -> Supplier
  // -> BusinessPartner.legalName. Resuelto automaticamente (el usuario lo
  // pidio explicitamente): la cadena ya existe en el modelo, no hace falta
  // pedirselo a nadie en el formulario. Sin goodsReceiptId (activo legado,
  // creado antes de este campo) simplemente no hay proveedor que mostrar.
  const goodsReceipt = asset.goodsReceiptId ? await GoodsReceiptModel.findByPk(asset.goodsReceiptId) : null;
  const [position, costCenter, product, supplier] = await Promise.all([
    employee?.positionId ? getPositionById(employee.positionId) : Promise.resolve(null),
    asset.costCenterId ? getCostCenterById(asset.costCenterId) : Promise.resolve(null),
    asset.productId ? getProductById(asset.productId) : Promise.resolve(null),
    goodsReceipt ? getSupplierByIdOrThrow(goodsReceipt.supplierId) : Promise.resolve(null),
  ]);
  const businessPartner = supplier ? await getBusinessPartnerByIdOrThrow(supplier.businessPartnerId) : null;

  return {
    employeeName: `${person.firstName} ${person.lastName}`,
    employeeDocumentId: person.documentId,
    position: position?.title ?? null,
    costCenterName: costCenter?.name ?? null,
    supervisorName: movement.supervisorName,
    assetTag: asset.tag,
    serialNumber: asset.serialNumber,
    productName: product?.name ?? null,
    supplierName: businessPartner?.legalName ?? null,
    storageCapacity: movement.storageCapacity,
    ramCapacity: movement.ramCapacity,
    hasBag: movement.hasBag,
    hasLock: movement.hasLock,
    hasCharger: movement.hasCharger,
    macAddress: movement.macAddress,
    assignedAt: movement.movementDate,
  };
}

// Asigna UNA unidad a UN empleado. NO toca el estado de la PurchaseRequest
// -el cierre del ciclo de compra (DELIVERED) se dispara en
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
    supervisorName: input.supervisorName,
    macAddress: input.macAddress,
    storageCapacity: input.storageCapacity,
    ramCapacity: input.ramCapacity,
    hasBag: input.hasBag,
    hasLock: input.hasLock,
    hasCharger: input.hasCharger,
    createdBy: input.createdBy,
  });
}
