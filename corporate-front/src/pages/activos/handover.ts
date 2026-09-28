import { assetMovementService } from "../../services";
import type { AssetHandoverFields, AssetRamCapacity, AssetStorageCapacity, CurrentAssignment } from "../../types/assetMovement";

// Datos del acta de entrega que se tipean al asignar o reasignar (Asignar y
// Reasignar Activos, plan 011). Aca y no en HandoverFields.tsx: un archivo de
// componente solo debe exportar componentes (react-refresh).
export interface HandoverForm {
  supervisorName: string;
  macAddress: string;
  storageCapacity: AssetStorageCapacity | "";
  ramCapacity: AssetRamCapacity | "";
  hasBag: boolean;
  hasLock: boolean;
  hasCharger: boolean;
}

export const STORAGE_OPTIONS: AssetStorageCapacity[] = ["512 GB", "1 TB"];
export const RAM_OPTIONS: AssetRamCapacity[] = ["8 GB", "16 GB", "32 GB"];

export const EMPTY_HANDOVER: HandoverForm = {
  supervisorName: "",
  macAddress: "",
  storageCapacity: "",
  ramCapacity: "",
  hasBag: false,
  hasLock: false,
  hasCharger: false,
};

// Formatea en vivo mientras se tipea: deja solo hex, agrupa de a 2 con ":".
export function formatMacAddress(value: string): string {
  const hex = value.replace(/[^0-9a-fA-F]/g, "").toUpperCase().slice(0, 12);
  return hex.match(/.{1,2}/g)?.join(":") ?? hex;
}

export function toHandoverPayload(form: HandoverForm): AssetHandoverFields {
  return {
    supervisorName: form.supervisorName.trim() || undefined,
    macAddress: form.macAddress.trim() || undefined,
    storageCapacity: form.storageCapacity || undefined,
    ramCapacity: form.ramCapacity || undefined,
    hasBag: form.hasBag,
    hasLock: form.hasLock,
    hasCharger: form.hasCharger,
  };
}

// Precarga Reasignar con los datos del acta vigente.
export function handoverFromCurrent(current: CurrentAssignment): HandoverForm {
  const { handover } = current;
  return {
    supervisorName: handover.supervisorName ?? "",
    macAddress: handover.macAddress ?? "",
    storageCapacity: STORAGE_OPTIONS.includes(handover.storageCapacity as AssetStorageCapacity)
      ? (handover.storageCapacity as AssetStorageCapacity)
      : "",
    ramCapacity: RAM_OPTIONS.includes(handover.ramCapacity as AssetRamCapacity) ? (handover.ramCapacity as AssetRamCapacity) : "",
    hasBag: handover.hasBag ?? false,
    hasLock: handover.hasLock ?? false,
    hasCharger: handover.hasCharger ?? false,
  };
}

// Descarga el acta de un movimiento como archivo (blob que se baja solo).
export async function downloadHandover(movementId: number, tag: string): Promise<void> {
  const blob = await assetMovementService.downloadHandover(movementId);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `acta-${tag}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}
