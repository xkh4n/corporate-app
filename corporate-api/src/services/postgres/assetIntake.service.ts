import { QueryTypes, Transaction } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { setAssetStatus } from "./asset.service";
import { createAssetMovement } from "./assetMovement.service";
import { getAssetStatusByCodeOrThrow } from "./assetStatus.service";
import type { InventoryLineStatusCode } from "../../models/postgres/inventoryCountLine.model";

// Reglas compartidas por las dos vias que dan de alta un activo que ya existe fisicamente pero no en el sistema:
// la toma de inventario (inventoryCount.service.ts) y la carga masiva por CSV (assetImport.service.ts).

// assets no tiene UNIQUE sobre la serie: sin este lock, dos altas simultaneas de la misma serie pasan ambas el
// chequeo findAssetsBySerial y crean dos activos. El lock se libera solo al terminar la transaccion. La clave se
// normaliza en SQL (lower + btrim, igual que la comparacion de la busqueda por serie) y se hashea a 64 bits: evita
// que JS y Postgres discrepen en como pasan a minusculas.
export async function lockAssetSerial(serialNumber: string, transaction: Transaction): Promise<void> {
  await postgres.query(`SELECT pg_advisory_xact_lock(hashtextextended('asset-serial:' || lower(btrim(:serial)), 0))`, {
    replacements: { serial: serialNumber },
    type: QueryTypes.SELECT,
    transaction,
  });
}

// El activo nace AVAILABLE (createAssetFromInventory); aqui se lleva al estado real declarado. ASSIGNED/SUPPORT/
// DECOMMISSIONED pasan por un movimiento real (deja historial y, en ASSIGNED, el tenedor vigente); DAMAGED no tiene
// tipo de movimiento propio, se fija directo.
export async function applyDeclaredStatusToNewAsset(
  assetId: number,
  statusCode: InventoryLineStatusCode,
  holderUserId: number | null,
  notes: string,
  createdBy: number,
  transaction: Transaction,
): Promise<void> {
  if (statusCode === "AVAILABLE") return;
  if (statusCode === "DAMAGED") {
    const damaged = await getAssetStatusByCodeOrThrow("DAMAGED", transaction);
    await setAssetStatus(assetId, damaged.id, transaction, createdBy);
    return;
  }
  await createAssetMovement(
    {
      assetId,
      movementType: statusCode,
      userIds: statusCode === "ASSIGNED" && holderUserId !== null ? [holderUserId] : [],
      notes,
      createdBy,
    },
    transaction,
  );
}
