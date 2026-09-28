import { Field, Input, Select } from "../../components/ui";
import type { AssetRamCapacity, AssetStorageCapacity } from "../../types/assetMovement";
import { RAM_OPTIONS, STORAGE_OPTIONS, formatMacAddress, type HandoverForm } from "./handover";

// Datos de entrega del acta (jefatura, MAC, almacenamiento, RAM, bolso,
// candado y cargador), compartidos por Asignar y Reasignar Activos.
export function HandoverFields({ value, onChange }: { value: HandoverForm; onChange: (patch: Partial<HandoverForm>) => void }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 min-[800px]:grid-cols-2">
        <Field label="Jefe directo (opcional)" htmlFor="supervisorName">
          <Input
            id="supervisorName"
            value={value.supervisorName}
            maxLength={150}
            onChange={(e) => onChange({ supervisorName: e.target.value })}
            className="bg-zinc-100 focus:bg-indigo-100"
          />
        </Field>
        <Field label="MAC del equipo (opcional)" htmlFor="macAddress">
          <Input
            id="macAddress"
            value={value.macAddress}
            placeholder="AA:BB:CC:DD:EE:FF"
            onChange={(e) => onChange({ macAddress: formatMacAddress(e.target.value) })}
            className="bg-zinc-100 focus:bg-indigo-100"
          />
        </Field>
        <Field label="Almacenamiento (opcional)" htmlFor="storageCapacity">
          <Select
            id="storageCapacity"
            value={value.storageCapacity}
            onChange={(e) => onChange({ storageCapacity: e.target.value as AssetStorageCapacity | "" })}
          >
            <option value="">Seleccione almacenamiento</option>
            {STORAGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Memoria RAM (opcional)" htmlFor="ramCapacity">
          <Select
            id="ramCapacity"
            value={value.ramCapacity}
            onChange={(e) => onChange({ ramCapacity: e.target.value as AssetRamCapacity | "" })}
          >
            <option value="">Seleccione memoria</option>
            {RAM_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap gap-6">
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={value.hasBag} onChange={(e) => onChange({ hasBag: e.target.checked })} />
          ¿Incluye bolso?
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={value.hasLock} onChange={(e) => onChange({ hasLock: e.target.checked })} />
          ¿Incluye candado?
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={value.hasCharger} onChange={(e) => onChange({ hasCharger: e.target.checked })} />
          ¿Incluye cargador?
        </label>
      </div>
    </>
  );
}
