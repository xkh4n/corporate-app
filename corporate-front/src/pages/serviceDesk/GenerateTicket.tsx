import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Alert, Button, EmptyState, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { showSuccessToast, showWarningToast } from "../../components/Toast";
import { createValidationError } from "../../lib/Errors/CustomError";
import { handleError } from "../../lib/Errors";
import { downloadBlob } from "../../lib/downloadBlob";
import { servicePortalService } from "../../services/serviceDeskService";
import type {
  CatalogItem,
  HeldAsset,
  KbArticle,
  KbArticleSummary,
  ServiceCategory,
  TicketDetail,
  TicketSummary,
  TicketType,
} from "../../types/serviceDesk";
import { formatDateTime } from "../inventario/inventoryLabels";
import { Pager } from "../contabilidad/Pager";
import {
  DynamicField,
  AttachButton,
  AttachmentList,
  Badge,
  BackButton,
  CARD,
  Loading,
  PlainText,
  PriorityBadge,
  Section,
  SlaBadge,
  StatusBadge,
  Tabs,
  TicketTable,
  Timeline,
} from "./components";
import { EMPTY_EQUIPMENT_DRAFT, toEquipmentPayload, type EquipmentDraft } from "./equipmentDraft";
import { EquipmentRequestFields } from "./EquipmentRequestFields";
import { RoomAccessFields } from "./RoomAccessFields";
import { emptyRoomAccessDraft, toRoomAccessPayload, type RoomAccessDraft } from "./roomAccessDraft";
import { ROOM_ACCESS_REQUEST_STATUS_LABELS, ROOM_ACCESS_TYPE_LABELS } from "../../types/commRoom";
import { formatPeriod } from "../comunicaciones/commRoomUi";
import { ASSET_STATUS_LABELS, humanizeKey, IMPACT_LABELS, MAX_ATTACHMENT_BYTES, RESOLUTION_LABELS, TYPE_LABELS, URGENCY_LABELS } from "./serviceDeskLabels";

// Portal del solicitante (plan 009): registrar un incidente o pedir un
// servicio del catalogo, seguir los propios tickets y buscar ayuda en la base
// de conocimiento. Una sola ruta: ?tab=... y ?ticket=<id> para el detalle.
const REQUIRED_PERMISSIONS = ["service-tickets:create"] as const;

type PortalTab = "new" | "mine" | "help";

export default function GenerateTicket() {
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTicket = Number(searchParams.get("ticket"));
  const ticketId = Number.isInteger(rawTicket) && rawTicket > 0 ? rawTicket : null;
  const tabParam = searchParams.get("tab");
  const tab: PortalTab = tabParam === "mine" || tabParam === "help" ? tabParam : "new";
  const canKb = can("kb-articles:read");

  const tabs: { key: PortalTab; label: string }[] = [
    { key: "new", label: "Nuevo ticket" },
    { key: "mine", label: "Mis tickets" },
    ...(canKb ? [{ key: "help" as const, label: "Centro de ayuda" }] : []),
  ];

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Mesa de Servicios</h1>
        <div className="w-full sm:max-w-[95%] mx-auto sm:px-4 lg:px-8">
          {ticketId !== null ? (
            <PortalTicketDetail id={ticketId} onBack={() => setSearchParams({ tab: "mine" })} />
          ) : (
            <>
              <Tabs tabs={tabs} active={tab} onChange={(key) => setSearchParams({ tab: key })} />
              {tab === "new" && (
                <NewTicketForm
                  canKb={canKb}
                  initialService={searchParams.get("service")}
                  onCreated={(id) => setSearchParams({ ticket: String(id) })}
                />
              )}
              {tab === "mine" && <MyTickets onOpen={(id) => setSearchParams({ ticket: String(id) })} />}
              {tab === "help" && canKb && <HelpCenter />}
            </>
          )}
        </div>
      </div>
    </RequirePermissions>
  );
}

// ---------------------------------------------------------------------------
// Nuevo ticket
// ---------------------------------------------------------------------------
// initialService: "equipment" (la solicitud de equipo, a donde redirige la vieja
// "Nueva Solicitud") o el id de un item del catalogo.
function NewTicketForm({ canKb, initialService, onCreated }: { canKb: boolean; initialService: string | null; onCreated: (id: number) => void }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [myAssets, setMyAssets] = useState<HeldAsset[]>([]);

  const [type, setType] = useState<TicketType>("INCIDENT");
  const [catalogItemId, setCatalogItemId] = useState<number | "">("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [impact, setImpact] = useState(3);
  const [urgency, setUrgency] = useState(2);
  const [variables, setVariables] = useState<Record<string, unknown>>({});
  const [assetIds, setAssetIds] = useState<Set<number>>(new Set());
  const [files, setFiles] = useState<File[]>([]);
  const [equipment, setEquipment] = useState<EquipmentDraft>(EMPTY_EQUIPMENT_DRAFT);
  const [roomAccess, setRoomAccess] = useState<RoomAccessDraft>(emptyRoomAccessDraft);
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<KbArticleSummary[]>([]);
  const [openArticleId, setOpenArticleId] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([servicePortalService.catalog(), servicePortalService.myAssets()])
      .then(([catalog, assets]) => {
        setCategories(catalog.categories);
        setCatalogItems(catalog.catalogItems);
        setMyAssets(assets);
        const preselected =
          initialService === "equipment"
            ? catalog.catalogItems.find((item) => item.fulfillment === "PURCHASE_REQUEST")
            : catalog.catalogItems.find((item) => String(item.id) === initialService);
        if (preselected) {
          setType("SERVICE_REQUEST");
          setCatalogItemId(preselected.id);
        }
      })
      .catch((error) => handleError(error, navigate))
      .finally(() => setLoading(false));
  }, [navigate, initialService]);

  // Sugerencias de la base de conocimiento mientras escribe el asunto (autoservicio).
  useEffect(() => {
    if (!canKb || title.trim().length < 4) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      servicePortalService
        .searchKb(title.trim(), true)
        .then((items) => !cancelled && setSuggestions(items.slice(0, 4)))
        .catch(() => !cancelled && setSuggestions([]));
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [title, canKb]);

  const selectedItem = catalogItems.find((item) => item.id === catalogItemId) ?? null;
  const createsPurchase = type === "SERVICE_REQUEST" && selectedItem?.fulfillment === "PURCHASE_REQUEST";
  const requestsRoomAccess = type === "SERVICE_REQUEST" && selectedItem?.fulfillment === "ROOM_ACCESS";
  const incidentCategories = useMemo(
    () => categories.filter((category) => category.appliesTo.includes(type)),
    [categories, type],
  );
  const categoryLabel = (category: ServiceCategory) => {
    const parent = category.parentId ? categories.find((candidate) => candidate.id === category.parentId) : null;
    return parent ? `${parent.name} › ${category.name}` : category.name;
  };

  function toggleAsset(id: number): void {
    setAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addFile(file: File): void {
    if (files.length >= 5) {
      showWarningToast("Puede adjuntar hasta 5 archivos al crear el ticket (después puede agregar más)");
      return;
    }
    setFiles((prev) => [...prev, file]);
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      if (type === "SERVICE_REQUEST" && !selectedItem) throw createValidationError("Elija el servicio que necesita");
      if (title.trim().length < 5) throw createValidationError("Escriba un asunto de al menos 5 caracteres");
      if (description.trim().length < 10) throw createValidationError("Describa el caso con un poco más de detalle");
      for (const field of selectedItem?.fields ?? []) {
        const value = variables[field.key];
        if (field.required && (value === undefined || value === null || (typeof value === "string" && !value.trim()))) {
          throw createValidationError(`Complete el campo «${field.label}»`);
        }
      }
      const purchaseRequest = createsPurchase ? toEquipmentPayload(equipment) : undefined;
      const roomAccessPayload = requestsRoomAccess ? toRoomAccessPayload(roomAccess) : undefined;
      setSaving(true);
      const cleanVariables = Object.fromEntries(Object.entries(variables).filter(([, value]) => value !== undefined && value !== ""));
      const created = await servicePortalService.create({
        type,
        title: title.trim(),
        description: description.trim(),
        catalogItemId: type === "SERVICE_REQUEST" ? (selectedItem?.id ?? null) : null,
        categoryId: type === "INCIDENT" && categoryId !== "" ? categoryId : null,
        variables: type === "SERVICE_REQUEST" ? cleanVariables : undefined,
        impact,
        urgency,
        assetIds: [...assetIds],
        purchaseRequest,
        roomAccess: roomAccessPayload,
      });
      let failed = 0;
      for (const file of files) {
        try {
          await servicePortalService.uploadAttachment(created.id, file);
        } catch {
          failed++;
        }
      }
      if (failed > 0) showWarningToast(`${failed} adjunto(s) no se pudieron subir: agréguelos desde el detalle`);
      showSuccessToast(
        created.purchaseRequest?.number
          ? `Ticket ${created.number} y solicitud de compra ${created.purchaseRequest.number} registrados`
          : `Ticket ${created.number} registrado`,
      );
      onCreated(created.id);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <form onSubmit={handleSubmit} className={`${CARD} space-y-4 sm:space-y-5`}>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-700">¿Qué necesita?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              { key: "INCIDENT", title: "Algo no funciona", text: "Reportar una falla, error o interrupción" },
              { key: "SERVICE_REQUEST", title: "Necesito algo", text: "Pedir un equipo, acceso, instalación u otro servicio" },
            ] as const
          ).map((option) => (
            <label
              key={option.key}
              className={`cursor-pointer rounded-lg border-2 p-3 ${type === option.key ? "border-brand-600 bg-sky-50" : "border-slate-200 hover:border-slate-300"}`}
            >
              <input
                type="radio"
                name="ticket-type"
                className="sr-only"
                checked={type === option.key}
                onChange={() => {
                  setType(option.key);
                  setVariables({});
                  setEquipment(EMPTY_EQUIPMENT_DRAFT);
                  setRoomAccess(emptyRoomAccessDraft());
                }}
              />
              <span className="block font-semibold text-slate-800">{option.title}</span>
              <span className="text-sm text-slate-600">{option.text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {type === "SERVICE_REQUEST" ? (
        <div className="space-y-3">
          <Field label="Servicio *" htmlFor="catalog-item">
            <Select
              id="catalog-item"
              value={catalogItemId === "" ? "" : String(catalogItemId)}
              onChange={(e) => {
                setCatalogItemId(e.target.value ? Number(e.target.value) : "");
                setVariables({});
                setEquipment(EMPTY_EQUIPMENT_DRAFT);
                setRoomAccess(emptyRoomAccessDraft());
              }}
            >
              <option value="">Seleccione…</option>
              {catalogItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Field>
          {selectedItem && (
            <div className="rounded-md bg-slate-50 p-3">
              <PlainText text={selectedItem.description} />
              {selectedItem.requiresApproval && selectedItem.fulfillment !== "ROOM_ACCESS" && (
                <p className="mt-1 text-xs text-violet-700">Este servicio requiere aprobación antes de atenderse.</p>
              )}
              {selectedItem.fulfillment === "ROOM_ACCESS" && (
                <p className="mt-1 text-xs text-violet-700">
                  El Service Desk valida la sala, el motivo y el período, y luego lo aprueba el responsable de TI / Seguridad.
                </p>
              )}
              {selectedItem.fulfillment === "PURCHASE_REQUEST" && (
                <p className="mt-1 text-xs text-violet-700">
                  Genera una solicitud de compra: la aprueba quien usted elija y el ticket le muestra cada avance hasta la entrega.
                </p>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {selectedItem.fields.map((field) => (
                  <DynamicField
                    key={field.key}
                    field={field}
                    value={variables[field.key]}
                    onChange={(value) => setVariables((prev) => ({ ...prev, [field.key]: value }))}
                  />
                ))}
              </div>
              {createsPurchase && (
                <div className="mt-3">
                  <EquipmentRequestFields value={equipment} onChange={setEquipment} />
                </div>
              )}
              {requestsRoomAccess && (
                <div className="mt-3">
                  <RoomAccessFields value={roomAccess} onChange={setRoomAccess} />
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <Field label="Categoría" htmlFor="category">
          <Select id="category" value={categoryId === "" ? "" : String(categoryId)} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">No estoy seguro</option>
            {incidentCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {categoryLabel(category)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Asunto *" htmlFor="title">
        <Input id="title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} className="bg-zinc-100 focus:bg-indigo-100" placeholder="Ej.: No puedo imprimir desde mi notebook" />
      </Field>

      {suggestions.length > 0 && (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3">
          <p className="text-sm font-medium text-sky-900">Quizás esto le ayude a resolverlo ahora:</p>
          <ul className="mt-1 space-y-1 text-sm">
            {suggestions.map((article) => (
              <li key={article.id}>
                <button type="button" className="text-brand-700 hover:underline" onClick={() => setOpenArticleId(article.id)}>
                  {article.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Field label="Descripción *" htmlFor="description">
        <Textarea
          id="description"
          rows={5}
          maxLength={8000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="bg-zinc-100 focus:bg-indigo-100"
          placeholder="Qué pasó, desde cuándo, qué mensaje aparece y qué intentó."
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">¿A quiénes afecta?</legend>
          {[3, 2, 1].map((level) => (
            <label key={level} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="radio" name="impact" checked={impact === level} onChange={() => setImpact(level)} />
              {IMPACT_LABELS[level]}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">¿Qué tan urgente es?</legend>
          {[3, 2, 1].map((level) => (
            <label key={level} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="radio" name="urgency" checked={urgency === level} onChange={() => setUrgency(level)} />
              {URGENCY_LABELS[level]}
            </label>
          ))}
        </fieldset>
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Equipos involucrados (opcional)</legend>
        {myAssets.length === 0 ? (
          <p className="text-sm text-slate-500">No tiene activos asignados.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {myAssets.map((asset) => (
              <label key={asset.assetId} className="flex items-start gap-2 rounded-md border border-slate-200 p-2 text-sm">
                <input type="checkbox" className="mt-1" checked={assetIds.has(asset.assetId)} onChange={() => toggleAsset(asset.assetId)} />
                <span>
                  <span className="font-semibold text-slate-800">{asset.tag}</span> {asset.productName ?? ""}
                  <span className="block text-xs text-slate-500">
                    S/N {asset.serialNumber ?? "-"} · {ASSET_STATUS_LABELS[asset.statusCode] ?? asset.statusCode}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div>
        <p className="mb-1 text-sm font-medium text-slate-700">Adjuntos (opcional: capturas o PDF, hasta 10 MB c/u)</p>
        <div className="flex flex-wrap items-center gap-2">
          <AttachButton onFile={addFile} />
          {files.map((file, index) => (
            <span key={`${file.name}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">
              <span className="truncate">{file.name}</span> <span className="shrink-0">({Math.ceil(file.size / 1024)} KB)</span>
              <button type="button" aria-label={`Quitar ${file.name}`} onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))} className="shrink-0 px-1 text-slate-500 hover:text-red-600">
                ×
              </button>
            </span>
          ))}
        </div>
        {files.some((file) => file.size > MAX_ATTACHMENT_BYTES) && <Alert tone="error">Un archivo supera los 10 MB.</Alert>}
      </div>

      <div className="flex justify-end">
        <Button type="submit" loading={saving} className="w-full sm:w-auto">
          Enviar ticket
        </Button>
      </div>

      <ArticleModal articleId={openArticleId} onClose={() => setOpenArticleId(null)} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Mis tickets
// ---------------------------------------------------------------------------
function MyTickets({ onOpen }: { onOpen: (id: number) => void }) {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [page, setPage] = useState(1);
  const [totals, setTotals] = useState({ totalPages: 1, totalItems: 0 });

  useEffect(() => {
    setLoading(true);
    servicePortalService
      .list({ page, limit: 20, includeClosed })
      .then((res) => {
        setTickets(res.items);
        setTotals({ totalPages: res.pagination.totalPages, totalItems: res.pagination.totalItems });
      })
      .catch((error) => handleError(error, navigate))
      .finally(() => setLoading(false));
  }, [page, includeClosed, navigate]);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={includeClosed}
          onChange={(e) => {
            setIncludeClosed(e.target.checked);
            setPage(1);
          }}
        />
        Incluir cerrados y anulados
      </label>
      {loading ? (
        <Loading />
      ) : tickets.length === 0 ? (
        <EmptyState title="No tiene tickets" description="Cuando registre un ticket lo verá aquí con su estado." />
      ) : (
        <>
          <TicketTable tickets={tickets} onOpen={(ticket) => onOpen(ticket.id)} showRequester={false} />
          <Pager page={page} totalPages={totals.totalPages} totalItems={totals.totalItems} noun="tickets" onChange={setPage} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detalle para el solicitante
// ---------------------------------------------------------------------------
function PortalTicketDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [modal, setModal] = useState<"reopen" | "confirm" | "cancel" | null>(null);
  const [modalText, setModalText] = useState("");
  const [score, setScore] = useState(0);

  async function load(): Promise<void> {
    try {
      setDetail(await servicePortalService.getById(id));
    } catch (error) {
      setDetail(null);
      handleError(error, navigate);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function run(key: string, action: () => Promise<TicketDetail>, success: string): Promise<void> {
    setBusy(key);
    try {
      setDetail(await action());
      showSuccessToast(success);
      setModal(null);
      setModalText("");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File): Promise<void> {
    setBusy("upload");
    try {
      await servicePortalService.uploadAttachment(id, file);
      showSuccessToast("Adjunto agregado");
      await load();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setBusy(null);
    }
  }

  async function download(attachmentId: number, name: string): Promise<void> {
    try {
      downloadBlob(await servicePortalService.downloadAttachment(id, attachmentId), name);
    } catch (error) {
      handleError(error, navigate);
    }
  }

  if (loading) return <Loading />;
  if (!detail) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <EmptyState title="Ticket no encontrado" />
      </div>
    );
  }

  const isFinal = detail.status === "CLOSED" || detail.status === "CANCELLED";
  // Con compra vinculada, anular el ticket retira la compra: solo antes de que alguien la apruebe.
  const purchaseWithdrawable = !detail.purchaseRequest || ["DRAFT", "SUBMITTED"].includes(detail.purchaseRequest.status ?? "");
  const canCancel = ["PENDING_APPROVAL", "NEW", "ASSIGNED"].includes(detail.status) && purchaseWithdrawable;
  const isResolved = detail.status === "RESOLVED";

  return (
    <div>
      <BackButton onBack={onBack} label="Volver a mis tickets" />
      <div className={`${CARD} mb-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="break-all text-lg font-semibold text-slate-800">{detail.number}</h2>
          <Badge className="bg-slate-100 text-slate-700">{TYPE_LABELS[detail.type]}</Badge>
          <StatusBadge status={detail.status} />
          <PriorityBadge priority={detail.priority} />
          <SlaBadge state={detail.slaState} dueAt={detail.resolutionDueAt} />
        </div>
        <p className="mt-2 break-words font-medium text-slate-800">{detail.title}</p>
        <p className="mt-1 text-sm text-slate-600">
          {detail.catalogItemName ?? detail.categoryName ?? "Sin categoría"} · Creado {formatDateTime(detail.createdAt)} · Atiende:{" "}
          {detail.assignedGroupName ?? "Mesa de Servicios"}
          {detail.assigneeName ? ` (${detail.assigneeName})` : ""}
        </p>
        <PlainText text={detail.description} className="mt-3" />
        {detail.roomAccess && (
          <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
            <p>
              Acceso a <span className="font-semibold">{detail.roomAccess.roomName}</span> ({detail.roomAccess.costCenterName}) para{" "}
              {detail.roomAccess.beneficiaryName}: {ROOM_ACCESS_REQUEST_STATUS_LABELS[detail.roomAccess.status]}
            </p>
            <p className="text-xs text-slate-500">
              {detail.roomAccess.accessType
                ? `${ROOM_ACCESS_TYPE_LABELS[detail.roomAccess.accessType]}: ${formatPeriod(detail.roomAccess.validFrom, detail.roomAccess.validUntil)}`
                : `Solicitado: ${ROOM_ACCESS_TYPE_LABELS[detail.roomAccess.requestedType]}, ${formatPeriod(detail.roomAccess.requestedFrom, detail.roomAccess.requestedUntil)}`}
            </p>
          </div>
        )}
        {detail.purchaseRequest && (
          <p className="mt-3 rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-900">
            Solicitud de compra <span className="font-semibold">{detail.purchaseRequest.number ?? `#${detail.purchaseRequest.id}`}</span>:{" "}
            {detail.purchaseRequest.statusLabel ?? "estado no disponible"}
          </p>
        )}
        {Object.keys(detail.variables).length > 0 && (
          <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
            {Object.entries(detail.variables).map(([key, value]) => (
              <div key={key}>
                <dt className="inline font-medium text-slate-600">{humanizeKey(key)}: </dt>
                <dd className="inline break-words text-slate-800">{typeof value === "boolean" ? (value ? "Sí" : "No") : String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
        {isResolved && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-sm font-medium text-emerald-900">
              Resuelto: {detail.resolutionCode ? RESOLUTION_LABELS[detail.resolutionCode] : ""}
            </p>
            <PlainText text={detail.resolutionNotes} />
            <p className="mt-1 text-xs text-emerald-800">
              Si no responde, se cerrará automáticamente {detail.autoCloseAt ? `el ${formatDateTime(detail.autoCloseAt)}` : "en 3 días hábiles"}.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant="success" onClick={() => setModal("confirm")}>
                Confirmar solución
              </Button>
              <Button type="button" variant="secondary" onClick={() => setModal("reopen")}>
                El problema sigue
              </Button>
            </div>
          </div>
        )}
        {detail.status === "ON_HOLD" && detail.onHoldReason === "AWAITING_USER" && (
          <div className="mt-4">
            <Alert tone="warning">El equipo de soporte espera su respuesta. Agregue un comentario para retomar el ticket.</Alert>
          </div>
        )}
        {canCancel && (
          <div className="mt-4">
            <Button type="button" variant="ghost" onClick={() => setModal("cancel")}>
              {detail.purchaseRequest ? "Anular ticket y solicitud de compra" : "Anular ticket"}
            </Button>
          </div>
        )}
      </div>

      {detail.assets.length > 0 && (
        <Section title="Equipos">
          <ul className="space-y-1 text-sm">
            {detail.assets.map((asset) => (
              <li key={asset.assetId}>
                <span className="font-semibold">{asset.tag}</span> {asset.productName ?? ""} ·{" "}
                {ASSET_STATUS_LABELS[asset.statusCode] ?? asset.statusCode}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Conversación">
        {!isFinal && (
          <div className="mb-4 space-y-2">
            <Textarea rows={3} maxLength={8000} value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Nuevo comentario" placeholder="Escriba un comentario para el equipo de soporte" className="bg-zinc-100 focus:bg-indigo-100" />
            <div className="flex flex-wrap justify-end gap-2">
              <AttachButton onFile={(file) => void upload(file)} loading={busy === "upload"} />
              <Button
                type="button"
                loading={busy === "comment"}
                disabled={!comment.trim()}
                onClick={() =>
                  void run("comment", () => servicePortalService.comment(id, comment.trim()), "Comentario enviado").then(() => setComment(""))
                }
              >
                Enviar comentario
              </Button>
            </div>
          </div>
        )}
        <Timeline events={detail.events} />
      </Section>

      <Section title="Adjuntos">
        <AttachmentList attachments={detail.attachments} onDownload={(attachment) => void download(attachment.id, attachment.originalName)} />
      </Section>

      <Modal
        open={modal !== null}
        title={modal === "confirm" ? "Confirmar solución" : modal === "reopen" ? "Reabrir ticket" : "Anular ticket"}
        onClose={() => setModal(null)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>
              Volver
            </Button>
            {modal === "confirm" && (
              <Button type="button" variant="success" loading={busy === "confirm"} onClick={() => void run("confirm", () => servicePortalService.confirm(id, score || undefined, modalText.trim() || undefined), "Gracias, el ticket quedó cerrado")}>
                Cerrar ticket
              </Button>
            )}
            {modal === "reopen" && (
              <Button type="button" loading={busy === "reopen"} disabled={!modalText.trim()} onClick={() => void run("reopen", () => servicePortalService.reopen(id, modalText.trim()), "Ticket reabierto")}>
                Reabrir
              </Button>
            )}
            {modal === "cancel" && (
              <Button type="button" loading={busy === "cancel"} onClick={() => void run("cancel", () => servicePortalService.cancel(id, modalText.trim() || undefined), "Ticket anulado")}>
                Anular
              </Button>
            )}
          </>
        }
      >
        {modal === "confirm" && (
          <fieldset className="mb-3">
            <legend className="mb-1 text-sm font-medium text-slate-700">¿Cómo evalúa la atención? (opcional)</legend>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${value} de 5`}
                  aria-pressed={score === value}
                  onClick={() => setScore(value)}
                  className={`text-2xl ${value <= score ? "text-amber-400" : "text-slate-300"}`}
                >
                  ★
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <Field label={modal === "reopen" ? "¿Qué sigue fallando? *" : "Comentario (opcional)"} htmlFor="modal-text">
          <Textarea id="modal-text" rows={3} maxLength={modal === "reopen" ? 4000 : 500} value={modalText} onChange={(e) => setModalText(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Centro de ayuda (base de conocimiento publica)
// ---------------------------------------------------------------------------
function HelpCenter() {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [articles, setArticles] = useState<KbArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openArticleId, setOpenArticleId] = useState<number | null>(null);

  async function search(query: string): Promise<void> {
    setLoading(true);
    try {
      setArticles(await servicePortalService.searchKb(query));
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void search("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void search(term);
        }}
      >
        <Input className="min-w-0 flex-1" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="¿En qué necesita ayuda?" aria-label="Buscar en el centro de ayuda" />
        <Button type="submit" className="shrink-0">Buscar</Button>
      </form>
      {loading ? (
        <Loading />
      ) : articles.length === 0 ? (
        <EmptyState title="Sin resultados" description="Pruebe con otras palabras o registre un ticket." />
      ) : (
        <ul className="space-y-2">
          {articles.map((article) => (
            <li key={article.id} className={CARD}>
              <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => setOpenArticleId(article.id)}>
                {article.title}
              </button>
              <p className="mt-1 line-clamp-2 text-sm text-slate-600">{article.snippet}</p>
            </li>
          ))}
        </ul>
      )}
      <ArticleModal articleId={openArticleId} onClose={() => setOpenArticleId(null)} />
    </div>
  );
}

function ArticleModal({ articleId, onClose }: { articleId: number | null; onClose: () => void }) {
  const navigate = useNavigate();
  const [article, setArticle] = useState<KbArticle | null>(null);
  const [voted, setVoted] = useState(false);
  // En ref: quien lo usa pasa una funcion nueva en cada render y no debe recargar el articulo.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    setArticle(null);
    setVoted(false);
    if (articleId === null) return;
    servicePortalService
      .getKbArticle(articleId)
      .then(setArticle)
      .catch((error) => {
        handleError(error, navigate);
        onCloseRef.current();
      });
  }, [articleId, navigate]);

  async function vote(helpful: boolean): Promise<void> {
    if (!article) return;
    try {
      await servicePortalService.kbFeedback(article.id, helpful);
      setVoted(true);
    } catch (error) {
      handleError(error, navigate);
    }
  }

  return (
    <Modal open={articleId !== null} title={article?.title ?? "Artículo"} onClose={onClose} size="lg">
      {!article ? (
        <Loading />
      ) : (
        <div>
          <p className="mb-3 text-xs text-slate-500">
            {article.number} · actualizado {formatDateTime(article.publishedAt)}
          </p>
          <PlainText text={article.body} />
          <div className="mt-4 border-t border-slate-200 pt-3 text-sm">
            {voted ? (
              <p className="text-emerald-700">¡Gracias por su opinión!</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-700">¿Le sirvió este artículo?</span>
                <Button type="button" variant="secondary" onClick={() => void vote(true)}>
                  Sí
                </Button>
                <Button type="button" variant="secondary" onClick={() => void vote(false)}>
                  No
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
