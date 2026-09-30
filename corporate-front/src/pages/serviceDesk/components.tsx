import { useEffect, useRef, useState, type ReactNode } from "react";
import { IoArrowBackOutline, IoAttachOutline, IoLockClosedOutline } from "react-icons/io5";
import { Button, Field, Input, Select, Spinner, Textarea } from "../../components/ui";
import { showErrorToast } from "../../components/Toast";
import type {
  CatalogField,
  HeldAsset,
  Priority,
  SlaState,
  TicketAttachment,
  TicketEvent,
  TicketStatus,
  TicketSummary,
  UserOption,
} from "../../types/serviceDesk";
import { formatDateTime } from "../inventario/inventoryLabels";
import {
  ASSET_STATUS_LABELS,
  ATTACHMENT_ACCEPT,
  EVENT_LABELS,
  MAX_ATTACHMENT_BYTES,
  ON_HOLD_LABELS,
  PRIORITY_CLASSES,
  PRIORITY_LABELS,
  RESOLUTION_LABELS,
  SLA_CLASSES,
  SLA_LABELS,
  STATUS_CLASSES,
  STATUS_LABELS,
  TYPE_LABELS,
  formatDue,
} from "./serviceDeskLabels";

// Piezas comunes de las pantallas del Service Desk (plan 009).

export const TH = "px-4 py-2 text-left font-semibold text-slate-600";
export const TD = "px-4 py-2 align-top";
// Padding menor en movil: la pagina y el layout ya aportan margen lateral.
export const CARD = "rounded-lg border border-slate-200 bg-white p-3 sm:p-4";

export function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <Badge className={STATUS_CLASSES[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge className={PRIORITY_CLASSES[priority]}>{PRIORITY_LABELS[priority]}</Badge>;
}

export function SlaBadge({ state, dueAt }: { state: SlaState; dueAt?: string | null }) {
  const showDue = dueAt && (state === "ON_TRACK" || state === "AT_RISK" || state === "BREACHED");
  return (
    <span className="inline-flex flex-col gap-0.5">
      <Badge className={SLA_CLASSES[state]}>{SLA_LABELS[state]}</Badge>
      {showDue && <span className="text-[11px] text-slate-500">{formatDue(dueAt)}</span>}
    </span>
  );
}

export function BackButton({ onBack, label = "Volver" }: { onBack: () => void; label?: string }) {
  return (
    <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
      <IoArrowBackOutline /> {label}
    </button>
  );
}

export function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className={`${CARD} mb-4`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

// Pestanas accesibles (roles tablist/tab/tabpanel).
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string; badge?: number }[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    // Una sola fila con scroll horizontal: en movil las pestanas no se apilan
    // en renglones sueltos (subrayado en vez de pestana con borde, que el
    // overflow recortaria).
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-300 scrollbar-none">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          onClick={() => onChange(tab.key)}
          className={`shrink-0 whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-sm font-medium sm:px-4 ${
            active === tab.key ? "border-brand-600 bg-white text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && (
            <span className="ml-2 rounded-full bg-red-100 px-1.5 text-xs font-semibold text-red-700">{tab.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// Texto del solicitante o del agente: se muestra tal cual (React lo escapa), con saltos de linea.
export function PlainText({ text, className = "" }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;
  return <p className={`whitespace-pre-wrap break-words text-sm text-slate-700 ${className}`}>{text}</p>;
}

function describeEvent(event: TicketEvent): string | null {
  const payload = event.payload;
  switch (event.eventType) {
    case "STATUS_CHANGED": {
      const to = payload.to as TicketStatus | undefined;
      const reason = payload.reason as keyof typeof ON_HOLD_LABELS | undefined;
      const code = payload.resolutionCode as keyof typeof RESOLUTION_LABELS | undefined;
      let text = to ? `Pasó a ${STATUS_LABELS[to] ?? to}` : "";
      if (reason) text += ` (${ON_HOLD_LABELS[reason] ?? reason})`;
      if (code) text += ` · ${RESOLUTION_LABELS[code] ?? code}`;
      if (payload.reopened) text += " · reabierto";
      return text;
    }
    case "PRIORITY_CHANGED": {
      const from = (payload.from as { priority?: string } | undefined)?.priority;
      const to = (payload.to as { priority?: string } | undefined)?.priority;
      return from && to ? `${from} → ${to}` : null;
    }
    case "ASSET_LINKED":
    case "ASSET_TO_SUPPORT":
      return typeof payload.tag === "string" ? `Activo ${payload.tag}` : null;
    case "ASSET_RETURNED":
      return payload.target === "HOLDER" ? "Devuelto al custodio" : "Devuelto a bodega";
    case "APPROVAL_DECIDED":
      return payload.decision === "APPROVED" ? "Aprobada" : "Rechazada";
    case "SLA_BREACHED":
      return payload.kind === "response" ? "Sin primera respuesta en plazo" : "Superó el plazo de resolución";
    case "CSAT":
      return typeof payload.score === "number" ? `Calificación ${payload.score} de 5` : null;
    case "LINKED_PROBLEM":
      return typeof payload.number === "string" ? `Problema ${payload.number}` : null;
    case "KB_ATTACHED":
      return typeof payload.number === "string" ? `Artículo ${payload.number}` : null;
    case "ATTACHMENT_ADDED":
      return typeof payload.originalName === "string" ? payload.originalName : null;
    default:
      return null;
  }
}

// Linea de tiempo del ticket. Las notas internas se distinguen (fondo ambar + candado).
export function Timeline({ events }: { events: TicketEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-slate-500">Sin actividad.</p>;
  return (
    <ol className="space-y-3">
      {[...events].reverse().map((event) => {
        const internal = !event.isPublic;
        const detail = describeEvent(event);
        return (
          <li
            key={event.id}
            className={`rounded-md border px-3 py-2 ${internal ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {internal && <IoLockClosedOutline aria-label="Interno" className="text-amber-700" />}
              <span className="font-semibold text-slate-700">{EVENT_LABELS[event.eventType] ?? event.eventType}</span>
              {detail && <span>· {detail}</span>}
              <span className="ml-auto text-right">
                {event.actorName ?? "Sistema"} · {formatDateTime(event.createdAt)}
              </span>
            </div>
            <PlainText text={event.body} className="mt-1" />
          </li>
        );
      })}
    </ol>
  );
}

export function AttachmentList({
  attachments,
  onDownload,
}: {
  attachments: TicketAttachment[];
  onDownload: (attachment: TicketAttachment) => void;
}) {
  if (attachments.length === 0) return <p className="text-sm text-slate-500">Sin adjuntos.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {attachments.map((attachment) => (
        <li key={attachment.id} className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => onDownload(attachment)} className="min-w-0 break-all text-left text-brand-700 hover:underline">
            {attachment.originalName}
          </button>
          <span className="text-xs text-slate-500">
            {(attachment.sizeBytes / 1024).toFixed(0)} KB · {attachment.uploadedByName ?? "-"} · {formatDateTime(attachment.createdAt)}
          </span>
          {!attachment.isPublic && <Badge className="bg-amber-100 text-amber-800">Interno</Badge>}
        </li>
      ))}
    </ul>
  );
}

// Boton que abre el selector de archivos y valida tipo y tamano antes de subir.
export function AttachButton({ onFile, loading, label = "Adjuntar archivo" }: { onFile: (file: File) => void; loading?: boolean; label?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  function handle(file: File | undefined): void {
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      showErrorToast("El archivo no puede superar los 10 MB");
      return;
    }
    const allowed = /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (!allowed) {
      showErrorToast("Solo se aceptan PDF o imágenes JPG/PNG");
      return;
    }
    onFile(file);
  }
  return (
    <>
      <input ref={inputRef} type="file" accept={ATTACHMENT_ACCEPT} className="hidden" onChange={(event) => handle(event.target.files?.[0])} />
      <Button type="button" variant="secondary" loading={loading} onClick={() => inputRef.current?.click()}>
        <IoAttachOutline /> {label}
      </Button>
    </>
  );
}

// Busqueda con espera: llama a search cuando el texto se estabiliza y descarta respuestas viejas.
function useDebouncedSearch<T>(term: string, search: (term: string) => Promise<T[]>, minLength = 2) {
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });
  useEffect(() => {
    const trimmed = term.trim();
    if (trimmed.length < minLength) {
      setResults([]);
      return;
    }
    const request = ++requestRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      searchRef
        .current(trimmed)
        .then((items) => {
          if (request === requestRef.current) setResults(items);
        })
        .catch(() => {
          if (request === requestRef.current) setResults([]);
        })
        .finally(() => {
          if (request === requestRef.current) setLoading(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [term, minLength]);
  return { results, loading };
}

export function AssetSearch({
  search,
  onPick,
  excludeIds = [],
  placeholder = "Buscar por etiqueta o número de serie",
}: {
  search: (term: string) => Promise<HeldAsset[]>;
  onPick: (asset: HeldAsset) => void;
  excludeIds?: number[];
  placeholder?: string;
}) {
  const [term, setTerm] = useState("");
  const { results, loading } = useDebouncedSearch(term, search);
  const visible = results.filter((asset) => !excludeIds.includes(asset.assetId));
  return (
    <div>
      <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder={placeholder} aria-label="Buscar activo" />
      {loading && <p className="mt-1 text-xs text-slate-500">Buscando…</p>}
      {visible.length > 0 && (
        <ul className="mt-1 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 bg-white text-sm">
          {visible.map((asset) => (
            <li key={asset.assetId}>
              <button
                type="button"
                onClick={() => {
                  onPick(asset);
                  setTerm("");
                }}
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-sky-50"
              >
                <span className="font-semibold text-slate-800">{asset.tag}</span>
                <span className="text-slate-600">{asset.productName ?? "-"}</span>
                <span className="text-xs text-slate-500">S/N {asset.serialNumber ?? "-"}</span>
                <span className="text-xs text-slate-500">{ASSET_STATUS_LABELS[asset.statusCode] ?? asset.statusCode}</span>
                {asset.holderName && <span className="text-xs text-slate-500">· {asset.holderName}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function UserSearch({
  search,
  onPick,
  placeholder = "Buscar por nombre o RUT",
}: {
  search: (term: string) => Promise<UserOption[]>;
  onPick: (user: UserOption) => void;
  placeholder?: string;
}) {
  const [term, setTerm] = useState("");
  const { results, loading } = useDebouncedSearch(term, search);
  return (
    <div>
      <Input value={term} onChange={(event) => setTerm(event.target.value)} placeholder={placeholder} aria-label="Buscar usuario" />
      {loading && <p className="mt-1 text-xs text-slate-500">Buscando…</p>}
      {results.length > 0 && (
        <ul className="mt-1 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 bg-white text-sm">
          {results.map((user) => (
            <li key={user.userId}>
              <button
                type="button"
                onClick={() => {
                  onPick(user);
                  setTerm("");
                }}
                className="flex w-full flex-wrap items-center gap-x-2 px-3 py-2 text-left hover:bg-sky-50"
              >
                <span className="font-medium text-slate-800">{user.fullName}</span>
                <span className="text-xs text-slate-500">{user.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Tabla de tickets (cola del agente, mis tickets, incidentes de un problema).
export function TicketTable({
  tickets,
  onOpen,
  showRequester = true,
  showAssignee = true,
  selectable,
}: {
  tickets: TicketSummary[];
  onOpen: (ticket: TicketSummary) => void;
  showRequester?: boolean;
  showAssignee?: boolean;
  selectable?: { selected: Set<number>; toggle: (id: number) => void };
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {selectable && <th className={TH}><span className="sr-only">Seleccionar</span></th>}
            <th className={TH}>Número</th>
            <th className={TH}>Asunto</th>
            <th className={TH}>Estado</th>
            <th className={TH}>Prioridad</th>
            <th className={TH}>SLA</th>
            {showRequester && <th className={TH}>Solicitante</th>}
            {showAssignee && <th className={TH}>Grupo / agente</th>}
            <th className={`${TH} hidden sm:table-cell`}>Actualizado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {tickets.map((ticket) => (
            <tr key={ticket.id} className={ticket.isMajor ? "bg-red-50" : undefined}>
              {selectable && (
                <td className={TD}>
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${ticket.number}`}
                    checked={selectable.selected.has(ticket.id)}
                    onChange={() => selectable.toggle(ticket.id)}
                  />
                </td>
              )}
              <td className={`${TD} whitespace-nowrap`}>
                <button type="button" onClick={() => onOpen(ticket)} className="font-semibold text-brand-700 hover:underline">
                  {ticket.number}
                </button>
                <div className="text-xs text-slate-500">{TYPE_LABELS[ticket.type]}</div>
              </td>
              <td className={`${TD} min-w-[12rem] max-w-xs`}>
                <span className="line-clamp-2">{ticket.title}</span>
                {ticket.isMajor && <Badge className="mt-1 bg-red-600 text-white">Incidente mayor</Badge>}
                <div className="text-xs text-slate-500">{ticket.catalogItemName ?? ticket.categoryName ?? ""}</div>
              </td>
              <td className={TD}>
                <StatusBadge status={ticket.status} />
              </td>
              <td className={TD}>
                <PriorityBadge priority={ticket.priority} />
              </td>
              <td className={TD}>
                <SlaBadge state={ticket.slaState} dueAt={ticket.resolutionDueAt} />
              </td>
              {showRequester && <td className={`${TD} min-w-[8rem]`}>{ticket.requesterName}</td>}
              {showAssignee && (
                <td className={`${TD} min-w-[8rem]`}>
                  <div>{ticket.assignedGroupName ?? "Sin grupo"}</div>
                  <div className="text-xs text-slate-500">{ticket.assigneeName ?? "Sin agente"}</div>
                </td>
              )}
              <td className={`${TD} hidden whitespace-nowrap sm:table-cell`}>{formatDateTime(ticket.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Campo dinamico de un item del catalogo (portal y alta del agente).
export function DynamicField({
  field,
  value,
  onChange,
}: {
  field: CatalogField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `var-${field.key}`;
  const label = `${field.label}${field.required ? " *" : ""}`;
  switch (field.type) {
    case "textarea":
      return (
        <Field label={label} htmlFor={id}>
          <Textarea id={id} rows={3} maxLength={2000} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="bg-zinc-100 focus:bg-indigo-100" />
        </Field>
      );
    case "number":
      return (
        <Field label={label} htmlFor={id}>
          <Input id={id} type="number" value={(value as number | undefined) ?? ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className="bg-zinc-100 focus:bg-indigo-100" />
        </Field>
      );
    case "date":
      return (
        <Field label={label} htmlFor={id}>
          <Input id={id} type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} className="bg-zinc-100 focus:bg-indigo-100" />
        </Field>
      );
    case "select":
      return (
        <Field label={label} htmlFor={id}>
          <Select id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">Seleccione…</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
      );
    case "boolean":
      return (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {field.label}
        </label>
      );
    default:
      return (
        <Field label={label} htmlFor={id}>
          <Input id={id} maxLength={200} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="bg-zinc-100 focus:bg-indigo-100" />
        </Field>
      );
  }
}
