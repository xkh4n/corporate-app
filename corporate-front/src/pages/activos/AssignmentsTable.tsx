import type { ReactNode } from "react";
import type { AssignmentRow } from "../../types/assetMovement";

// Tabla de activos en uso (Visualizar Asignaciones y Formulario Asignacion,
// plan 011). action agrega una columna por fila (p. ej. "Descargar acta").
export function AssignmentsTable({ rows, action }: { rows: AssignmentRow[]; action?: (row: AssignmentRow) => ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {["Tag", "Producto", "Categoría", "N° de serie", "Usuario", "Centro de costo", "Estado", "Asignado"].map((title) => (
              <th key={title} className="px-3 py-2 text-left font-semibold text-slate-600">
                {title}
              </th>
            ))}
            {action && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.assetId}>
              <td className="px-3 py-2 font-medium text-slate-900">{row.tag}</td>
              <td className="px-3 py-2 text-slate-700">{row.productName ?? "-"}</td>
              <td className="px-3 py-2 text-slate-600">{row.categoryName ?? "-"}</td>
              <td className="px-3 py-2 text-slate-600">{row.serialNumber ?? "-"}</td>
              <td className="px-3 py-2 text-slate-700">{row.holder?.fullName ?? "-"}</td>
              <td className="px-3 py-2 text-slate-600">
                {row.costCenter ? `${row.costCenter.code} · ${row.costCenter.name}` : "-"}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    row.statusCode === "DEVALUATED" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {row.statusName}
                </span>
              </td>
              <td className="px-3 py-2 text-slate-600">
                {row.assignedAt ? new Date(row.assignedAt).toLocaleDateString("es-CL") : "-"}
              </td>
              {action && <td className="px-3 py-2 text-right">{action(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
