import { QueryTypes, Transaction } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetModel } from "../../models/postgres/asset.model";
import { AssetMovementModel } from "../../models/postgres/assetMovement.model";
import { AssetMovementUserModel } from "../../models/postgres/assetMovementUser.model";
import { getAssetByIdOrThrow, lockAssetRow, setAssetStatus, updateAssetLocation } from "./asset.service";
import { getAssetStatusByCodeOrThrow } from "./assetStatus.service";
import { recordWriteOff } from "./assetKardex.service";
import { findUserIdsBySearch, getUserByIdOrThrow, getUserDirectory } from "../mssql/user.service";
import { getEmployeeByPersonId } from "../mssql/employee.service";
import { GoodsReceiptModel } from "../../models/mssql/goodsReceipt.model";
import { getSupplierByIdOrThrow } from "../mssql/supplier.service";
import { getBusinessPartnerByIdOrThrow } from "../mssql/businessPartner.service";
import { getCostCenterById, getCostCenterByIdOrThrow } from "./costCenter.service";
import { CostCenterModel } from "../../models/postgres/costCenter.model";
import { getPositionById } from "../mongo/position.service";
import { getProductById, getProductsByIds, listProductIdsByCategory } from "../mongo/product.service";
import { getProductCategoriesByIds } from "../mongo/productCategory.service";
import { BadRequestError, ConflictError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, escapeLikePattern } from "../../library/sequelizeSearch";
import type {
  AssignAssetInput,
  AssignmentCostCenter,
  AssignmentFilters,
  AssignmentRow,
  CreateAssetMovementInput,
  CurrentAssignment,
  ReassignAssetInput,
} from "../../types/postgres/assetMovement.types";
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
  RETURNED: "RETURNED",
  MOVE_TO_RETURNED: "MOVE_TO_RETURNED",
  DEVALUATED: "DEVALUATED",
  // Salida de soporte desde un ticket del Service Desk (plan 009).
  SUPPORT_TO_HOLDER: "ASSIGNED",
  SUPPORT_TO_STOCK: "AVAILABLE",
} as const;

// Movimientos que dejan el activo en manos de un usuario: exigen usuario y
// definen el tenedor vigente (listCurrentHoldersByAssetIds). DEVALUATED es una
// baja reactivada en uso (valor 0), por eso tambien tiene tenedor.
// SUPPORT_TO_HOLDER devuelve el activo, reparado, a quien lo tenia.
export const MOVEMENT_TYPES_REQUIRING_USERS = new Set(["ASSIGNED", "REASSIGNED", "DEVALUATED", "SUPPORT_TO_HOLDER"]);

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
//
// externalTransaction opcional: la toma de inventario crea el activo y su
// movimiento en UNA sola transaccion (inventoryCount.service.ts). Sin ella,
// el movimiento abre la suya como siempre.
// Ticket del Service Desk que tiene el activo en soporte (enviado y sin devolver), o null.
export async function findOpenSupportTicketNumber(assetId: number, transaction?: Transaction): Promise<string | null> {
  const [link] = await postgres.query<{ number: string }>(
    `SELECT t.number FROM service_ticket_assets l JOIN service_tickets t ON t.id = l.ticket_id
      WHERE l.asset_id = :assetId AND l.support_movement_id IS NOT NULL AND l.return_movement_id IS NULL LIMIT 1`,
    { replacements: { assetId }, type: QueryTypes.SELECT, transaction },
  );
  return link?.number ?? null;
}

export async function createAssetMovement(
  input: CreateAssetMovementInput,
  externalTransaction?: Transaction,
): Promise<AssetMovementModel> {
  const userIds = input.userIds ?? [];
  if (MOVEMENT_TYPES_REQUIRING_USERS.has(input.movementType) && userIds.length === 0) {
    throw new BadRequestError(`El movimiento '${input.movementType}' requiere al menos un usuario`);
  }
  for (const userId of userIds) {
    await getUserByIdOrThrow(userId);
  }

  const applyMovement = async (transaction: Transaction): Promise<AssetMovementModel> => {
    // Bloquea la fila del activo ANTES de leer su estado y evaluar los
    // guards -sin esto, dos requests casi simultaneas para el mismo
    // assetId leian AVAILABLE antes de que cualquiera confirmara su
    // UPDATE y terminaban asignando la misma unidad fisica a usuarios
    // distintos (hallazgo de auditoria; mismo patron ya usado en
    // assetKardex.service.ts#lockAndGetPreviousBalance).
    await lockAssetRow(input.assetId, transaction);
    const asset = await getAssetByIdOrThrow(input.assetId, transaction);
    // Dentro de la transaccion: consultarlo fuera tomaba otra conexion del pool mientras se retiene esta.
    const newStatus = await getAssetStatusByCodeOrThrow(STATUS_CODE_BY_MOVEMENT_TYPE[input.movementType], transaction);

    // Un activo despachado en una devolucion (MOVE_TO_RETURNED) solo puede recibirse en Adquisiciones
    // (RETURNED). Cualquier otro movimiento lo sacaria de la devolucion y dejaria la recepcion trabada.
    if (asset.status?.code === "MOVE_TO_RETURNED" && input.movementType !== "RETURNED") {
      throw new ConflictError(
        `El activo ${asset.tag} esta en transito de devolucion: solo puede recibirse en Adquisiciones`,
      );
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

    // Devolucion (plan 004): MOVE_TO_RETURNED despacha un activo en manos de
    // alguien hacia Adquisiciones (solo desde ASSIGNED/DEVALUATED) y RETURNED
    // lo da por recibido (solo desde MOVE_TO_RETURNED). Ninguno toca el Kardex
    // ni el valor, y ninguno lleva tenedor: al despacharse el activo lo pierde.
    // Ambos son internos (assetReturn.service.ts), no estan en el enum Zod del
    // controlador: nadie devuelve sin guia. DEVALUATED: solo una baja (o un
    // devaluado que cambia de usuario) puede pasar a estar en uso con valor 0;
    // se crea unicamente desde la toma de inventario (tampoco esta en el enum).
    if (
      input.movementType === "MOVE_TO_RETURNED" &&
      !["ASSIGNED", "DEVALUATED"].includes(asset.status?.code ?? "")
    ) {
      throw new ConflictError(
        `El activo ${asset.tag} no esta asignado, no se puede despachar en devolucion (estado actual: ${asset.status?.code ?? "desconocido"})`,
      );
    }
    if (input.movementType === "RETURNED" && asset.status?.code !== "MOVE_TO_RETURNED") {
      throw new ConflictError(
        `El activo ${asset.tag} no esta en transito de devolucion, no se puede recibir (estado actual: ${asset.status?.code ?? "desconocido"})`,
      );
    }
    // Service Desk (plan 009): solo un activo en soporte puede volver a su
    // tenedor o a bodega. Ambos son internos (serviceDesk/ticketAsset.service.ts).
    if (
      (input.movementType === "SUPPORT_TO_HOLDER" || input.movementType === "SUPPORT_TO_STOCK") &&
      asset.status?.code !== "SUPPORT"
    ) {
      throw new ConflictError(
        `El activo ${asset.tag} no esta en soporte (estado actual: ${asset.status?.code ?? "desconocido"})`,
      );
    }
    // Un activo en soporte por un ticket solo vuelve desde ese ticket: darlo de
    // baja u otro movimiento aca dejaria el ticket sin poder cerrarse (run-3, N4).
    if (
      asset.status?.code === "SUPPORT" &&
      input.movementType !== "SUPPORT_TO_HOLDER" &&
      input.movementType !== "SUPPORT_TO_STOCK"
    ) {
      const ticketNumber = await findOpenSupportTicketNumber(input.assetId, transaction);
      if (ticketNumber) {
        throw new ConflictError(`El activo ${asset.tag} esta en soporte por el ticket ${ticketNumber}: devuelvalo desde el ticket`);
      }
    }
    if (input.movementType === "DEVALUATED" && !["DECOMMISSIONED", "DEVALUATED"].includes(asset.status?.code ?? "")) {
      throw new ConflictError(
        `El activo ${asset.tag} no esta dado de baja, no se puede devaluar (estado actual: ${asset.status?.code ?? "desconocido"})`,
      );
    }

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

    // Devaluado = valor 0 para poder hacerle seguimiento sin afectar el Kardex
    // (su WRITE_OFF de la baja ya lo dejo en saldo 0, no se escribe otro asiento).
    if (input.movementType === "DEVALUATED") {
      await AssetModel.update({ value: "0.00" }, { where: { id: input.assetId }, transaction });
    }

    // Baja del Kardex: la unidad deja de tener valor en libros al darse de
    // baja, en la MISMA transaccion que el resto del movimiento. Asignar
    // NO escribe al Kardex a proposito -mover un activo entre personas no
    // cambia su valorizacion.
    if (input.movementType === "DECOMMISSIONED") {
      await recordWriteOff({ assetId: input.assetId, reference: asset.tag }, transaction);
    }

    return created;
  };

  return externalTransaction ? applyMovement(externalTransaction) : postgres.transaction(applyMovement);
}

// Tenedor VIGENTE de cada activo, derivado del ULTIMO movimiento (de cualquier
// tipo): si ese movimiento es ASSIGNED/REASSIGNED devuelve su primer usuario;
// si es SUPPORT/DECOMMISSIONED (o no hay movimientos) el activo no tiene
// tenedor y no aparece en el Map. No hay columna "asignado a" en assets, por
// eso se deriva -y solo sirve para comparar, no para decidir permisos.
export async function listCurrentHoldersByAssetIds(
  assetIds: number[],
  transaction?: Transaction,
): Promise<Map<number, number>> {
  const holders = new Map<number, number>();
  if (assetIds.length === 0) return holders;
  const rows = await postgres.query<{ asset_id: number; movement_type: string; user_id: number | null }>(
    `SELECT DISTINCT ON (m.asset_id) m.asset_id, m.movement_type, mu.user_id
       FROM asset_movements m
       LEFT JOIN asset_movement_users mu ON mu.asset_movement_id = m.id
      WHERE m.asset_id IN (:assetIds)
      ORDER BY m.asset_id, m.movement_date DESC, m.id DESC, mu.id ASC`,
    { replacements: { assetIds }, type: QueryTypes.SELECT, transaction },
  );
  for (const row of rows) {
    if (MOVEMENT_TYPES_REQUIRING_USERS.has(row.movement_type) && row.user_id !== null) {
      holders.set(row.asset_id, row.user_id);
    }
  }
  return holders;
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

// ---------------------------------------------------------------------------
// Movimiento de Activos (plan 011): reasignar, asignacion vigente y listado.
// ---------------------------------------------------------------------------

// Estados con tenedor: los unicos que se reasignan y los que lista Visualizar
// Asignaciones. DEVALUATED es una baja reactivada en uso (valor 0).
const HELD_STATUS_CODES = ["ASSIGNED", "DEVALUATED"];
// Movimientos que generan acta (datos de entrega). SUPPORT_TO_HOLDER devuelve el
// activo reparado a quien ya lo tenia: su acta sigue siendo la anterior.
const HANDOVER_MOVEMENT_TYPES = ["ASSIGNED", "REASSIGNED", "DEVALUATED"];
const NOTES_MAX_LENGTH = 255;

function describeCostCenter(costCenter: AssignmentCostCenter | undefined | null): string {
  return costCenter ? `${costCenter.code} ${costCenter.name}` : "sin centro de costo";
}

async function loadCostCenters(ids: number[], transaction?: Transaction): Promise<Map<number, AssignmentCostCenter>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await CostCenterModel.findAll({ where: { id: unique }, transaction });
  return new Map(rows.map((row) => [row.id, { id: row.id, code: row.code, name: row.name }]));
}

// Cambia el tenedor, el centro de costo o ambos de un activo en uso, en UNA
// transaccion: el cambio de centro de costo y el movimiento (con su acta) se
// confirman juntos. Solo centro de costo tambien es un movimiento, con el mismo
// usuario, para que quede en el historial (decision del usuario). Un activo
// devaluado sigue devaluado (DEVALUATED -> DEVALUATED conserva el valor 0).
export async function reassignAsset(input: ReassignAssetInput): Promise<AssetMovementModel> {
  if (input.userId === undefined && input.costCenterId === undefined) {
    throw new BadRequestError("Indique un nuevo usuario, un nuevo centro de costo o ambos");
  }
  if (input.userId !== undefined) {
    const user = await getUserByIdOrThrow(input.userId);
    if (!user.isActive) throw new ConflictError("El usuario destino esta inactivo, no se le puede asignar el activo");
  }
  if (input.costCenterId !== undefined) await getCostCenterByIdOrThrow(input.costCenterId);

  return postgres.transaction(async (transaction) => {
    await lockAssetRow(input.assetId, transaction);
    const asset = await getAssetByIdOrThrow(input.assetId, transaction);
    const statusCode = asset.status?.code ?? "";
    if (!HELD_STATUS_CODES.includes(statusCode)) {
      throw new ConflictError(
        `El activo ${asset.tag} no esta asignado, no se puede reasignar (estado actual: ${statusCode || "desconocido"})`,
      );
    }

    const currentHolder = (await listCurrentHoldersByAssetIds([asset.id], transaction)).get(asset.id) ?? null;
    const targetUserId = input.userId ?? currentHolder;
    if (targetUserId === null) {
      throw new ConflictError(`El activo ${asset.tag} no tiene un usuario vigente: indique a quien se reasigna`);
    }
    const userChanged = targetUserId !== currentHolder;
    const costCenterChanged = input.costCenterId !== undefined && input.costCenterId !== asset.costCenterId;
    if (!userChanged && !costCenterChanged) {
      throw new BadRequestError(`El activo ${asset.tag} ya esta asignado a ese usuario y centro de costo`);
    }

    const changes: string[] = [];
    if (userChanged) {
      const directory = await getUserDirectory([currentHolder, targetUserId].filter((id): id is number => id !== null));
      const from = currentHolder !== null ? (directory.get(currentHolder)?.fullName ?? `usuario ${currentHolder}`) : "sin usuario";
      changes.push(`usuario ${from} -> ${directory.get(targetUserId)?.fullName ?? `usuario ${targetUserId}`}`);
    }
    if (costCenterChanged && input.costCenterId !== undefined) {
      const costCenters = await loadCostCenters(
        [asset.costCenterId, input.costCenterId].filter((id): id is number => id !== null),
        transaction,
      );
      changes.push(
        `centro de costo ${describeCostCenter(asset.costCenterId !== null ? costCenters.get(asset.costCenterId) : null)} -> ` +
          describeCostCenter(costCenters.get(input.costCenterId)),
      );
      await updateAssetLocation(
        asset.id,
        { costCenterId: input.costCenterId, updatedBy: input.createdBy ?? undefined },
        transaction,
      );
    }
    const notes = [`Reasignacion: ${changes.join("; ")}`, input.notes?.trim()].filter(Boolean).join(". ");

    return createAssetMovement(
      {
        assetId: asset.id,
        movementType: statusCode === "DEVALUATED" ? "DEVALUATED" : "REASSIGNED",
        userIds: [targetUserId],
        notes: notes.slice(0, NOTES_MAX_LENGTH),
        supervisorName: input.supervisorName,
        macAddress: input.macAddress,
        storageCapacity: input.storageCapacity,
        ramCapacity: input.ramCapacity,
        hasBag: input.hasBag,
        hasLock: input.hasLock,
        hasCharger: input.hasCharger,
        createdBy: input.createdBy,
      },
      transaction,
    );
  });
}

// Asignacion vigente: precarga Reasignar y da el movimiento cuya acta se
// reimprime. 404 si el activo no esta en manos de nadie.
export async function getCurrentAssignment(assetId: number): Promise<CurrentAssignment> {
  const asset = await getAssetByIdOrThrow(assetId);
  const statusCode = asset.status?.code ?? "";
  const holderUserId = HELD_STATUS_CODES.includes(statusCode)
    ? ((await listCurrentHoldersByAssetIds([asset.id])).get(asset.id) ?? null)
    : null;
  const [handoverRow] = await postgres.query<{ id: number }>(
    `SELECT id FROM asset_movements WHERE asset_id = :assetId AND movement_type IN (:types)
      ORDER BY movement_date DESC, id DESC LIMIT 1`,
    { replacements: { assetId: asset.id, types: HANDOVER_MOVEMENT_TYPES }, type: QueryTypes.SELECT },
  );
  const movement = handoverRow ? await AssetMovementModel.findByPk(handoverRow.id) : null;
  if (holderUserId === null || !movement) {
    throw new NotFoundError(`El activo ${asset.tag} no tiene una asignacion vigente`);
  }

  const [directory, costCenters] = await Promise.all([
    getUserDirectory([holderUserId]),
    loadCostCenters(asset.costCenterId !== null ? [asset.costCenterId] : []),
  ]);
  return {
    assetId: asset.id,
    tag: asset.tag,
    serialNumber: asset.serialNumber,
    statusCode,
    statusName: asset.status?.name ?? statusCode,
    movementId: movement.id,
    movementType: movement.movementType,
    movementDate: movement.movementDate,
    holder: { userId: holderUserId, fullName: directory.get(holderUserId)?.fullName ?? `Usuario ${holderUserId}` },
    costCenter: asset.costCenterId !== null ? (costCenters.get(asset.costCenterId) ?? null) : null,
    handover: {
      supervisorName: movement.supervisorName,
      macAddress: movement.macAddress,
      storageCapacity: movement.storageCapacity,
      ramCapacity: movement.ramCapacity,
      hasBag: movement.hasBag,
      hasLock: movement.hasLock,
      hasCharger: movement.hasCharger,
    },
  };
}

interface AssignmentSqlRow {
  asset_id: number;
  tag: string;
  serial_number: string | null;
  product_id: string | null;
  cost_center_id: number | null;
  status_code: string;
  status_name: string;
  holder_user_id: number | null;
  movement_id: number | null;
  movement_date: Date | null;
}

// Activos en uso con su tenedor vigente (ultimo movimiento, mismo criterio que
// listCurrentHoldersByAssetIds) y el movimiento de su acta. Los filtros de
// categoria y usuario se resuelven primero en Mongo y MSSQL (a ids) y se
// aplican aca; sin coincidencias alli, el resultado es vacio sin consultar.
export async function listAssignments(
  params: PaginationParams,
  filters: AssignmentFilters,
): Promise<{ items: AssignmentRow[]; total: number }> {
  const conditions = ["s.code IN (:heldStatuses)"];
  const replacements: Record<string, unknown> = { heldStatuses: HELD_STATUS_CODES, handoverTypes: HANDOVER_MOVEMENT_TYPES };

  if (filters.costCenterId !== undefined) {
    conditions.push("a.cost_center_id = :costCenterId");
    replacements.costCenterId = filters.costCenterId;
  }
  const serial = filters.serial?.trim();
  if (serial) {
    conditions.push("(a.tag ILIKE :serial OR a.serial_number ILIKE :serial)");
    replacements.serial = `%${escapeLikePattern(serial)}%`;
  }
  if (filters.categoryId) {
    const productIds = await listProductIdsByCategory(filters.categoryId);
    if (productIds.length === 0) return { items: [], total: 0 };
    conditions.push("a.product_id IN (:productIds)");
    replacements.productIds = productIds;
  }
  const user = filters.user?.trim();
  if (user) {
    const userIds = await findUserIdsBySearch(user);
    if (userIds.length === 0) return { items: [], total: 0 };
    conditions.push("cur.user_id IN (:userIds)");
    replacements.userIds = userIds;
  }

  const from = `
    FROM assets a
    JOIN asset_statuses s ON s.id = a.status_id
    LEFT JOIN LATERAL (
      SELECT mu.user_id FROM asset_movements m
        LEFT JOIN asset_movement_users mu ON mu.asset_movement_id = m.id
       WHERE m.asset_id = a.id
       ORDER BY m.movement_date DESC, m.id DESC, mu.id ASC
       LIMIT 1
    ) cur ON true
    LEFT JOIN LATERAL (
      SELECT m.id, m.movement_date FROM asset_movements m
       WHERE m.asset_id = a.id AND m.movement_type IN (:handoverTypes)
       ORDER BY m.movement_date DESC, m.id DESC
       LIMIT 1
    ) ho ON true
    WHERE ${conditions.join(" AND ")}`;

  const [countRows, rows] = await Promise.all([
    postgres.query<{ total: string }>(`SELECT COUNT(*) AS total ${from}`, { replacements, type: QueryTypes.SELECT }),
    postgres.query<AssignmentSqlRow>(
      `SELECT a.id AS asset_id, a.tag, a.serial_number, a.product_id, a.cost_center_id,
              s.code AS status_code, s.name AS status_name, cur.user_id AS holder_user_id,
              ho.id AS movement_id, ho.movement_date
       ${from}
       ORDER BY a.tag ASC
       LIMIT :limit OFFSET :offset`,
      { replacements: { ...replacements, limit: params.limit, offset: getOffset(params) }, type: QueryTypes.SELECT },
    ),
  ]);

  const productIds = rows.map((row) => row.product_id).filter((id): id is string => id !== null);
  const [directory, costCenters, products] = await Promise.all([
    getUserDirectory(rows.map((row) => row.holder_user_id).filter((id): id is number => id !== null)),
    loadCostCenters(rows.map((row) => row.cost_center_id).filter((id): id is number => id !== null)),
    getProductsByIds(productIds),
  ]);
  const productById = new Map(products.map((product) => [String(product._id), product]));
  const categories = await getProductCategoriesByIds(
    products.map((product) => (product.categoryId ? String(product.categoryId) : "")).filter(Boolean),
  );
  const categoryNameById = new Map(categories.map((category) => [String(category._id), category.name]));

  const items = rows.map((row): AssignmentRow => {
    const product = row.product_id ? productById.get(row.product_id) : undefined;
    return {
      assetId: row.asset_id,
      tag: row.tag,
      serialNumber: row.serial_number,
      statusCode: row.status_code,
      statusName: row.status_name,
      productName: product?.name ?? null,
      categoryName: product?.categoryId ? (categoryNameById.get(String(product.categoryId)) ?? null) : null,
      holder:
        row.holder_user_id !== null
          ? {
              userId: row.holder_user_id,
              fullName: directory.get(row.holder_user_id)?.fullName ?? `Usuario ${row.holder_user_id}`,
            }
          : null,
      costCenter: row.cost_center_id !== null ? (costCenters.get(row.cost_center_id) ?? null) : null,
      movementId: row.movement_id,
      assignedAt: row.movement_date,
    };
  });
  return { items, total: Number(countRows[0]?.total ?? 0) };
}
