import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { Button, EmptyState, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { showSuccessToast, showWarningToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { serviceProblemService, serviceTicketService } from "../../services/serviceDeskService";
import type { ProblemDetail, ProblemPayload, ProblemStatus, ProblemSummary, ServiceCategory, SupportGroup } from "../../types/serviceDesk";
import { formatDateTime } from "../inventario/inventoryLabels";
import { Pager } from "../contabilidad/Pager";
import { AssetSearch, Badge, BackButton, CARD, Loading, PlainText, PriorityBadge, Section, TD, TH, TicketTable } from "./components";
import { ASSET_STATUS_LABELS, CHANGE_STATUS_LABELS, EVENT_LABELS, LEVEL_LABELS, PROBLEM_ACTIONS, PROBLEM_STATUS_CLASSES, PROBLEM_STATUS_LABELS } from "./serviceDeskLabels";
import type { ChangeStatus } from "../../types/serviceDesk";

// Gestion de problemas (plan 009, fase 9C): causa raiz de incidentes
// recurrentes, error conocido con solucion temporal y resolucion definitiva.

export function ProblemsTab({ onOpen, groups, categories }: { onOpen: (id: number) => void; groups: SupportGroup[]; categories: ServiceCategory[] }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [problems, setProblems] = useState<ProblemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [knownOnly, setKnownOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [totals, setTotals] = useState({ totalPages: 1, totalItems: 0 });
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLoading(true);
    serviceProblemService
      .list({ page, limit: 25, search: search.trim() || undefined, includeClosed, statuses: knownOnly ? "KNOWN_ERROR" : undefined })
      .then((res) => {
        setProblems(res.items);
        setTotals({ totalPages: res.pagination.totalPages, totalItems: res.pagination.totalItems });
      })
      .catch((error) => handleError(error, navigate))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, includeClosed, knownOnly, reload, navigate]);

  return (
    <div className="space-y-3">
      {/* Movil: accion principal arriba, busqueda a ancho completo y filtros debajo */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        {can("service-problems:create") && (
          <Button type="button" className="w-full shrink-0 sm:order-last sm:ml-auto sm:w-auto" onClick={() => setCreating(true)}>
            Nuevo problema
          </Button>
        )}
        <form
          className="flex gap-2 sm:w-auto"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setReload((value) => value + 1);
          }}
        >
          <Input className="min-w-0 flex-1" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por número o título" aria-label="Buscar problemas" />
          <Button type="submit" variant="secondary" className="shrink-0">
            Buscar
          </Button>
        </form>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={knownOnly} onChange={(e) => { setKnownOnly(e.target.checked); setPage(1); }} />
            Solo errores conocidos
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={includeClosed} onChange={(e) => { setIncludeClosed(e.target.checked); setPage(1); }} />
            Incluir cerrados
          </label>
        </div>
      </div>
      {loading ? (
        <Loading />
      ) : problems.length === 0 ? (
        <EmptyState title="Sin problemas" description="Registre un problema cuando un incidente se repite o su causa no es evidente." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>Número</th>
                  <th className={TH}>Título</th>
                  <th className={TH}>Estado</th>
                  <th className={TH}>Prioridad</th>
                  <th className={TH}>Incidentes</th>
                  <th className={TH}>Responsable</th>
                  <th className={TH}>Actualizado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {problems.map((problem) => (
                  <tr key={problem.id}>
                    <td className={`${TD} whitespace-nowrap`}>
                      <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => onOpen(problem.id)}>
                        {problem.number}
                      </button>
                    </td>
                    <td className={`${TD} min-w-[12rem]`}>
                      {problem.title}
                      <div className="text-xs text-slate-500">{problem.categoryName ?? ""}</div>
                    </td>
                    <td className={TD}>
                      <Badge className={PROBLEM_STATUS_CLASSES[problem.status]}>{PROBLEM_STATUS_LABELS[problem.status]}</Badge>
                    </td>
                    <td className={TD}>
                      <PriorityBadge priority={problem.priority} />
                    </td>
                    <td className={TD}>{problem.incidentCount}</td>
                    <td className={`${TD} min-w-[8rem]`}>
                      <div>{problem.assignedGroupName ?? "-"}</div>
                      <div className="text-xs text-slate-500">{problem.assigneeName ?? ""}</div>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{formatDateTime(problem.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} totalPages={totals.totalPages} totalItems={totals.totalItems} noun="problemas" onChange={setPage} />
        </>
      )}
      {creating && (
        <CreateProblemModal
          groups={groups}
          categories={categories}
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

// Alta (y edicion, con "problem") de un problema.
export function CreateProblemModal({
  groups,
  categories,
  initial,
  problem,
  onClose,
  onCreated,
}: {
  groups: SupportGroup[];
  categories: ServiceCategory[];
  initial?: Partial<ProblemPayload>;
  problem?: ProblemDetail;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const navigate = useNavigate();
  const base = problem ?? initial ?? {};
  const [title, setTitle] = useState(base.title ?? "");
  const [description, setDescription] = useState(base.description ?? "");
  const [categoryId, setCategoryId] = useState<number | "">(base.categoryId ?? "");
  const [impact, setImpact] = useState(base.impact ?? 2);
  const [urgency, setUrgency] = useState(base.urgency ?? 2);
  const [groupId, setGroupId] = useState<number | "">(problem?.assignedGroupId ?? "");
  const [assigneeId, setAssigneeId] = useState<number | "">(problem?.assigneeUserId ?? "");
  const [rootCause, setRootCause] = useState(problem?.rootCause ?? "");
  const [workaround, setWorkaround] = useState(problem?.workaround ?? "");
  const [permanentFix, setPermanentFix] = useState(problem?.permanentFix ?? "");
  const [saving, setSaving] = useState(false);
  const group = groups.find((candidate) => candidate.id === groupId);
  const options = categories.filter((category) => category.appliesTo.includes("PROBLEM"));

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const payload: ProblemPayload = {
        title: title.trim(),
        description: description.trim(),
        categoryId: categoryId === "" ? null : categoryId,
        impact,
        urgency,
        assignedGroupId: groupId === "" ? null : groupId,
        assigneeUserId: assigneeId === "" ? null : assigneeId,
        rootCause: rootCause.trim() || null,
        workaround: workaround.trim() || null,
        permanentFix: permanentFix.trim() || null,
      };
      const saved = problem
        ? await serviceProblemService.update(problem.id, payload)
        : await serviceProblemService.create({ ...payload, incidentIds: initial?.incidentIds, assetIds: initial?.assetIds });
      showSuccessToast(problem ? "Problema actualizado" : `Problema ${saved.number} registrado`);
      onCreated(saved.id);
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
      title={problem ? `Editar ${problem.number}` : "Nuevo problema"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="button" loading={saving} disabled={title.trim().length < 5 || description.trim().length < 10} onClick={() => void save()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Título *" htmlFor="problem-title">
            <Input id="problem-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Descripción / síntoma *" htmlFor="problem-description">
            <Textarea id="problem-description" rows={3} maxLength={8000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <Field label="Categoría" htmlFor="problem-category">
          <Select id="problem-category" value={categoryId === "" ? "" : String(categoryId)} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Sin categoría</option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Impacto" htmlFor="problem-impact">
            <Select id="problem-impact" value={String(impact)} onChange={(e) => setImpact(Number(e.target.value))}>
              {[1, 2, 3].map((level) => (
                <option key={level} value={level}>
                  {LEVEL_LABELS[level]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Urgencia" htmlFor="problem-urgency">
            <Select id="problem-urgency" value={String(urgency)} onChange={(e) => setUrgency(Number(e.target.value))}>
              {[1, 2, 3].map((level) => (
                <option key={level} value={level}>
                  {LEVEL_LABELS[level]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Grupo" htmlFor="problem-group">
          <Select
            id="problem-group"
            value={groupId === "" ? "" : String(groupId)}
            onChange={(e) => {
              setGroupId(e.target.value ? Number(e.target.value) : "");
              setAssigneeId("");
            }}
          >
            <option value="">Sin grupo</option>
            {groups.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Responsable" htmlFor="problem-assignee">
          <Select id="problem-assignee" disabled={!group} value={assigneeId === "" ? "" : String(assigneeId)} onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Sin responsable</option>
            {(group?.members ?? []).map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.fullName}
              </option>
            ))}
          </Select>
        </Field>
        {problem && (
          <>
            <div className="sm:col-span-2">
              <Field label="Causa raíz" htmlFor="problem-root">
                <Textarea id="problem-root" rows={3} maxLength={8000} value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Solución temporal (workaround)" htmlFor="problem-workaround">
                <Textarea id="problem-workaround" rows={3} maxLength={8000} value={workaround} onChange={(e) => setWorkaround(e.target.value)} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Solución definitiva" htmlFor="problem-fix">
                <Textarea id="problem-fix" rows={3} maxLength={8000} value={permanentFix} onChange={(e) => setPermanentFix(e.target.value)} />
              </Field>
            </div>
          </>
        )}
        {!problem && initial?.incidentIds && (
          <p className="text-xs text-slate-500 sm:col-span-2">
            Se vinculará el incidente de origen{initial.assetIds?.length ? ` y ${initial.assetIds.length} activo(s)` : ""}.
          </p>
        )}
      </div>
    </Modal>
  );
}

export function ProblemDetailView({
  id,
  onBack,
  onOpenTicket,
  onOpenChange,
  onOpenArticle,
  onCreateChange,
  groups,
  categories,
}: {
  id: number;
  onBack: () => void;
  onOpenTicket: (id: number) => void;
  onOpenChange: (id: number) => void;
  onOpenArticle: (id: number) => void;
  // Abre el alta de un RFC ya asociado a este problema.
  onCreateChange: (problemId: number) => void;
  groups: SupportGroup[];
  categories: ServiceCategory[];
}) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [detail, setDetail] = useState<ProblemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [transition, setTransition] = useState<ProblemStatus | null>(null);
  const [comment, setComment] = useState("");
  const [resolveIncidents, setResolveIncidents] = useState(true);
  const [linkNumber, setLinkNumber] = useState("");
  const [addingAsset, setAddingAsset] = useState(false);
  const canUpdate = can("service-problems:update");

  async function load(): Promise<void> {
    try {
      setDetail(await serviceProblemService.getById(id));
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

  async function run(key: string, action: () => Promise<ProblemDetail | void>, success: string): Promise<boolean> {
    setBusy(key);
    try {
      const result = await action();
      if (result) setDetail(result);
      else await load();
      showSuccessToast(success);
      return true;
    } catch (error) {
      handleError(error, navigate);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function changeStatus(): Promise<void> {
    if (!transition) return;
    setBusy("status");
    try {
      const result = await serviceProblemService.changeStatus(id, transition, comment.trim() || undefined, transition === "RESOLVED" ? resolveIncidents : undefined);
      setDetail(result.problem);
      showSuccessToast(`Problema: ${PROBLEM_STATUS_LABELS[transition]}`);
      if (result.resolvedIncidents.length > 0) showSuccessToast(`Incidentes resueltos: ${result.resolvedIncidents.join(", ")}`);
      if (result.skippedIncidents.length > 0) {
        showWarningToast(`No se resolvieron: ${result.skippedIncidents.map((item) => `${item.number} (${item.reason})`).join("; ")}`);
      }
      setTransition(null);
      setComment("");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setBusy(null);
    }
  }

  // Vincular un incidente por su numero (INC-AAAA-NNNNNN).
  async function linkIncident(): Promise<void> {
    const term = linkNumber.trim().toUpperCase();
    if (!term) return;
    setBusy("link");
    try {
      const res = await serviceTicketService.list({ search: term, type: "INCIDENT", includeClosed: true, limit: 5 });
      const match = res.items.find((ticket) => ticket.number === term);
      if (!match) {
        showWarningToast(`No se encontró el incidente ${term}`);
        return;
      }
      setDetail(await serviceProblemService.linkIncidents(id, [match.id]));
      setLinkNumber("");
      showSuccessToast(`${match.number} vinculado`);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Loading />;
  if (!detail) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <EmptyState title="Problema no encontrado" />
      </div>
    );
  }

  const isFinal = detail.status === "CLOSED" || detail.status === "CANCELLED";

  return (
    <div>
      <BackButton onBack={onBack} label="Volver a problemas" />
      <div className={`${CARD} mb-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="break-all text-lg font-semibold text-slate-800">{detail.number}</h2>
          <Badge className={PROBLEM_STATUS_CLASSES[detail.status]}>{PROBLEM_STATUS_LABELS[detail.status]}</Badge>
          <PriorityBadge priority={detail.priority} />
        </div>
        <p className="mt-2 break-words font-medium text-slate-800">{detail.title}</p>
        <p className="text-sm text-slate-600">
          {detail.categoryName ?? "Sin categoría"} · {detail.assignedGroupName ?? "Sin grupo"}
          {detail.assigneeName ? ` (${detail.assigneeName})` : ""} · Creado {formatDateTime(detail.createdAt)}
        </p>
        {canUpdate && !isFinal && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              Editar análisis
            </Button>
            {detail.allowedTransitions.map((status) => (
              <Button key={status} type="button" variant={status === "RESOLVED" ? "success" : status === "CANCELLED" ? "ghost" : "secondary"} onClick={() => setTransition(status)}>
                {PROBLEM_ACTIONS[status]}
              </Button>
            ))}
            {!detail.kbArticleId && (detail.workaround || detail.permanentFix) && can("kb-articles:create") && (
              <Button
                type="button"
                variant="ghost"
                loading={busy === "kb"}
                onClick={() =>
                  void run(
                    "kb",
                    async () => {
                      const { articleId } = await serviceProblemService.draftKb(id);
                      onOpenArticle(articleId);
                    },
                    "Borrador de artículo creado",
                  )
                }
              >
                Documentar en conocimiento
              </Button>
            )}
            {can("service-changes:create") && detail.status !== "NEW" && (
              <Button type="button" variant="ghost" onClick={() => onCreateChange(id)}>
                Crear RFC
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Section title="Análisis">
            <h4 className="text-sm font-medium text-slate-700">Síntoma</h4>
            <PlainText text={detail.description} />
            <h4 className="mt-3 text-sm font-medium text-slate-700">Causa raíz</h4>
            {detail.rootCause ? <PlainText text={detail.rootCause} /> : <p className="text-sm text-slate-500">Sin identificar.</p>}
            <h4 className="mt-3 text-sm font-medium text-slate-700">Solución temporal</h4>
            {detail.workaround ? <PlainText text={detail.workaround} /> : <p className="text-sm text-slate-500">-</p>}
            <h4 className="mt-3 text-sm font-medium text-slate-700">Solución definitiva</h4>
            {detail.permanentFix ? <PlainText text={detail.permanentFix} /> : <p className="text-sm text-slate-500">-</p>}
            {detail.kbArticleId && (
              <button type="button" className="mt-3 text-sm text-brand-700 hover:underline" onClick={() => onOpenArticle(detail.kbArticleId!)}>
                Ver artículo de conocimiento
              </button>
            )}
          </Section>

          <Section title={`Incidentes (${detail.incidents.length})`}>
            {canUpdate && !isFinal && (
              <div className="mb-3 flex gap-2">
                <Input className="min-w-0 flex-1" value={linkNumber} onChange={(e) => setLinkNumber(e.target.value)} placeholder="INC202602000123" aria-label="Número de incidente" />
                <Button type="button" variant="secondary" className="shrink-0" loading={busy === "link"} onClick={() => void linkIncident()}>
                  Vincular
                </Button>
              </div>
            )}
            {detail.incidents.length === 0 ? (
              <p className="text-sm text-slate-500">Sin incidentes vinculados.</p>
            ) : (
              <TicketTable tickets={detail.incidents} onOpen={(ticket) => onOpenTicket(ticket.id)} />
            )}
          </Section>

          <Section title="Historial">
            <ol className="space-y-2 text-sm">
              {[...detail.events].reverse().map((event) => (
                <li key={event.id} className="rounded-md border border-slate-200 px-3 py-2">
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">{EVENT_LABELS[event.eventType] ?? event.eventType}</span>
                    {typeof event.payload.to === "string" && <span>→ {PROBLEM_STATUS_LABELS[event.payload.to as ProblemStatus] ?? event.payload.to}</span>}
                    <span className="ml-auto text-right">
                      {event.actorName ?? "Sistema"} · {formatDateTime(event.createdAt)}
                    </span>
                  </div>
                  <PlainText text={event.body} />
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="min-w-0">
          <Section
            title="Activos"
            actions={
              canUpdate && !isFinal && (
                <Button type="button" variant="ghost" onClick={() => setAddingAsset((prev) => !prev)}>
                  {addingAsset ? "Cerrar" : "Vincular"}
                </Button>
              )
            }
          >
            {addingAsset && (
              <div className="mb-3">
                <AssetSearch
                  search={serviceTicketService.searchAssets}
                  excludeIds={detail.assets.map((asset) => asset.assetId)}
                  onPick={(asset) => void run("asset", () => serviceProblemService.linkAssets(id, [asset.assetId]), `${asset.tag} vinculado`)}
                />
              </div>
            )}
            {detail.assets.length === 0 ? (
              <p className="text-sm text-slate-500">Sin activos.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {detail.assets.map((asset) => (
                  <li key={asset.assetId} className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-semibold">{asset.tag}</span> · {ASSET_STATUS_LABELS[asset.statusCode] ?? asset.statusCode}
                    </span>
                    {canUpdate && !isFinal && (
                      <button type="button" className="shrink-0 p-2 text-xs text-slate-500 hover:text-red-600" onClick={() => void run("asset", () => serviceProblemService.unlinkAsset(id, asset.assetId), `${asset.tag} desvinculado`)}>
                        Quitar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Cambios">
            {detail.changes.length === 0 ? (
              <p className="text-sm text-slate-500">Sin cambios asociados.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {detail.changes.map((change) => (
                  <li key={change.id}>
                    <button type="button" className="text-brand-700 hover:underline" onClick={() => onOpenChange(change.id)}>
                      {change.number}
                    </button>{" "}
                    · {CHANGE_STATUS_LABELS[change.status as ChangeStatus] ?? change.status}
                    <div className="text-xs text-slate-600">{change.title}</div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {editing && (
        <CreateProblemModal
          groups={groups}
          categories={categories}
          problem={detail}
          onClose={() => setEditing(false)}
          onCreated={() => {
            setEditing(false);
            void load();
          }}
        />
      )}

      <Modal
        open={transition !== null}
        title={transition ? PROBLEM_ACTIONS[transition] : ""}
        onClose={() => setTransition(null)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setTransition(null)}>
              Volver
            </Button>
            <Button type="button" loading={busy === "status"} onClick={() => void changeStatus()}>
              Confirmar
            </Button>
          </>
        }
      >
        {transition === "KNOWN_ERROR" && (
          <p className="mb-2 text-sm text-slate-600">La causa raíz y la solución temporal quedarán como nota interna en los incidentes abiertos vinculados.</p>
        )}
        {transition === "RESOLVED" && (
          <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={resolveIncidents} onChange={(e) => setResolveIncidents(e.target.checked)} />
            Resolver también los incidentes abiertos vinculados
          </label>
        )}
        <Field label="Comentario (opcional)" htmlFor="problem-comment">
          <Textarea id="problem-comment" rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
