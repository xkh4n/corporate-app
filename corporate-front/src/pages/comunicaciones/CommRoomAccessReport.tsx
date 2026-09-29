import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { showErrorToast } from "../../components/Toast";
import { Button, EmptyState, Field, Input, Modal, Select } from "../../components/ui";
import { handleError } from "../../lib/Errors";
import { costCenterService } from "../../services";
import { commRoomService } from "../../services/commRoomService";
import type { CostCenter } from "../../types/costCenter";
import {
  ROOM_ACCESS_TYPE_LABELS,
  type CommRoom,
  type MultiRoomHolder,
  type RoomAccessGrant,
  type RoomAccessGrantDetail,
  type RoomAccessGrantFilters,
  type RoomEntry,
} from "../../types/commRoom";
import { formatDateTime } from "../inventario/inventoryLabels";
import { formatPeriod, grantStatusClass, grantStatusLabel, PAGE_CLASS, TABLE_WRAP, TD, TH, TITLE_CLASS } from "./commRoomUi";

// Consulta de Accesos (plan 016): quien tiene acceso hoy a cada sala, quien lo autorizo, por que,
// desde y hasta cuando, que ticket lo origino, quien ingreso, vencidos, varias tiendas y temporales
// prolongados. Solo lectura: el acceso se pide por ticket y se revoca en Administrar Salas.
const REQUIRED_PERMISSIONS = ["comm-rooms:read", "comm-room-accesses:read", "comm-room-entries:read", "cost-centers:read"] as const;

type Tab = "current" | "byRut" | "expired" | "multi" | "long" | "entries";
const TABS: { value: Tab; label: string }[] = [
  { value: "current", label: "Vigentes por sala" },
  { value: "byRut", label: "Buscar por RUT" },
  { value: "expired", label: "Vencidos" },
  { value: "multi", label: "Varias salas o tiendas" },
  { value: "long", label: "Temporales prolongados" },
  { value: "entries", label: "Ingresos" },
];

export default function CommRoomAccessReport() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("current");
  const [rooms, setRooms] = useState<CommRoom[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [detailId, setDetailId] = useState<number | null>(null);

  useEffect(() => {
    commRoomService
      .list({ limit: 200, sortBy: "costCenter", sortOrder: "asc" })
      .then((res) => setRooms(res.items))
      .catch((error) => handleError(error, navigate));
    costCenterService
      .list({ limit: 1000, sortBy: "code" })
      .then((res) => setCostCenters(res.items))
      .catch((error) => handleError(error, navigate));
  }, [navigate]);

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className={PAGE_CLASS}>
        <h1 className={TITLE_CLASS}>Consulta de Accesos</h1>
        <div className="w-full max-w-7xl mx-auto flex flex-col gap-4 px-2 sm:px-4">
          <div className="flex flex-wrap gap-2">
            {TABS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTab(option.value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  tab === option.value ? "bg-brand-600 text-white" : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {tab === "current" && <CurrentByRoom rooms={rooms} costCenters={costCenters} onDetail={setDetailId} />}
          {tab === "byRut" && <ByRut onDetail={setDetailId} />}
          {tab === "expired" && <ExpiredGrants rooms={rooms} onDetail={setDetailId} />}
          {tab === "multi" && <MultiRoom />}
          {tab === "long" && <GrantTable filters={{ longTemporary: true }} emptyTitle="No hay accesos temporales prolongados" onDetail={setDetailId} />}
          {tab === "entries" && <EntriesLog rooms={rooms} />}
        </div>
        {detailId !== null && <GrantDetailModal id={detailId} onClose={() => setDetailId(null)} />}
      </div>
    </RequirePermissions>
  );
}

function GrantTable({ filters, emptyTitle, onDetail }: { filters: RoomAccessGrantFilters; emptyTitle: string; onDetail: (id: number) => void }) {
  const navigate = useNavigate();
  const [grants, setGrants] = useState<RoomAccessGrant[] | null>(null);
  const key = JSON.stringify(filters);

  useEffect(() => {
    let active = true;
    commRoomService
      .listAccesses({ ...(JSON.parse(key) as RoomAccessGrantFilters), limit: 200, sortBy: "validFrom", sortOrder: "desc" })
      .then((res) => active && setGrants(res.items))
      .catch((error) => handleError(error, navigate));
    return () => {
      active = false;
    };
  }, [key, navigate]);

  if (grants === null) return null;
  if (grants.length === 0) return <EmptyState title={emptyTitle} description="No hay registros con estos filtros." />;
  return (
    <div className={TABLE_WRAP}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className={TH}>Beneficiario</th>
            <th className={TH}>Sala</th>
            <th className={TH}>Tipo</th>
            <th className={TH}>Período</th>
            <th className={TH}>Días activo</th>
            <th className={TH}>Motivo</th>
            <th className={TH}>Validó</th>
            <th className={TH}>Autorizó</th>
            <th className={TH}>Ticket</th>
            <th className={TH}>Estado</th>
            <th className={TH}></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {grants.map((grant) => (
            <tr key={grant.id}>
              <td className={TD}>
                <p className="font-medium text-slate-900">{grant.beneficiaryName}</p>
                <p className="text-xs text-slate-500">
                  {grant.beneficiaryDocumentId}
                  {grant.beneficiaryCompany ? ` · ${grant.beneficiaryCompany}` : ""}
                </p>
              </td>
              <td className={TD}>
                {grant.roomName}
                <p className="text-xs text-slate-500">{grant.costCenterName}</p>
              </td>
              <td className={TD}>{ROOM_ACCESS_TYPE_LABELS[grant.accessType]}</td>
              <td className={TD}>{formatPeriod(grant.validFrom, grant.validUntil)}</td>
              <td className={TD}>{grant.activeDays}</td>
              <td className={`${TD} max-w-xs`}>{grant.reason}</td>
              <td className={TD}>{grant.validatedByName ?? "-"}</td>
              <td className={TD}>{grant.approvedByName ?? "-"}</td>
              <td className={TD}>{grant.ticketNumber}</td>
              <td className={TD}>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${grantStatusClass(grant)}`}>{grantStatusLabel(grant)}</span>
              </td>
              <td className={TD}>
                <Button type="button" variant="ghost" onClick={() => onDetail(grant.id)}>
                  Ver
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CurrentByRoom({ rooms, costCenters, onDetail }: { rooms: CommRoom[]; costCenters: CostCenter[]; onDetail: (id: number) => void }) {
  const [roomId, setRoomId] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <Field label="Dependencia" htmlFor="currentCc">
          <Select id="currentCc" value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
            <option value="">Todas</option>
            {costCenters.map((costCenter) => (
              <option key={costCenter.id} value={costCenter.id}>
                {costCenter.code} - {costCenter.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sala" htmlFor="currentRoom">
          <Select id="currentRoom" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">Todas</option>
            {rooms
              .filter((room) => !costCenterId || room.costCenterId === Number(costCenterId))
              .map((room) => (
                <option key={room.id} value={room.id}>
                  {room.costCenterName} — {room.name}
                </option>
              ))}
          </Select>
        </Field>
      </div>
      <GrantTable
        filters={{
          validNow: true,
          roomId: roomId ? Number(roomId) : undefined,
          costCenterId: costCenterId ? Number(costCenterId) : undefined,
        }}
        emptyTitle="Nadie tiene acceso vigente"
        onDetail={onDetail}
      />
    </>
  );
}

function ByRut({ onDetail }: { onDetail: (id: number) => void }) {
  const [input, setInput] = useState("");
  const [documentId, setDocumentId] = useState("");
  return (
    <>
      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) {
            showErrorToast("Ingrese el RUT completo");
            return;
          }
          setDocumentId(input.trim());
        }}
      >
        <Field label="RUT completo (búsqueda exacta)" htmlFor="rutSearch">
          <Input id="rutSearch" value={input} autoComplete="off" placeholder="12345678-9" onChange={(e) => setInput(e.target.value)} />
        </Field>
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>
      {documentId && <GrantTable filters={{ documentId }} emptyTitle="Esa persona no tiene accesos registrados" onDetail={onDetail} />}
    </>
  );
}

function ExpiredGrants({ rooms, onDetail }: { rooms: CommRoom[]; onDetail: (id: number) => void }) {
  const [roomId, setRoomId] = useState("");
  return (
    <>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <Field label="Sala" htmlFor="expiredRoom">
          <Select id="expiredRoom" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">Todas</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.costCenterName} — {room.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <GrantTable
        filters={{ status: "EXPIRED", roomId: roomId ? Number(roomId) : undefined }}
        emptyTitle="No hay accesos vencidos"
        onDetail={onDetail}
      />
    </>
  );
}

function MultiRoom() {
  const navigate = useNavigate();
  const [by, setBy] = useState<"room" | "costCenter">("costCenter");
  const [holders, setHolders] = useState<MultiRoomHolder[] | null>(null);

  useEffect(() => {
    commRoomService
      .multiRoomHolders(by)
      .then(setHolders)
      .catch((error) => handleError(error, navigate));
  }, [by, navigate]);

  return (
    <>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <Field label="Contar por" htmlFor="multiBy">
          <Select id="multiBy" value={by} onChange={(e) => setBy(e.target.value as "room" | "costCenter")}>
            <option value="costCenter">Tiendas (centros de costo)</option>
            <option value="room">Salas</option>
          </Select>
        </Field>
      </div>
      {holders === null ? null : holders.length === 0 ? (
        <EmptyState title="Nadie tiene acceso vigente a más de una" description="Solo se cuentan los accesos vigentes." />
      ) : (
        <div className={TABLE_WRAP}>
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Persona</th>
                <th className={TH}>{by === "room" ? "Salas" : "Tiendas"}</th>
                <th className={TH}>Accesos vigentes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {holders.map((holder) => (
                <tr key={holder.beneficiaryDocumentId}>
                  <td className={TD}>
                    <p className="font-medium text-slate-900">{holder.beneficiaryName}</p>
                    <p className="text-xs text-slate-500">
                      {holder.beneficiaryDocumentId}
                      {holder.beneficiaryCompany ? ` · ${holder.beneficiaryCompany}` : ""}
                    </p>
                  </td>
                  <td className={TD}>{holder.places}</td>
                  <td className={TD}>
                    <ul className="list-disc pl-4">
                      {holder.rooms.map((room) => (
                        <li key={room.grantId}>
                          {room.costCenterName} — {room.roomName} ({ROOM_ACCESS_TYPE_LABELS[room.accessType]}
                          {room.validUntil ? `, hasta ${formatDateTime(room.validUntil)}` : ""})
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function EntriesLog({ rooms }: { rooms: CommRoom[] }) {
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [entries, setEntries] = useState<RoomEntry[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await commRoomService.listEntries({ roomId: roomId ? Number(roomId) : undefined, open: onlyOpen || undefined, limit: 200 });
      setEntries(res.items);
    } catch (error) {
      handleError(error, navigate);
    }
  }, [navigate, onlyOpen, roomId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <Field label="Sala" htmlFor="entriesRoom">
          <Select id="entriesRoom" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">Todas</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.costCenterName} — {room.name}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          Solo quienes siguen dentro
        </label>
      </div>
      {entries === null ? null : entries.length === 0 ? (
        <EmptyState title="No hay ingresos registrados" description="Los ingresos se registran en Registrar Ingreso." />
      ) : (
        <EntriesTable entries={entries} />
      )}
    </>
  );
}

function EntriesTable({ entries }: { entries: RoomEntry[] }) {
  return (
    <div className={TABLE_WRAP}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className={TH}>Persona</th>
            <th className={TH}>Sala</th>
            <th className={TH}>Ingresó</th>
            <th className={TH}>Salió</th>
            <th className={TH}>Registró</th>
            <th className={TH}>Ticket</th>
            <th className={TH}>Observación</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className={TD}>
                <p className="font-medium text-slate-900">{entry.beneficiaryName}</p>
                <p className="text-xs text-slate-500">{entry.beneficiaryDocumentId}</p>
              </td>
              <td className={TD}>
                {entry.roomName}
                <p className="text-xs text-slate-500">{entry.costCenterName}</p>
              </td>
              <td className={TD}>{formatDateTime(entry.checkedInAt)}</td>
              <td className={TD}>{entry.checkedOutAt ? formatDateTime(entry.checkedOutAt) : "Dentro"}</td>
              <td className={TD}>{entry.checkedInByName ?? "-"}</td>
              <td className={TD}>{entry.ticketNumber}</td>
              <td className={TD}>{entry.notes ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GrantDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const navigate = useNavigate();
  const [grant, setGrant] = useState<RoomAccessGrantDetail | null>(null);

  useEffect(() => {
    commRoomService
      .getAccess(id)
      .then(setGrant)
      .catch((error) => handleError(error, navigate));
  }, [id, navigate]);

  return (
    <Modal open title={grant ? `Acceso de ${grant.beneficiaryName}` : "Acceso"} size="lg" onClose={onClose}>
      {grant && (
        <div className="flex flex-col gap-3 text-sm text-slate-700">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            <dt className="font-semibold">Sala</dt>
            <dd>
              {grant.roomName} ({grant.costCenterName})
            </dd>
            <dt className="font-semibold">Beneficiario</dt>
            <dd>
              {grant.beneficiaryName} · {grant.beneficiaryDocumentId}
              {grant.beneficiaryCompany ? ` · ${grant.beneficiaryCompany}` : " · Colaborador"}
            </dd>
            <dt className="font-semibold">Tipo y período</dt>
            <dd>
              {ROOM_ACCESS_TYPE_LABELS[grant.accessType]}: {formatPeriod(grant.validFrom, grant.validUntil)}
            </dd>
            <dt className="font-semibold">Estado</dt>
            <dd>{grantStatusLabel(grant)}</dd>
            <dt className="font-semibold">Motivo</dt>
            <dd>{grant.reason}</dd>
            <dt className="font-semibold">Ticket</dt>
            <dd>{grant.ticketNumber}</dd>
            <dt className="font-semibold">Validó (Service Desk)</dt>
            <dd>{grant.validatedByName ?? "-"}</dd>
            <dt className="font-semibold">Autorizó</dt>
            <dd>
              {grant.approvedByName ?? "-"} · {formatDateTime(grant.approvedAt)}
            </dd>
            {grant.status === "REVOKED" && (
              <>
                <dt className="font-semibold">Revocado</dt>
                <dd>
                  {grant.revokedByName ?? "-"} · {formatDateTime(grant.revokedAt)}: {grant.revokeReason}
                </dd>
              </>
            )}
          </dl>
          <h3 className="mt-2 font-semibold text-slate-800">Ingresos</h3>
          {grant.entries.length === 0 ? <p className="text-slate-500">Sin ingresos registrados.</p> : <EntriesTable entries={grant.entries} />}
        </div>
      )}
    </Modal>
  );
}
