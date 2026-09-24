import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Button, EmptyState, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { useNotifications } from "../../notifications/useNotifications";
import { serviceTicketService, type TicketListParams } from "../../services/serviceDeskService";
import type {
  CatalogItem,
  Channel,
  Priority,
  QueueView,
  ServiceCategory,
  SupportGroup,
  TicketSummary,
  TicketType,
  UserOption,
} from "../../types/serviceDesk";
import { Pager } from "../contabilidad/Pager";
import { ArticleDetailView, KnowledgeTab } from "./KnowledgeTab";
import { ChangeDetailView, ChangeFormModal, ChangesTab } from "./ChangesTab";
import { ProblemDetailView, ProblemsTab } from "./ProblemsTab";
import { ReportsTab } from "./ReportsTab";
import { TicketWorkspace } from "./TicketWorkspace";
import { DynamicField, Loading, Tabs, TicketTable, UserSearch } from "./components";
import { CHANNEL_LABELS, LEVEL_LABELS, PRIORITY_LABELS, TYPE_LABELS } from "./serviceDeskLabels";

// Gestion de Tickets (plan 009): el puesto de trabajo del Service Desk. Una
// sola ruta (el menu es la autoridad de rutas): pestanas por ?tab= y detalle
// por ?ticket= / ?problem= / ?change= / ?article=. Cada pestana aparece solo
// si el rol tiene su permiso.
const REQUIRED_PERMISSIONS = ["service-tickets:read"] as const;

type Tab = "queue" | "approvals" | "problems" | "changes" | "kb" | "reports";

function idParam(value: string | null): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export default function SupportServices() {
  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Gestión de Tickets</h1>
        <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
          <Workspace />
        </div>
      </div>
    </RequirePermissions>
  );
}

function Workspace() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { summary } = useNotifications();
  const [searchParams, setSearchParams] = useSearchParams();
  const [groups, setGroups] = useState<SupportGroup[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [lookupsLoaded, setLookupsLoaded] = useState(false);
  const [changeForm, setChangeForm] = useState<{ problemId: number | null } | null>(null);

  useEffect(() => {
    serviceTicketService
      .lookups()
      .then((data) => {
        setGroups(data.groups);
        setCategories(data.categories);
        setCatalogItems(data.catalogItems);
      })
      .catch((error) => handleError(error, navigate))
      .finally(() => setLookupsLoaded(true));
  }, [navigate]);

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "queue", label: "Cola de tickets", badge: summary.assignedOpenTickets },
    ...(can("service-tickets:approve") ? [{ key: "approvals" as const, label: "Aprobaciones", badge: summary.pendingTicketApprovals }] : []),
    ...(can("service-problems:read") ? [{ key: "problems" as const, label: "Problemas" }] : []),
    ...(can("service-changes:read") ? [{ key: "changes" as const, label: "Cambios", badge: summary.pendingChangeApprovals }] : []),
    ...(can("kb-articles:update") ? [{ key: "kb" as const, label: "Conocimiento" }] : []),
    ...(can("service-desk-reports:read") ? [{ key: "reports" as const, label: "Indicadores" }] : []),
  ];
  const tabParam = searchParams.get("tab") as Tab | null;
  const tab: Tab = tabs.some((item) => item.key === tabParam) ? tabParam! : "queue";

  const open = useCallback(
    (kind: "ticket" | "problem" | "change" | "article", id: number) => setSearchParams({ tab, [kind]: String(id) }),
    [setSearchParams, tab],
  );
  const back = () => setSearchParams({ tab });

  const ticketId = idParam(searchParams.get("ticket"));
  const problemId = idParam(searchParams.get("problem"));
  const changeId = idParam(searchParams.get("change"));
  const articleId = idParam(searchParams.get("article"));

  if (!lookupsLoaded) return <Loading />;

  let content;
  if (ticketId) {
    content = (
      <TicketWorkspace
        key={ticketId}
        id={ticketId}
        onBack={back}
        onOpenTicket={(id) => open("ticket", id)}
        onOpenProblem={(id) => setSearchParams({ tab: "problems", problem: String(id) })}
        onOpenChange={(id) => setSearchParams({ tab: "changes", change: String(id) })}
        groups={groups}
        categories={categories}
      />
    );
  } else if (problemId) {
    content = (
      <ProblemDetailView
        key={problemId}
        id={problemId}
        onBack={back}
        onOpenTicket={(id) => setSearchParams({ tab: "queue", ticket: String(id) })}
        onOpenChange={(id) => setSearchParams({ tab: "changes", change: String(id) })}
        onOpenArticle={(id) => setSearchParams({ tab: "kb", article: String(id) })}
        onCreateChange={(id) => setChangeForm({ problemId: id })}
        groups={groups}
        categories={categories}
      />
    );
  } else if (changeId) {
    content = (
      <ChangeDetailView
        key={changeId}
        id={changeId}
        onBack={back}
        onOpenTicket={(id) => setSearchParams({ tab: "queue", ticket: String(id) })}
        onOpenProblem={(id) => setSearchParams({ tab: "problems", problem: String(id) })}
        groups={groups}
        categories={categories}
      />
    );
  } else if (articleId) {
    content = (
      <ArticleDetailView
        key={articleId}
        id={articleId}
        onBack={back}
        onOpenProblem={(id) => setSearchParams({ tab: "problems", problem: String(id) })}
        categories={categories}
      />
    );
  } else {
    content = (
      <>
        <Tabs tabs={tabs} active={tab} onChange={(key) => setSearchParams({ tab: key })} />
        {tab === "queue" && (
          <Queue groups={groups} categories={categories} catalogItems={catalogItems} onOpen={(id) => open("ticket", id)} />
        )}
        {tab === "approvals" && <Approvals onOpen={(id) => open("ticket", id)} />}
        {tab === "problems" && <ProblemsTab onOpen={(id) => open("problem", id)} groups={groups} categories={categories} />}
        {tab === "changes" && <ChangesTab onOpen={(id) => open("change", id)} onCreate={() => setChangeForm({ problemId: null })} />}
        {tab === "kb" && <KnowledgeTab onOpen={(id) => open("article", id)} categories={categories} />}
        {tab === "reports" && <ReportsTab />}
      </>
    );
  }

  return (
    <>
      {content}
      {changeForm && (
        <ChangeFormModal
          problemId={changeForm.problemId}
          groups={groups}
          categories={categories}
          onClose={() => setChangeForm(null)}
          onSaved={(id) => {
            setChangeForm(null);
            setSearchParams({ tab: "changes", change: String(id) });
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Cola
// ---------------------------------------------------------------------------
const VIEWS: { key: QueueView; label: string }[] = [
  { key: "mine", label: "Asignados a mí" },
  { key: "my-groups", label: "Mis grupos" },
  { key: "unassigned", label: "Sin agente" },
  { key: "breached", label: "SLA vencido" },
  { key: "all", label: "Todos" },
];

const REFRESH_MS = 60_000;

function Queue({
  groups,
  categories,
  catalogItems,
  onOpen,
}: {
  groups: SupportGroup[];
  categories: ServiceCategory[];
  catalogItems: CatalogItem[];
  onOpen: (id: number) => void;
}) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [view, setView] = useState<QueueView>("my-groups");
  const [type, setType] = useState<TicketType | "">("");
  const [priority, setPriority] = useState<Priority | "">("");
  const [groupId, setGroupId] = useState<number | "">("");
  const [search, setSearch] = useState("");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [page, setPage] = useState(1);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [totals, setTotals] = useState({ totalPages: 1, totalItems: 0 });
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params: TicketListParams = {
      page,
      limit: 25,
      view,
      type: type || undefined,
      priority: priority || undefined,
      groupId: groupId === "" ? undefined : groupId,
      search: search.trim() || undefined,
      includeClosed: includeClosed || undefined,
      sortBy: view === "breached" ? "resolutionDueAt" : "priority",
      sortOrder: "asc",
    };
    setLoading((current) => current || tickets.length === 0);
    serviceTicketService
      .list(params)
      .then((res) => {
        if (cancelled) return;
        setTickets(res.items);
        setTotals({ totalPages: res.pagination.totalPages, totalItems: res.pagination.totalItems });
      })
      .catch((error) => !cancelled && handleError(error, navigate))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, type, priority, groupId, includeClosed, page, reload, navigate]);

  // La cola se refresca sola cada minuto (el SLA y los avisos cambian sin que nadie toque la pantalla).
  useEffect(() => {
    const timer = window.setInterval(() => setReload((value) => value + 1), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Vista de la cola">
        {VIEWS.map((item) => (
          <Button
            key={item.key}
            type="button"
            variant={view === item.key ? "primary" : "secondary"}
            onClick={() => {
              setView(item.key);
              setPage(1);
            }}
          >
            {item.label}
          </Button>
        ))}
        {can("service-tickets:update") && (
          <Button type="button" className="ml-auto" onClick={() => setCreating(true)}>
            Registrar ticket
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setReload((value) => value + 1);
          }}
        >
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Número o asunto" aria-label="Buscar tickets" />
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
        </form>
        <Select aria-label="Tipo" value={type} onChange={(e) => { setType(e.target.value as TicketType | ""); setPage(1); }}>
          <option value="">Todos los tipos</option>
          <option value="INCIDENT">{TYPE_LABELS.INCIDENT}</option>
          <option value="SERVICE_REQUEST">{TYPE_LABELS.SERVICE_REQUEST}</option>
        </Select>
        <Select aria-label="Prioridad" value={priority} onChange={(e) => { setPriority(e.target.value as Priority | ""); setPage(1); }}>
          <option value="">Todas las prioridades</option>
          {(Object.keys(PRIORITY_LABELS) as Priority[]).map((value) => (
            <option key={value} value={value}>
              {PRIORITY_LABELS[value]}
            </option>
          ))}
        </Select>
        <Select aria-label="Grupo" value={groupId === "" ? "" : String(groupId)} onChange={(e) => { setGroupId(e.target.value ? Number(e.target.value) : ""); setPage(1); }}>
          <option value="">Todos los grupos</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={includeClosed} onChange={(e) => { setIncludeClosed(e.target.checked); setPage(1); }} />
          Incluir cerrados
        </label>
      </div>
      {loading ? (
        <Loading />
      ) : tickets.length === 0 ? (
        <EmptyState title="No hay tickets en esta vista" description={view === "my-groups" ? "Si no pertenece a ningún grupo, pida que lo agreguen en Configuración Service Desk." : undefined} />
      ) : (
        <>
          <TicketTable tickets={tickets} onOpen={(ticket) => onOpen(ticket.id)} />
          <Pager page={page} totalPages={totals.totalPages} totalItems={totals.totalItems} noun="tickets" onChange={setPage} />
        </>
      )}
      {creating && (
        <AgentCreateModal
          groups={groups}
          categories={categories}
          catalogItems={catalogItems}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            onOpen(id);
          }}
        />
      )}
    </div>
  );
}

function Approvals({ onOpen }: { onOpen: (id: number) => void }) {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    serviceTicketService
      .approvals({ limit: 100 })
      .then((res) => setTickets(res.items))
      .catch((error) => handleError(error, navigate))
      .finally(() => setLoading(false));
  }, [navigate]);

  if (loading) return <Loading />;
  if (tickets.length === 0) return <EmptyState title="Nada por aprobar" description="Las solicitudes del catálogo que requieren su aprobación aparecerán aquí." />;
  return <TicketTable tickets={tickets} onOpen={(ticket) => onOpen(ticket.id)} showAssignee={false} />;
}

// Registro por el agente (telefono, presencial, correo): en nombre de un solicitante.
function AgentCreateModal({
  groups,
  categories,
  catalogItems,
  onClose,
  onCreated,
}: {
  groups: SupportGroup[];
  categories: ServiceCategory[];
  catalogItems: CatalogItem[];
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const navigate = useNavigate();
  const [type, setType] = useState<TicketType>("INCIDENT");
  const [requester, setRequester] = useState<UserOption | null>(null);
  const [channel, setChannel] = useState<Channel>("PHONE");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [catalogItemId, setCatalogItemId] = useState<number | "">("");
  const [variables, setVariables] = useState<Record<string, unknown>>({});
  const [impact, setImpact] = useState(3);
  const [urgency, setUrgency] = useState(2);
  const [groupId, setGroupId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const item = catalogItems.find((candidate) => candidate.id === catalogItemId);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const created = await serviceTicketService.create({
        type,
        title: title.trim(),
        description: description.trim(),
        requesterUserId: requester?.userId,
        channel,
        categoryId: type === "INCIDENT" && categoryId !== "" ? categoryId : null,
        catalogItemId: type === "SERVICE_REQUEST" && catalogItemId !== "" ? catalogItemId : null,
        variables: type === "SERVICE_REQUEST" && item ? Object.fromEntries(Object.entries(variables).filter(([, value]) => value !== undefined && value !== "")) : undefined,
        impact,
        urgency,
        assignedGroupId: groupId === "" ? undefined : groupId,
      });
      showSuccessToast(`Ticket ${created.number} registrado`);
      onCreated(created.id);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title="Registrar ticket"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="button" loading={saving} disabled={!requester || title.trim().length < 5 || description.trim().length < 10} onClick={() => void save()}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium text-slate-700">Solicitante *</p>
          {requester ? (
            <p className="text-sm">
              {requester.fullName} ({requester.username}){" "}
              <button type="button" className="text-brand-700 hover:underline" onClick={() => setRequester(null)}>
                cambiar
              </button>
            </p>
          ) : (
            <UserSearch search={serviceTicketService.searchUsers} onPick={setRequester} />
          )}
        </div>
        <Field label="Tipo" htmlFor="agent-type">
          <Select id="agent-type" value={type} onChange={(e) => { setType(e.target.value as TicketType); setVariables({}); }}>
            <option value="INCIDENT">{TYPE_LABELS.INCIDENT}</option>
            <option value="SERVICE_REQUEST">{TYPE_LABELS.SERVICE_REQUEST}</option>
          </Select>
        </Field>
        <Field label="Canal" htmlFor="agent-channel">
          <Select id="agent-channel" value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            {(["PHONE", "EMAIL", "WALK_IN", "AGENT"] as Channel[]).map((value) => (
              <option key={value} value={value}>
                {CHANNEL_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        {type === "INCIDENT" ? (
          <Field label="Categoría" htmlFor="agent-category">
            <Select id="agent-category" value={categoryId === "" ? "" : String(categoryId)} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Sin categoría</option>
              {categories.filter((category) => category.appliesTo.includes("INCIDENT")).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Servicio del catálogo" htmlFor="agent-item">
            <Select id="agent-item" value={catalogItemId === "" ? "" : String(catalogItemId)} onChange={(e) => { setCatalogItemId(e.target.value ? Number(e.target.value) : ""); setVariables({}); }}>
              <option value="">Sin servicio (solicitud general)</option>
              {catalogItems.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Grupo (vacío = el del servicio o categoría)" htmlFor="agent-group">
          <Select id="agent-group" value={groupId === "" ? "" : String(groupId)} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Automático</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        </Field>
        {item && item.fields.length > 0 && (
          <div className="grid gap-3 rounded-md bg-slate-50 p-3 sm:col-span-2 sm:grid-cols-2">
            {item.fields.map((field) => (
              <DynamicField key={field.key} field={field} value={variables[field.key]} onChange={(value) => setVariables((prev) => ({ ...prev, [field.key]: value }))} />
            ))}
          </div>
        )}
        <div className="sm:col-span-2">
          <Field label="Asunto *" htmlFor="agent-title">
            <Input id="agent-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Descripción *" htmlFor="agent-description">
            <Textarea id="agent-description" rows={4} maxLength={8000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <Field label="Impacto" htmlFor="agent-impact">
          <Select id="agent-impact" value={String(impact)} onChange={(e) => setImpact(Number(e.target.value))}>
            {[1, 2, 3].map((level) => (
              <option key={level} value={level}>
                {LEVEL_LABELS[level]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Urgencia" htmlFor="agent-urgency">
          <Select id="agent-urgency" value={String(urgency)} onChange={(e) => setUrgency(Number(e.target.value))}>
            {[1, 2, 3].map((level) => (
              <option key={level} value={level}>
                {LEVEL_LABELS[level]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
