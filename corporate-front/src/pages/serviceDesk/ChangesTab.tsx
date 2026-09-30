import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { Alert, Button, EmptyState, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { serviceChangeService, serviceTicketService } from "../../services/serviceDeskService";
import type {
  ChangeAction,
  ChangeDetail,
  ChangeOutcome,
  ChangePayload,
  ChangeRisk,
  ChangeSummary,
  ChangeTemplate,
  ChangeType,
  HeldAsset,
  ServiceCategory,
  SupportGroup,
  UserOption,
} from "../../types/serviceDesk";
import { formatDateTime } from "../inventario/inventoryLabels";
import { Pager } from "../contabilidad/Pager";
import { AssetSearch, Badge, BackButton, CARD, Loading, PlainText, Section, TD, TH, UserSearch } from "./components";
import {
  CHANGE_OUTCOME_LABELS,
  CHANGE_RISK_LABELS,
  CHANGE_STATUS_CLASSES,
  CHANGE_STATUS_LABELS,
  CHANGE_TYPE_LABELS,
  EVENT_LABELS,
  LEVEL_LABELS,
  STATUS_LABELS,
} from "./serviceDeskLabels";
import type { TicketStatus } from "../../types/serviceDesk";

// Habilitacion de cambios (plan 009, fase 9D): RFC estandar/normal/emergencia,
// aprobacion del CAB, calendario de cambios con aviso de conflictos y PIR.

const ACTION_LABELS: Record<ChangeAction, string> = {
  submit: "Enviar a evaluación",
  "request-approval": "Pedir aprobación al CAB",
  start: "Iniciar implementación",
  complete: "Registrar resultado",
  close: "Cerrar (PIR)",
  cancel: "Anular",
};

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - day);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function ChangesTab({ onOpen, onCreate }: { onOpen: (id: number) => void; onCreate: () => void }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [mode, setMode] = useState<"list" | "calendar" | "approvals">("list");
  const [changes, setChanges] = useState<ChangeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [page, setPage] = useState(1);
  const [totals, setTotals] = useState({ totalPages: 1, totalItems: 0 });
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));

  useEffect(() => {
    setLoading(true);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000);
    const params =
      mode === "calendar"
        ? { limit: 200, from: weekStart.toISOString(), to: weekEnd.toISOString() }
        : mode === "approvals"
          ? { limit: 100, pendingMine: true }
          : { page, limit: 25, includeClosed };
    serviceChangeService
      .list(params)
      .then((res) => {
        setChanges(res.items);
        setTotals({ totalPages: res.pagination.totalPages, totalItems: res.pagination.totalItems });
      })
      .catch((error) => handleError(error, navigate))
      .finally(() => setLoading(false));
  }, [mode, page, includeClosed, weekStart, navigate]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => new Date(weekStart.getTime() + index * 24 * 3600 * 1000)),
    [weekStart],
  );

  return (
    <div className="space-y-3">
      {/* Movil: accion principal arriba, modos en una fila con scroll y el filtro debajo */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {can("service-changes:create") && (
          <Button type="button" className="w-full shrink-0 sm:order-last sm:ml-auto sm:w-auto" onClick={onCreate}>
            Nuevo cambio (RFC)
          </Button>
        )}
        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 sm:pb-0">
          {(
            [
              ["list", "Listado"],
              ["calendar", "Calendario"],
              ...(can("service-changes:approve") ? [["approvals", "Por aprobar (CAB)"]] : []),
            ] as [typeof mode, string][]
          ).map(([key, label]) => (
            <Button key={key} type="button" variant={mode === key ? "primary" : "secondary"} className="shrink-0 whitespace-nowrap" onClick={() => setMode(key)}>
              {label}
            </Button>
          ))}
        </div>
        {mode === "list" && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={includeClosed} onChange={(e) => { setIncludeClosed(e.target.checked); setPage(1); }} />
            Incluir cerrados
          </label>
        )}
      </div>

      {mode === "calendar" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button type="button" variant="secondary" className="flex-1 whitespace-nowrap sm:flex-none" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * 24 * 3600 * 1000))}>
            ‹ Semana anterior
          </Button>
          <span className="order-first w-full text-center font-medium text-slate-700 sm:order-none sm:w-auto">
            Semana del {weekStart.toLocaleDateString("es-CL")}
          </span>
          <Button type="button" variant="secondary" className="flex-1 whitespace-nowrap sm:flex-none" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000))}>
            Semana siguiente ›
          </Button>
        </div>
      )}

      {loading ? (
        <Loading />
      ) : mode === "calendar" ? (
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((day) => {
            const next = new Date(day.getTime() + 24 * 3600 * 1000);
            const items = changes.filter(
              (change) => change.plannedStart && change.plannedEnd && new Date(change.plannedStart) < next && new Date(change.plannedEnd) > day,
            );
            return (
              <div key={day.toISOString()} className="min-h-16 rounded-md md:min-h-32 border border-slate-200 bg-white p-2">
                <p className="mb-1 text-xs font-semibold text-slate-600">
                  {day.toLocaleDateString("es-CL", { weekday: "short", day: "numeric", month: "short" })}
                </p>
                {items.map((change) => (
                  <button
                    key={change.id}
                    type="button"
                    onClick={() => onOpen(change.id)}
                    className={`mb-1 block w-full rounded px-1 py-0.5 text-left text-xs ${CHANGE_STATUS_CLASSES[change.status]}`}
                  >
                    <span className="font-semibold">{change.number}</span> {change.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ) : changes.length === 0 ? (
        <EmptyState title={mode === "approvals" ? "Nada por aprobar" : "Sin cambios"} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>Número</th>
                  <th className={TH}>Título</th>
                  <th className={TH}>Tipo</th>
                  <th className={TH}>Estado</th>
                  <th className={TH}>Riesgo</th>
                  <th className={TH}>Ventana</th>
                  <th className={TH}>Implementa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {changes.map((change) => (
                  <tr key={change.id}>
                    <td className={`${TD} whitespace-nowrap`}>
                      <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => onOpen(change.id)}>
                        {change.number}
                      </button>
                    </td>
                    <td className={`${TD} min-w-[12rem]`}>{change.title}</td>
                    <td className={`${TD} whitespace-nowrap`}>{CHANGE_TYPE_LABELS[change.type]}</td>
                    <td className={TD}>
                      <Badge className={CHANGE_STATUS_CLASSES[change.status]}>{CHANGE_STATUS_LABELS[change.status]}</Badge>
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{CHANGE_RISK_LABELS[change.risk]}</td>
                    <td className={`${TD} whitespace-nowrap text-xs`}>
                      {formatDateTime(change.plannedStart)}
                      <br />
                      {formatDateTime(change.plannedEnd)}
                    </td>
                    <td className={TD}>
                      <div>{change.assignedGroupName ?? "-"}</div>
                      <div className="text-xs text-slate-500">{change.assigneeName ?? ""}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mode === "list" && <Pager page={page} totalPages={totals.totalPages} totalItems={totals.totalItems} noun="cambios" onChange={setPage} />}
        </>
      )}
    </div>
  );
}

// datetime-local <-> ISO
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function ChangeFormModal({
  change,
  problemId,
  groups,
  categories,
  onClose,
  onSaved,
}: {
  change?: ChangeDetail;
  problemId?: number | null;
  groups: SupportGroup[];
  categories: ServiceCategory[];
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<ChangeTemplate[]>([]);
  const [type, setType] = useState<ChangeType>(change?.type ?? "NORMAL");
  const [templateId, setTemplateId] = useState<number | "">(change?.templateId ?? "");
  const [title, setTitle] = useState(change?.title ?? "");
  const [description, setDescription] = useState(change?.description ?? "");
  const [justification, setJustification] = useState(change?.justification ?? "");
  const [categoryId, setCategoryId] = useState<number | "">(change?.categoryId ?? "");
  const [risk, setRisk] = useState<ChangeRisk>(change?.risk ?? "MEDIUM");
  const [impact, setImpact] = useState(change?.impact ?? 2);
  const [implementationPlan, setImplementationPlan] = useState(change?.implementationPlan ?? "");
  const [backoutPlan, setBackoutPlan] = useState(change?.backoutPlan ?? "");
  const [testPlan, setTestPlan] = useState(change?.testPlan ?? "");
  const [plannedStart, setPlannedStart] = useState(toLocalInput(change?.plannedStart));
  const [plannedEnd, setPlannedEnd] = useState(toLocalInput(change?.plannedEnd));
  const [groupId, setGroupId] = useState<number | "">(change?.assignedGroupId ?? "");
  const [assigneeId, setAssigneeId] = useState<number | "">(change?.assigneeUserId ?? "");
  const [assets, setAssets] = useState<{ assetId: number; tag: string }[]>(change?.assets.map(({ assetId, tag }) => ({ assetId, tag })) ?? []);
  const [saving, setSaving] = useState(false);
  const group = groups.find((candidate) => candidate.id === groupId);
  const isStandard = type === "STANDARD";

  useEffect(() => {
    serviceChangeService.templates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  function applyTemplate(id: number | ""): void {
    setTemplateId(id);
    const template = templates.find((candidate) => candidate.id === id);
    if (!template) return;
    if (!title) setTitle(template.name);
    if (!description) setDescription(template.description ?? template.name);
    setImplementationPlan(template.implementationPlan);
    setBackoutPlan(template.backoutPlan);
    setTestPlan(template.testPlan ?? "");
    if (template.categoryId) setCategoryId(template.categoryId);
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const payload: ChangePayload = {
        title: title.trim(),
        description: description.trim(),
        justification: justification.trim() || null,
        categoryId: categoryId === "" ? null : categoryId,
        risk,
        impact,
        implementationPlan: implementationPlan.trim() || null,
        backoutPlan: backoutPlan.trim() || null,
        testPlan: testPlan.trim() || null,
        plannedStart: fromLocalInput(plannedStart),
        plannedEnd: fromLocalInput(plannedEnd),
        assignedGroupId: groupId === "" ? null : groupId,
        assigneeUserId: assigneeId === "" ? null : assigneeId,
        problemId: change ? change.problemId : (problemId ?? null),
        assetIds: assets.map((asset) => asset.assetId),
      };
      const saved = change
        ? await serviceChangeService.update(change.id, payload)
        : await serviceChangeService.create({ ...payload, type, templateId: isStandard && templateId !== "" ? templateId : null });
      showSuccessToast(change ? "Cambio actualizado" : `Cambio ${saved.number} registrado`);
      onSaved(saved.id);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  const categoryOptions = categories.filter((category) => category.appliesTo.includes("CHANGE"));

  return (
    <Modal
      open
      size="lg"
      title={change ? `Editar ${change.number}` : "Nueva solicitud de cambio (RFC)"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="button" loading={saving} disabled={title.trim().length < 5 || description.trim().length < 10 || (isStandard && templateId === "")} onClick={() => void save()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {!change && (
          <Field label="Tipo de cambio" htmlFor="change-type">
            <Select id="change-type" value={type} onChange={(e) => setType(e.target.value as ChangeType)}>
              {(Object.keys(CHANGE_TYPE_LABELS) as ChangeType[]).map((value) => (
                <option key={value} value={value}>
                  {CHANGE_TYPE_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {isStandard && !change && (
          <Field label="Plantilla preaprobada *" htmlFor="change-template">
            <Select id="change-template" value={templateId === "" ? "" : String(templateId)} onChange={(e) => applyTemplate(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Seleccione…</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {problemId && !change && <p className="text-xs text-slate-500 sm:col-span-2">Se asociará al problema de origen.</p>}
        <div className="sm:col-span-2">
          <Field label="Título *" htmlFor="change-title">
            <Input id="change-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Descripción *" htmlFor="change-description">
            <Textarea id="change-description" rows={3} maxLength={8000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Justificación" htmlFor="change-justification">
            <Textarea id="change-justification" rows={2} maxLength={8000} value={justification} onChange={(e) => setJustification(e.target.value)} />
          </Field>
        </div>
        <Field label="Categoría" htmlFor="change-category">
          <Select id="change-category" value={categoryId === "" ? "" : String(categoryId)} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Sin categoría</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Riesgo" htmlFor="change-risk">
            <Select id="change-risk" value={risk} disabled={isStandard} onChange={(e) => setRisk(e.target.value as ChangeRisk)}>
              {(Object.keys(CHANGE_RISK_LABELS) as ChangeRisk[]).map((value) => (
                <option key={value} value={value}>
                  {CHANGE_RISK_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Impacto" htmlFor="change-impact">
            <Select id="change-impact" value={String(impact)} onChange={(e) => setImpact(Number(e.target.value))}>
              {[1, 2, 3].map((level) => (
                <option key={level} value={level}>
                  {LEVEL_LABELS[level]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Inicio planificado" htmlFor="change-start">
          <Input id="change-start" type="datetime-local" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} />
        </Field>
        <Field label="Fin planificado" htmlFor="change-end">
          <Input id="change-end" type="datetime-local" value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Plan de implementación" htmlFor="change-plan">
            <Textarea id="change-plan" rows={3} maxLength={8000} disabled={isStandard} value={implementationPlan} onChange={(e) => setImplementationPlan(e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Plan de reversa (backout)" htmlFor="change-backout">
            <Textarea id="change-backout" rows={2} maxLength={8000} disabled={isStandard} value={backoutPlan} onChange={(e) => setBackoutPlan(e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Plan de pruebas" htmlFor="change-test">
            <Textarea id="change-test" rows={2} maxLength={8000} disabled={isStandard} value={testPlan} onChange={(e) => setTestPlan(e.target.value)} />
          </Field>
        </div>
        <Field label="Grupo implementador" htmlFor="change-group">
          <Select
            id="change-group"
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
        <Field label="Implementador" htmlFor="change-assignee">
          <Select id="change-assignee" disabled={!group} value={assigneeId === "" ? "" : String(assigneeId)} onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Sin asignar</option>
            {(group?.members ?? []).map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium text-slate-700">Activos afectados</p>
          <AssetSearch
            search={serviceTicketService.searchAssets}
            excludeIds={assets.map((asset) => asset.assetId)}
            onPick={(asset: HeldAsset) => setAssets((prev) => [...prev, { assetId: asset.assetId, tag: asset.tag }])}
          />
          <div className="mt-2 flex flex-wrap gap-1">
            {assets.map((asset) => (
              <span key={asset.assetId} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                {asset.tag}
                <button type="button" aria-label={`Quitar ${asset.tag}`} onClick={() => setAssets((prev) => prev.filter((item) => item.assetId !== asset.assetId))} className="px-1 hover:text-red-600">
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function ChangeDetailView({
  id,
  onBack,
  onOpenTicket,
  onOpenProblem,
  groups,
  categories,
}: {
  id: number;
  onBack: () => void;
  onOpenTicket: (id: number) => void;
  onOpenProblem: (id: number) => void;
  groups: SupportGroup[];
  categories: ServiceCategory[];
}) {
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const [detail, setDetail] = useState<ChangeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<ChangeAction | null>(null);
  const [approvers, setApprovers] = useState<UserOption[]>([]);
  const [outcome, setOutcome] = useState<ChangeOutcome>("SUCCESSFUL");
  const [notes, setNotes] = useState("");
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED" | null>(null);

  async function load(): Promise<void> {
    try {
      setDetail(await serviceChangeService.getById(id));
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

  async function submitAction(): Promise<void> {
    if (!action) return;
    setBusy("action");
    try {
      setDetail(
        await serviceChangeService.action(id, {
          action,
          approverUserIds: action === "request-approval" ? approvers.map((approver) => approver.userId) : undefined,
          outcome: action === "complete" ? outcome : undefined,
          pirNotes: action === "close" ? notes.trim() : undefined,
          comment: action !== "close" ? notes.trim() || undefined : undefined,
        }),
      );
      showSuccessToast("Cambio actualizado");
      setAction(null);
      setNotes("");
      setApprovers([]);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setBusy(null);
    }
  }

  async function submitDecision(): Promise<void> {
    if (!decision) return;
    setBusy("decision");
    try {
      setDetail(await serviceChangeService.decide(id, decision, notes.trim() || undefined));
      showSuccessToast("Decisión registrada");
      setDecision(null);
      setNotes("");
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
        <EmptyState title="Cambio no encontrado" />
      </div>
    );
  }

  const canUpdate = can("service-changes:update");
  const myPending = detail.status === "CAB_APPROVAL" && detail.approvals.some((row) => row.approverUserId === user?.userId && row.decision === null);
  const editable = canUpdate && (detail.status === "DRAFT" || detail.status === "ASSESSMENT");

  return (
    <div>
      <BackButton onBack={onBack} label="Volver a cambios" />
      <div className={`${CARD} mb-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="break-all text-lg font-semibold text-slate-800">{detail.number}</h2>
          <Badge className="bg-slate-100 text-slate-700">{CHANGE_TYPE_LABELS[detail.type]}</Badge>
          <Badge className={CHANGE_STATUS_CLASSES[detail.status]}>{CHANGE_STATUS_LABELS[detail.status]}</Badge>
          <Badge className="bg-slate-100 text-slate-700">Riesgo {CHANGE_RISK_LABELS[detail.risk]}</Badge>
          {detail.outcome && <Badge className="bg-slate-100 text-slate-700">{CHANGE_OUTCOME_LABELS[detail.outcome]}</Badge>}
        </div>
        <p className="mt-2 break-words font-medium text-slate-800">{detail.title}</p>
        <p className="text-sm text-slate-600">
          Solicitado por {detail.requestedByName ?? "-"} · Ventana {formatDateTime(detail.plannedStart)} → {formatDateTime(detail.plannedEnd)}
          {detail.problemNumber && (
            <>
              {" "}
              · Problema{" "}
              <button type="button" className="text-brand-700 hover:underline" onClick={() => onOpenProblem(detail.problemId!)}>
                {detail.problemNumber}
              </button>
            </>
          )}
        </p>
        {detail.conflicts.length > 0 && (
          <div className="mt-3">
            <Alert tone="warning">
              Conflicto de calendario:{" "}
              {detail.conflicts.map((conflict) => `${conflict.number} (${conflict.sharedAssetTags.join(", ")})`).join("; ")} toca los mismos activos en una ventana solapada.
            </Alert>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {myPending && (
            <>
              <Button type="button" variant="success" onClick={() => setDecision("APPROVED")}>
                Aprobar
              </Button>
              <Button type="button" variant="secondary" onClick={() => setDecision("REJECTED")}>
                Rechazar
              </Button>
            </>
          )}
          {editable && (
            <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
              Editar
            </Button>
          )}
          {canUpdate &&
            detail.allowedActions.map((item) => (
              <Button key={item} type="button" variant={item === "cancel" ? "ghost" : "secondary"} onClick={() => setAction(item)}>
                {ACTION_LABELS[item]}
              </Button>
            ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Section title="Descripción">
            <PlainText text={detail.description} />
            {detail.justification && (
              <>
                <h4 className="mt-3 text-sm font-medium text-slate-700">Justificación</h4>
                <PlainText text={detail.justification} />
              </>
            )}
          </Section>
          <Section title="Planes">
            <h4 className="text-sm font-medium text-slate-700">Implementación</h4>
            {detail.implementationPlan ? <PlainText text={detail.implementationPlan} /> : <p className="text-sm text-slate-500">Pendiente.</p>}
            <h4 className="mt-3 text-sm font-medium text-slate-700">Reversa</h4>
            {detail.backoutPlan ? <PlainText text={detail.backoutPlan} /> : <p className="text-sm text-slate-500">Pendiente.</p>}
            <h4 className="mt-3 text-sm font-medium text-slate-700">Pruebas</h4>
            {detail.testPlan ? <PlainText text={detail.testPlan} /> : <p className="text-sm text-slate-500">-</p>}
            {detail.pirNotes && (
              <>
                <h4 className="mt-3 text-sm font-medium text-slate-700">Revisión post implementación</h4>
                <PlainText text={detail.pirNotes} />
              </>
            )}
          </Section>
          <Section title="Historial">
            <ol className="space-y-2 text-sm">
              {[...detail.events].reverse().map((event) => (
                <li key={event.id} className="rounded-md border border-slate-200 px-3 py-2">
                  <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">{EVENT_LABELS[event.eventType] ?? event.eventType}</span>
                    {typeof event.payload.to === "string" && <span>→ {CHANGE_STATUS_LABELS[event.payload.to as ChangeDetail["status"]] ?? event.payload.to}</span>}
                    {typeof event.payload.decision === "string" && <span>{event.payload.decision === "APPROVED" ? "Aprobado" : "Rechazado"}</span>}
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
          <Section title="CAB">
            {detail.approvals.length === 0 ? (
              <p className="text-sm text-slate-500">{detail.type === "STANDARD" ? "Cambio preaprobado (no pasa por CAB)." : "Aún no se pidió aprobación."}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {detail.approvals.map((row) => (
                  <li key={row.approverUserId}>
                    <span className="font-medium">{row.approverName ?? "-"}</span> ·{" "}
                    {row.decision === null ? <span className="text-slate-500">pendiente</span> : row.decision === "APPROVED" ? <span className="text-emerald-700">aprobó</span> : <span className="text-red-700">rechazó</span>}
                    {row.comment && <div className="text-xs text-slate-600">{row.comment}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Activos afectados">
            {detail.assets.length === 0 ? (
              <p className="text-sm text-slate-500">Sin activos.</p>
            ) : (
              <p className="break-words text-sm">{detail.assets.map((asset) => asset.tag).join(", ")}</p>
            )}
          </Section>
          <Section title="Tickets">
            {detail.tickets.length === 0 ? (
              <p className="text-sm text-slate-500">Sin tickets vinculados.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {detail.tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <button type="button" className="text-brand-700 hover:underline" onClick={() => onOpenTicket(ticket.id)}>
                      {ticket.number}
                    </button>{" "}
                    · {STATUS_LABELS[ticket.status as TicketStatus] ?? ticket.status}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {editing && (
        <ChangeFormModal
          change={detail}
          groups={groups}
          categories={categories}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}

      <Modal
        open={action !== null}
        title={action ? ACTION_LABELS[action] : ""}
        onClose={() => setAction(null)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setAction(null)}>
              Volver
            </Button>
            <Button
              type="button"
              loading={busy === "action"}
              disabled={(action === "request-approval" && approvers.length === 0) || (action === "close" && detail.type !== "STANDARD" && !notes.trim())}
              onClick={() => void submitAction()}
            >
              Confirmar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {action === "request-approval" && (
            <>
              <p className="text-sm text-slate-600">
                {detail.type === "EMERGENCY" ? "Cambio de emergencia (ECAB): basta con una aprobación." : "Todos los aprobadores deben aprobar; un rechazo lo rechaza."}
              </p>
              <UserSearch search={serviceTicketService.searchUsers} onPick={(picked) => setApprovers((prev) => (prev.some((item) => item.userId === picked.userId) ? prev : [...prev, picked]))} />
              <div className="flex flex-wrap gap-1">
                {approvers.map((approver) => (
                  <span key={approver.userId} className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800">
                    {approver.fullName}
                    <button type="button" aria-label={`Quitar ${approver.fullName}`} onClick={() => setApprovers((prev) => prev.filter((item) => item.userId !== approver.userId))} className="px-1">
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <p className="text-xs text-slate-500">Cada aprobador debe tener el permiso para aprobar cambios.</p>
            </>
          )}
          {action === "complete" && (
            <Field label="Resultado" htmlFor="change-outcome">
              <Select id="change-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as ChangeOutcome)}>
                {(Object.keys(CHANGE_OUTCOME_LABELS) as ChangeOutcome[]).map((value) => (
                  <option key={value} value={value}>
                    {CHANGE_OUTCOME_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={action === "close" ? `Revisión post implementación${detail.type !== "STANDARD" ? " *" : ""}` : "Comentario (opcional)"} htmlFor="change-notes">
            <Textarea id="change-notes" rows={3} maxLength={8000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={decision !== null}
        title={decision === "APPROVED" ? "Aprobar cambio" : "Rechazar cambio"}
        onClose={() => setDecision(null)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setDecision(null)}>
              Volver
            </Button>
            <Button type="button" loading={busy === "decision"} disabled={decision === "REJECTED" && !notes.trim()} onClick={() => void submitDecision()}>
              Confirmar
            </Button>
          </>
        }
      >
        <Field label={decision === "REJECTED" ? "Motivo *" : "Comentario (opcional)"} htmlFor="decision-notes">
          <Textarea id="decision-notes" rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
