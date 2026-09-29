import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { showErrorToast, showSuccessToast } from "../../components/Toast";
import { Button, EmptyState, Field, Input, Select } from "../../components/ui";
import { handleError } from "../../lib/Errors";
import { commRoomService } from "../../services/commRoomService";
import { ROOM_ACCESS_TYPE_LABELS, type CommRoom, type RoomEntry } from "../../types/commRoom";
import { formatDateTime } from "../inventario/inventoryLabels";
import { PAGE_CLASS, TABLE_WRAP, TD, TH, TITLE_CLASS } from "./commRoomUi";

// Registrar Ingreso (plan 016): quien custodia la sala anota la entrada y la salida de cada persona.
// Solo entra quien tiene un acceso vigente, aprobado por ticket. El RUT se busca exacto.
const REQUIRED_PERMISSIONS = ["comm-rooms:read", "comm-room-entries:read", "comm-room-entries:create"] as const;

export default function RegisterRoomEntry() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<CommRoom[]>([]);
  const [roomId, setRoomId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [notes, setNotes] = useState("");
  const [inside, setInside] = useState<RoomEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState<number | null>(null);

  useEffect(() => {
    commRoomService
      .list({ limit: 200, isActive: true, sortBy: "costCenter", sortOrder: "asc" })
      .then((res) => setRooms(res.items))
      .catch((error) => handleError(error, navigate));
  }, [navigate]);

  const loadInside = useCallback(async () => {
    if (!roomId) {
      setInside([]);
      return;
    }
    try {
      setInside((await commRoomService.listEntries({ roomId: Number(roomId), open: true, limit: 200 })).items);
    } catch (error) {
      handleError(error, navigate);
    }
  }, [navigate, roomId]);

  useEffect(() => {
    void loadInside();
  }, [loadInside]);

  async function registerEntry(): Promise<void> {
    if (!roomId || !documentId.trim()) {
      showErrorToast("Elija la sala e ingrese el RUT completo de la persona");
      return;
    }
    setSaving(true);
    try {
      const entry = await commRoomService.checkIn({ roomId: Number(roomId), documentId: documentId.trim(), notes: notes.trim() || undefined });
      showSuccessToast(`Ingreso registrado: ${entry.beneficiaryName} (${ROOM_ACCESS_TYPE_LABELS[entry.accessType]}, ticket ${entry.ticketNumber})`);
      setDocumentId("");
      setNotes("");
      await loadInside();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  async function registerExit(entry: RoomEntry): Promise<void> {
    setClosing(entry.id);
    try {
      await commRoomService.checkOut(entry.id);
      showSuccessToast(`Salida registrada: ${entry.beneficiaryName}`);
      await loadInside();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setClosing(null);
    }
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className={PAGE_CLASS}>
        <h1 className={TITLE_CLASS}>Registrar Ingreso</h1>
        <div className="w-full max-w-5xl mx-auto flex flex-col gap-4 px-2 sm:px-4">
          <form
            className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4 md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void registerEntry();
            }}
          >
            <Field label="Sala" htmlFor="entryRoom">
              <Select id="entryRoom" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">Seleccione la sala</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.costCenterName} — {room.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="RUT de la persona (completo)" htmlFor="entryRut">
              <Input id="entryRut" value={documentId} autoComplete="off" placeholder="12345678-9" maxLength={20} onChange={(e) => setDocumentId(e.target.value)} />
            </Field>
            <Field label="Observación (opcional)" htmlFor="entryNotes">
              <Input id="entryNotes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Button type="submit" loading={saving} disabled={!roomId || !documentId.trim()}>
              Registrar ingreso
            </Button>
          </form>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-lg font-semibold text-slate-700">Personas dentro de la sala</h2>
            {!roomId ? (
              <EmptyState title="Elija una sala" description="Verá quién está adentro ahora y podrá registrar su salida." />
            ) : inside.length === 0 ? (
              <EmptyState title="No hay nadie dentro de la sala" description="Los ingresos registrados aparecen aquí hasta que se registre la salida." />
            ) : (
              <div className={TABLE_WRAP}>
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className={TH}>Persona</th>
                      <th className={TH}>Acceso</th>
                      <th className={TH}>Ingresó</th>
                      <th className={TH}>Registró</th>
                      <th className={TH}>Observación</th>
                      <th className={TH}></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inside.map((entry) => (
                      <tr key={entry.id}>
                        <td className={TD}>
                          <p className="font-medium text-slate-900">{entry.beneficiaryName}</p>
                          <p className="text-xs text-slate-500">
                            {entry.beneficiaryDocumentId}
                            {entry.beneficiaryCompany ? ` · ${entry.beneficiaryCompany}` : ""}
                          </p>
                        </td>
                        <td className={TD}>
                          {ROOM_ACCESS_TYPE_LABELS[entry.accessType]} · {entry.ticketNumber}
                          {entry.grantStatus !== "ACTIVE" && <span className="ml-1 text-xs text-rose-700">(ya no vigente)</span>}
                        </td>
                        <td className={TD}>{formatDateTime(entry.checkedInAt)}</td>
                        <td className={TD}>{entry.checkedInByName ?? "-"}</td>
                        <td className={TD}>{entry.notes ?? "-"}</td>
                        <td className={TD}>
                          <Button type="button" variant="secondary" loading={closing === entry.id} onClick={() => void registerExit(entry)}>
                            Registrar salida
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </RequirePermissions>
  );
}
