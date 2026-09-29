import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Field, Input, Select, Textarea } from "../../components/ui";
import { handleError } from "../../lib/Errors";
import { servicePortalService } from "../../services/serviceDeskService";
import { ROOM_ACCESS_TYPE_LABELS, type PortalCommRoom, type RoomAccessType } from "../../types/commRoom";
import type { RoomAccessDraft } from "./roomAccessDraft";

// Datos del acceso a sala de comunicaciones en Generar Ticket (plan 016). El Service Desk valida
// la sala, el motivo y el periodo, y despues lo aprueba el responsable de TI / Seguridad.
export function RoomAccessFields({ value, onChange }: { value: RoomAccessDraft; onChange: (next: RoomAccessDraft) => void }) {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<PortalCommRoom[]>([]);
  const set = <K extends keyof RoomAccessDraft>(key: K, next: RoomAccessDraft[K]) => onChange({ ...value, [key]: next });

  useEffect(() => {
    servicePortalService
      .commRooms()
      .then(setRooms)
      .catch((error) => handleError(error, navigate));
  }, [navigate]);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Sala *" htmlFor="ra-room">
        <Select id="ra-room" value={value.roomId} onChange={(e) => set("roomId", e.target.value)}>
          <option value="">Seleccione la sala…</option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.costCenterName} — {room.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="¿Quién ingresará? *" htmlFor="ra-kind">
        <Select id="ra-kind" value={value.beneficiaryKind} onChange={(e) => set("beneficiaryKind", e.target.value as RoomAccessDraft["beneficiaryKind"])}>
          <option value="INTERNAL">Un colaborador de la empresa</option>
          <option value="EXTERNAL">Una persona externa (técnico, proveedor)</option>
        </Select>
      </Field>
      <Field label="RUT completo *" htmlFor="ra-rut">
        <Input id="ra-rut" value={value.documentId} autoComplete="off" placeholder="12345678-9" maxLength={20} onChange={(e) => set("documentId", e.target.value)} />
      </Field>
      {value.beneficiaryKind === "EXTERNAL" ? (
        <>
          <Field label="Nombre completo *" htmlFor="ra-name">
            <Input id="ra-name" value={value.fullName} maxLength={160} onChange={(e) => set("fullName", e.target.value)} />
          </Field>
          <Field label="Empresa *" htmlFor="ra-company">
            <Input id="ra-company" value={value.company} maxLength={160} onChange={(e) => set("company", e.target.value)} />
          </Field>
        </>
      ) : (
        <p className="self-end pb-2 text-xs text-slate-500">El colaborador se identifica por su RUT al registrar el ticket.</p>
      )}
      <Field label="Tipo de acceso *" htmlFor="ra-type">
        <Select id="ra-type" value={value.requestedType} onChange={(e) => set("requestedType", e.target.value as RoomAccessType)}>
          {(Object.keys(ROOM_ACCESS_TYPE_LABELS) as RoomAccessType[]).map((type) => (
            <option key={type} value={type}>
              {ROOM_ACCESS_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Desde *" htmlFor="ra-from">
        <Input id="ra-from" type="datetime-local" value={value.requestedFrom} onChange={(e) => set("requestedFrom", e.target.value)} />
      </Field>
      {value.requestedType !== "PERMANENT" && (
        <Field label="Hasta *" htmlFor="ra-until">
          <Input id="ra-until" type="datetime-local" value={value.requestedUntil} onChange={(e) => set("requestedUntil", e.target.value)} />
        </Field>
      )}
      <div className="sm:col-span-2">
        <Field label="Motivo del acceso *" htmlFor="ra-reason">
          <Textarea id="ra-reason" rows={2} maxLength={2000} value={value.reason} onChange={(e) => set("reason", e.target.value)} />
        </Field>
      </div>
    </div>
  );
}
