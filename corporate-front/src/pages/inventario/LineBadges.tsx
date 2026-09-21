import type { InventoryReportLine } from "../../types/inventoryCount";
import { CHANGE_LABELS, SUPPORT_FOLLOW_UP_TEXT, changeDetail } from "./inventoryLabels";

// Marca de cada equipo levantado: "Alta nueva" (el activo lo creó la toma),
// "Vinculado" (ya existía en el sistema) con lo que la toma le cambió (antes →
// después) y, si estaba en devolución, la instrucción de enviarlo a Soporte TI
// o Adquisiciones TI.
export function LineBadges({ line }: { line: InventoryReportLine }) {
  return (
    <div className="flex flex-wrap gap-1">
      {line.assetCreated ? (
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">Alta nueva</span>
      ) : (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">Vinculado</span>
      )}
      {line.changes.map((change) => (
        <span
          key={change}
          title={changeDetail(line, change)}
          className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
        >
          {CHANGE_LABELS[change]}: {changeDetail(line, change)}
        </span>
      ))}
      {line.supportFollowUp && (
        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800">
          {SUPPORT_FOLLOW_UP_TEXT}
        </span>
      )}
    </div>
  );
}
