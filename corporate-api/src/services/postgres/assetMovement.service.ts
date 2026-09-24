import { QueryTypes, Transaction } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetModel } from "../../models/postgres/asset.model";
import { AssetMovementModel } from "../../models/postgres/assetMovement.model";
import { AssetMovementUserModel } from "../../models/postgres/assetMovementUser.model";
import { getAssetByIdOrThrow, lockAssetRow, setAssetStatus } from "./asset.service";
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
