import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { showErrorToast, showSuccessToast } from "../../components/Toast";
import { Alert, Button, EmptyState, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { handleError } from "../../lib/Errors";
import { costCenterService } from "../../services";
import { commRoomService } from "../../services/commRoomService";
import type { CostCenter } from "../../types/costCenter";
import { ROOM_ACCESS_TYPE_LABELS, type CommRoom, type RoomAccessGrant } from "../../types/commRoom";
import { FILTER_BAR, formatPeriod, grantStatusClass, grantStatusLabel, PAGE_CLASS, TABLE_WRAP, TD, TH, TITLE_CLASS } from "./commRoomUi";

// Administrar Salas (plan 016): editar y desactivar salas, ver quien tiene acceso hoy y revocarlo, y
// fijar desde cuantos dias un acceso temporal se considera prolongado.
const REQUIRED_PERMISSIONS = [
  "comm-rooms:read",
  "comm-rooms:update",
  "comm-room-accesses:read",
  "comm-room-accesses:delete",
  "cost-centers:read",
] as const;

export default function CommRoomAdmin() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<CommRoom[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [filterCostCenter, setFilterCostCenter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CommRoom | null>(null);
  const [selected, setSelected] = useState<CommRoom | null>(null);
  const [maxDays, setMaxDays] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await commRoomService.list({
        limit: 200,
        sortBy: "costCenter",
        sortOrder: "asc",
        search: search.trim() || undefined,
        costCenterId: filterCostCenter ? Number(filterCostCenter) : undefined,
      });
      setRooms(res.items);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setLoading(false);
    }
  }, [filterCostCenter, navigate, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    costCenterService
      .list({ limit: 1000, sortBy: "code" })
      .then((res) => setCostCenters(res.items))
      .catch((error) => handleError(error, navigate));
    commRoomService
      .getSettings()
      .then((settings) => setMaxDays(String(settings.temporaryMaxActiveDays)))
      .catch((error) => handleError(error, navigate));
  }, [navigate]);

  async function saveSettings(): Promise<void> {
    const days = Number(maxDays);
    if (!Number.isInteger(days) || days < 1) {
      showErrorToast("Indique un número de días mayor a 0");
      return;
    }
    try {
      await commRoomService.updateSettings({ temporaryMaxActiveDays: days });
      showSuccessToast("Configuración guardada");
    } catch (error) {
      handleError(error, navigate);
    }
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className={PAGE_CLASS}>
        <h1 className={TITLE_CLASS}>Administrar Salas</h1>
        <div className="w-full max-w-6xl mx-auto flex flex-col gap-4 sm:px-4">
          <div className={FILTER_BAR}>
            <Field label="Buscar" htmlFor="roomSearch">
              <Input id="roomSearch" value={search} placeholder="Sala, dependencia o dirección" onChange={(e) => setSearch(e.target.value)} />
            </Field>
            <Field label="Dependencia" htmlFor="roomFilterCc">
              <Select id="roomFilterCc" value={filterCostCenter} onChange={(e) => setFilterCostCenter(e.target.value)}>
                <option value="">Todas</option>
                {costCenters.map((costCenter) => (
                  <option key={costCenter.id} value={costCenter.id}>
                    {costCenter.code} - {costCenter.name}
                  </option>
                ))}
              </Select>
            </Field>
            {/* Ajuste global separado de los filtros: en movil ocupa su propia fila */}
            <div className="flex items-end gap-2 border-t border-slate-200 pt-3 sm:ml-auto sm:border-0 sm:pt-0">
              <div className="min-w-0 flex-1 sm:flex-none">
                <Field label="Temporal prolongado desde (días)" htmlFor="maxDays">
                  <Input id="maxDays" type="number" min={1} value={maxDays} onChange={(e) => setMaxDays(e.target.value)} className="sm:w-28" />
                </Field>
              </div>
              <Button type="button" variant="secondary" className="shrink-0" onClick={() => void saveSettings()}>
                Guardar
              </Button>
            </div>
          </div>

          {loading ? null : rooms.length === 0 ? (
            <EmptyState title="No hay salas" description="Cree una sala en Crear Sala." />
          ) : (
            <div className={TABLE_WRAP}>
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={TH}>Sala</th>
                    <th className={TH}>Dependencia</th>
                    <th className={TH}>Dirección</th>
                    <th className={TH}>Accesos activos</th>
                    <th className={TH}>Estado</th>
                    <th className={TH}></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rooms.map((room) => (
                    <tr key={room.id} className={selected?.id === room.id ? "bg-indigo-50" : undefined}>
                      <td className={`${TD} min-w-[8rem] font-medium text-slate-900`}>{room.name}</td>
                      <td className={`${TD} min-w-[10rem]`}>
                        {room.costCenterCode} - {room.costCenterName}
                      </td>
                      <td className={`${TD} min-w-[10rem]`}>{room.address}</td>
                      <td className={TD}>{room.activeGrants}</td>
                      <td className={TD}>{room.isActive ? "Activa" : "Desactivada"}</td>
                      <td className={`${TD} whitespace-nowrap`}>
                        <div className="flex gap-2">
                          <Button type="button" variant="secondary" onClick={() => setSelected(room)}>
                            Accesos
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => setEditing(room)}>
                            Editar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selected && <RoomAccessesPanel room={selected} onChanged={() => void load()} onClose={() => setSelected(null)} />}
        </div>

        {editing && (
          <EditRoomModal
            room={editing}
            costCenters={costCenters}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void load();
            }}
          />
        )}
      </div>
    </RequirePermissions>
  );
}

function EditRoomModal({
  room,
  costCenters,
  onClose,
  onSaved,
}: {
  room: CommRoom;
  costCenters: CostCenter[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(room.name);
  const [costCenterId, setCostCenterId] = useState(String(room.costCenterId));
  const [address, setAddress] = useState(room.address);
  const [isActive, setIsActive] = useState(room.isActive);
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    if (!name.trim() || !address.trim() || !costCenterId) {
      showErrorToast("Complete el nombre, la dependencia y la dirección");
      return;
    }
    setSaving(true);
    try {
      await commRoomService.update(room.id, { name: name.trim(), costCenterId: Number(costCenterId), address: address.trim(), isActive });
      showSuccessToast("Sala actualizada");
      onSaved();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={`Editar ${room.name}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" loading={saving} onClick={() => void save()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3">
        <Field label="Nombre" htmlFor="editRoomName">
          <Input id="editRoomName" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Dependencia" htmlFor="editRoomCc">
          <Select id="editRoomCc" value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
            {costCenters.map((costCenter) => (
              <option key={costCenter.id} value={costCenter.id}>
                {costCenter.code} - {costCenter.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Dirección" htmlFor="editRoomAddress">
          <Input id="editRoomAddress" value={address} maxLength={255} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Sala activa
        </label>
        {room.isActive && !isActive && room.activeGrants > 0 && (
          <Alert tone="warning">La sala tiene {room.activeGrants} acceso(s) activo(s): revóquelos antes de desactivarla.</Alert>
        )}
      </div>
    </Modal>
  );
}

function RoomAccessesPanel({ room, onChanged, onClose }: { room: CommRoom; onChanged: () => void; onClose: () => void }) {
  const navigate = useNavigate();
  const [grants, setGrants] = useState<RoomAccessGrant[]>([]);
  const [revoking, setRevoking] = useState<RoomAccessGrant | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await commRoomService.listAccesses({ roomId: room.id, status: "ACTIVE", limit: 200, sortBy: "validFrom", sortOrder: "desc" });
      setGrants(res.items);
    } catch (error) {
      handleError(error, navigate);
    }
  }, [navigate, room.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(): Promise<void> {
    if (!revoking || !reason.trim()) return;
    setSaving(true);
    try {
      await commRoomService.revokeAccess(revoking.id, reason.trim());
      showSuccessToast(`Acceso de ${revoking.beneficiaryName} revocado`);
      setRevoking(null);
      setReason("");
      await load();
      onChanged();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="min-w-0 break-words text-base font-semibold text-slate-700 sm:text-lg">
          Accesos activos — {room.name} ({room.costCenterName})
        </h2>
        <Button type="button" variant="ghost" className="shrink-0" onClick={onClose}>
          Cerrar
        </Button>
      </div>
      {grants.length === 0 ? (
        <EmptyState title="Nadie tiene acceso activo a esta sala" description="Los accesos se piden por ticket en Generar Ticket." />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Beneficiario</th>
                <th className={TH}>Tipo</th>
                <th className={TH}>Período</th>
                <th className={TH}>Motivo</th>
                <th className={TH}>Autorizó</th>
                <th className={TH}>Ticket</th>
                <th className={TH}>Estado</th>
                <th className={TH}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {grants.map((grant) => (
                <tr key={grant.id}>
                  <td className={`${TD} min-w-[10rem]`}>
                    <p className="font-medium text-slate-900">{grant.beneficiaryName}</p>
                    <p className="text-xs text-slate-500">
                      {grant.beneficiaryDocumentId}
                      {grant.beneficiaryCompany ? ` · ${grant.beneficiaryCompany}` : ""}
                    </p>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{ROOM_ACCESS_TYPE_LABELS[grant.accessType]}</td>
                  <td className={`${TD} whitespace-nowrap`}>{formatPeriod(grant.validFrom, grant.validUntil)}</td>
                  <td className={`${TD} min-w-[12rem] max-w-xs`}>{grant.reason}</td>
                  <td className={TD}>{grant.approvedByName ?? "-"}</td>
                  <td className={`${TD} whitespace-nowrap`}>{grant.ticketNumber}</td>
                  <td className={TD}>
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${grantStatusClass(grant)}`}>{grantStatusLabel(grant)}</span>
                  </td>
                  <td className={TD}>
                    <Button type="button" variant="secondary" onClick={() => setRevoking(grant)}>
                      Revocar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={revoking !== null}
        title={revoking ? `Revocar el acceso de ${revoking.beneficiaryName}` : ""}
        onClose={() => setRevoking(null)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setRevoking(null)}>
              Cancelar
            </Button>
            <Button type="button" loading={saving} disabled={!reason.trim()} onClick={() => void revoke()}>
              Revocar acceso
            </Button>
          </>
        }
      >
        <Field label="Motivo (obligatorio)" htmlFor="revokeReason">
          <Textarea id="revokeReason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
