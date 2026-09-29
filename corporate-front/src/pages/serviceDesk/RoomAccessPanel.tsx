import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { showSuccessToast, showWarningToast } from "../../components/Toast";
import { Alert, Button, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { createValidationError } from "../../lib/Errors/CustomError";
import { handleError } from "../../lib/Errors";
import { serviceTicketService } from "../../services/serviceDeskService";
import {
  ROOM_ACCESS_REQUEST_STATUS_LABELS,
  ROOM_ACCESS_TYPE_LABELS,
  type PortalCommRoom,
  type RoomAccessType,
} from "../../types/commRoom";
import type { TicketDetail } from "../../types/serviceDesk";
import { formatPeriod, fromDateTimeLocal, toDateTimeLocal } from "../comunicaciones/commRoomUi";
import { Section } from "./components";

// Acceso a sala de comunicaciones en el workspace del agente (plan 016): lo pedido, lo validado y la
// decision. El agente valida sala, tipo y periodo y lo envia al grupo Responsable TI / Seguridad.
export function RoomAccessPanel({
  detail,
  canValidate,
  onUpdated,
}: {
  detail: TicketDetail;
  canValidate: boolean;
  onUpdated: (ticket: TicketDetail) => void;
}) {
  const access = detail.roomAccess;
  const [open, setOpen] = useState(false);
  if (!access) return null;
  const validatable = canValidate && access.status === "REQUESTED" && (detail.status === "ASSIGNED" || detail.status === "IN_PROGRESS");

  return (
    <Section
      title="Acceso a sala"
      actions={
        validatable ? (
          <Button type="button" onClick={() => setOpen(true)}>
            Validar y enviar a aprobación
          </Button>
        ) : undefined
      }
    >
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <Item label="Estado" value={ROOM_ACCESS_REQUEST_STATUS_LABELS[access.status]} />
        <Item label="Sala" value={`${access.roomName} (${access.costCenterName})`} />
        <Item
          label="Beneficiario"
          value={`${access.beneficiaryName} · ${access.beneficiaryDocumentId}${access.beneficiaryCompany ? ` · ${access.beneficiaryCompany}` : " · Colaborador"}`}
        />
        <Item label="Solicitado" value={`${ROOM_ACCESS_TYPE_LABELS[access.requestedType]}: ${formatPeriod(access.requestedFrom, access.requestedUntil)}`} />
        <div className="sm:col-span-2">
          <Item label="Motivo" value={access.reason} />
        </div>
        {access.accessType && (
          <Item
            label="Validado"
            value={`${ROOM_ACCESS_TYPE_LABELS[access.accessType]}: ${formatPeriod(access.validFrom, access.validUntil)} · ${access.validatedByName ?? "-"}`}
          />
        )}
        {access.validationNotes && <Item label="Notas de validación" value={access.validationNotes} />}
        {access.validationWarnings.length > 0 && <Item label="Avisos de la validación" value={access.validationWarnings.join(" · ")} />}
        {access.decidedByName && <Item label="Decidió" value={access.decidedByName} />}
      </dl>
      {!canValidate && access.status === "REQUESTED" && (
        <p className="mt-2 text-xs text-slate-500">Tome el ticket para validarlo y enviarlo a aprobación.</p>
      )}
      {open && (
        <ValidateModal
          detail={detail}
          onClose={() => setOpen(false)}
          onValidated={(ticket) => {
            setOpen(false);
            onUpdated(ticket);
          }}
        />
      )}
    </Section>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline font-medium text-slate-600">{label}: </dt>
      <dd className="inline text-slate-800">{value}</dd>
    </div>
  );
}

function ValidateModal({
  detail,
  onClose,
  onValidated,
}: {
  detail: TicketDetail;
  onClose: () => void;
  onValidated: (ticket: TicketDetail) => void;
}) {
  const navigate = useNavigate();
  const access = detail.roomAccess!;
  const [rooms, setRooms] = useState<PortalCommRoom[]>([]);
  const [roomId, setRoomId] = useState(String(access.roomId));
  const [accessType, setAccessType] = useState<RoomAccessType>(access.requestedType);
  const [validFrom, setValidFrom] = useState(toDateTimeLocal(new Date(access.requestedFrom)));
  const [validUntil, setValidUntil] = useState(access.requestedUntil ? toDateTimeLocal(new Date(access.requestedUntil)) : "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    serviceTicketService
      .commRooms()
      .then(setRooms)
      .catch((error) => handleError(error, navigate));
  }, [navigate]);

  async function submit(): Promise<void> {
    setSaving(true);
    try {
      const from = fromDateTimeLocal(validFrom);
      if (!from) throw createValidationError("Indique el inicio del acceso");
      const until = accessType === "PERMANENT" ? null : fromDateTimeLocal(validUntil);
      if (accessType !== "PERMANENT" && !until) throw createValidationError("Indique el término del acceso");
      const { ticket, warnings } = await serviceTicketService.validateRoomAccess(detail.id, {
        roomId: Number(roomId),
        accessType,
        validFrom: from,
        validUntil: until,
        notes: notes.trim() || undefined,
      });
      showSuccessToast("Acceso validado: quedó esperando la aprobación del responsable");
      for (const warning of warnings) showWarningToast(warning);
      onValidated(ticket);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Validar acceso a sala"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" loading={saving} onClick={() => void submit()}>
            Enviar a aprobación
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Alert tone="info">
          Confirme la sala y el motivo con el solicitante y defina el período. Lo aprueba el grupo Responsable TI / Seguridad; usted no
          puede aprobarlo.
        </Alert>
        <Field label="Sala" htmlFor="va-room">
          <Select id="va-room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.costCenterName} — {room.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tipo de acceso" htmlFor="va-type">
          <Select id="va-type" value={accessType} onChange={(e) => setAccessType(e.target.value as RoomAccessType)}>
            {(Object.keys(ROOM_ACCESS_TYPE_LABELS) as RoomAccessType[]).map((type) => (
              <option key={type} value={type}>
                {ROOM_ACCESS_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Desde" htmlFor="va-from">
            <Input id="va-from" type="datetime-local" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </Field>
          {accessType !== "PERMANENT" && (
            <Field label="Hasta" htmlFor="va-until">
              <Input id="va-until" type="datetime-local" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </Field>
          )}
        </div>
        <Field label="Notas internas (opcional)" htmlFor="va-notes">
          <Textarea id="va-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
