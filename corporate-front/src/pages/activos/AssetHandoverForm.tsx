import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Field, Button, Input, EmptyState } from "../../components/ui";
import { showErrorToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { assetMovementService } from "../../services";
import type { AssignmentRow } from "../../types/assetMovement";
import { Pager } from "../contabilidad/Pager";
import { AssignmentsTable } from "./AssignmentsTable";
import { downloadHandover } from "./handover";

// Formulario Asignacion (plan 011): reimprime el acta de entrega de la
// asignacion vigente de un activo (el mismo PDF que genera Asignar Activos).
const REQUIRED_PERMISSIONS = ["assets:read", "asset-movements:read"] as const;
const PAGE_SIZE = 20;

export default function AssetHandoverForm() {
  const navigate = useNavigate();

  const [serial, setSerial] = useState("");
  const [user, setUser] = useState("");
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  async function search(nextPage: number): Promise<void> {
    if (!serial.trim() && !user.trim()) {
      showErrorToast("Ingresa un tag, un número de serie o un usuario para buscar");
      return;
    }
    setSearching(true);
    try {
      const res = await assetMovementService.listAssignments({
        serial: serial.trim() || undefined,
        user: user.trim() || undefined,
        page: nextPage,
        limit: PAGE_SIZE,
      });
      setRows(res.items);
      setPage(nextPage);
      setTotalPages(res.pagination.totalPages);
      setTotalItems(res.pagination.totalItems);
      setSearched(true);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSearching(false);
    }
  }

  async function handleDownload(row: AssignmentRow): Promise<void> {
    if (row.movementId === null) return;
    setDownloadingId(row.assetId);
    try {
      await downloadHandover(row.movementId, row.tag);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setDownloadingId(null);
    }
  }

  const pager = (
    <Pager page={page} totalPages={totalPages} totalItems={totalItems} noun="activos" onChange={(next) => void search(next)} />
  );

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Formulario Asignación</h1>

        <form
          className="mb-4 rounded-lg border border-slate-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void search(1);
          }}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Tag o N° de serie" htmlFor="handoverSerial">
              <Input
                id="handoverSerial"
                value={serial}
                maxLength={100}
                placeholder="Ej: ARR000000001"
                onChange={(e) => setSerial(e.target.value)}
                className="bg-zinc-100 focus:bg-indigo-100"
              />
            </Field>
            <Field label="Usuario (nombre o RUT completo)" htmlFor="handoverUser">
              <Input
                id="handoverUser"
                value={user}
                maxLength={100}
                onChange={(e) => setUser(e.target.value)}
                className="bg-zinc-100 focus:bg-indigo-100"
              />
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="submit" className="w-full sm:w-auto" loading={searching}>
              Buscar
            </Button>
          </div>
        </form>

        {!searched ? (
          <EmptyState
            title="Busca un activo asignado"
            description="Ingresa el tag, el número de serie o el usuario para volver a descargar el acta de entrega."
          />
        ) : rows.length === 0 ? (
          <EmptyState title="Sin resultados" description="No hay activos asignados que coincidan con la búsqueda." />
        ) : (
          <div className="flex flex-col gap-3">
            {pager}
            <AssignmentsTable
              rows={rows}
              action={(row) =>
                row.movementId !== null ? (
                  <Button
                    type="button"
                    variant="secondary"
                    loading={downloadingId === row.assetId}
                    onClick={() => void handleDownload(row)}
                  >
                    Descargar acta
                  </Button>
                ) : (
                  <span className="text-xs text-slate-500">Sin acta</span>
                )
              }
            />
            {pager}
          </div>
        )}
      </div>
    </RequirePermissions>
  );
}
