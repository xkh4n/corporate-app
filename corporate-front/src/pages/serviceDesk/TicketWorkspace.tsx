import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { Alert, Button, EmptyState, Field, Modal, Select, Textarea } from "../../components/ui";
import { showSuccessToast, showWarningToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { downloadBlob } from "../../lib/downloadBlob";
import { kbArticleService, serviceTicketService } from "../../services/serviceDeskService";
import type {
  OnHoldReason,
  ResolutionCode,
  ServiceCategory,
  SupportGroup,
  TicketAsset,
  TicketDetail,
  TicketRelated,
  TicketStatus,
} from "../../types/serviceDesk";
import { formatDateTime } from "../inventario/inventoryLabels";
import {
  AssetSearch,
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
  Timeline,
} from "./components";
import { CreateProblemModal } from "./ProblemsTab";
import { RoomAccessPanel } from "./RoomAccessPanel";
import {
  ASSET_STATUS_LABELS,
  CHANGE_STATUS_LABELS,
  CHANNEL_LABELS,
  humanizeKey,
  LEVEL_LABELS,
  ON_HOLD_LABELS,
  PROBLEM_STATUS_LABELS,
  RESOLUTION_LABELS,
  STATUS_LABELS,
  TRANSITION_ACTIONS,
  TYPE_LABELS,
  formatDue,
} from "./serviceDeskLabels";
import type { ChangeStatus, ProblemStatus } from "../../types/serviceDesk";

// Workspace del agente sobre un ticket (plan 009): clasificacion, asignacion y
// escalamiento, estados con SLA, conversacion y notas internas, adjuntos,
// aprobacion, activos (enviar a soporte / devolver) y gestion relacionada.

type StatusModal = { status: TicketStatus } | null;

export function TicketWorkspace({
  id,
  onBack,
  onOpenTicket,
  onOpenProblem,
  onOpenChange,
  groups,
  categories,
}: {
  id: number;
  onBack: () => void;
  onOpenTicket: (id: number) => void;
  onOpenProblem: (id: number) => void;
  onOpenChange: (id: number) => void;
  groups: SupportGroup[];
  categories: ServiceCategory[];
}) {
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [related, setRelated] = useState<TicketRelated | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [statusModal, setStatusModal] = useState<StatusModal>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [problemOpen, setProblemOpen] = useState(false);
  const [approval, setApproval] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [approvalComment, setApprovalComment] = useState("");

  const canUpdate = can("service-tickets:update");
  const canMoveAssets = canUpdate && can("asset-movements:create");

  async function load(): Promise<void> {
    try {
      const [ticket, rel] = await Promise.all([serviceTicketService.getById(id), serviceTicketService.related(id)]);
      setDetail(ticket);
      setRelated(rel);
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

  async function run(key: string, action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(key);
    try {
      const result = await action();
      if (result && typeof result === "object" && "number" in result && "events" in result) setDetail(result as TicketDetail);
      else await load();
      showSuccessToast(success);
      void serviceTicketService.related(id).then(setRelated).catch(() => undefined);
      return true;
    } catch (error) {
      handleError(error, navigate);
      void load();
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File): Promise<void> {
    await run("upload", () => serviceTicketService.uploadAttachment(id, file, !isPublic), isPublic ? "Adjunto agregado" : "Adjunto interno agregado");
  }

  async function download(attachmentId: number, name: string): Promise<void> {
    try {
      downloadBlob(await serviceTicketService.downloadAttachment(id, attachmentId), name);
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
  const isOpen = !isFinal && detail.status !== "RESOLVED";
  const myGroupIds = groups.filter((group) => group.members.some((member) => member.userId === user?.userId)).map((group) => group.id);
  const canTake = canUpdate && isOpen && detail.status !== "PENDING_APPROVAL" && detail.assigneeUserId !== user?.userId && myGroupIds.length > 0;
  const approverGroup = groups.find((group) => group.id === detail.approvalGroupId);
  const canApprove =
    detail.status === "PENDING_APPROVAL" &&
    can("service-tickets:approve") &&
    detail.requesterUserId !== user?.userId &&
    // La API exige ser miembro del grupo aprobador (tambien al admin): solo se ofrece a quien puede.
    (approverGroup?.members.some((member) => member.userId === user?.userId) ?? false);

  return (
    <div>
      <BackButton onBack={onBack} label="Volver a la cola" />

      <div className={`${CARD} mb-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-800">{detail.number}</h2>
          <Badge className="bg-slate-100 text-slate-700">{TYPE_LABELS[detail.type]}</Badge>
          <StatusBadge status={detail.status} />
          {detail.onHoldReason && <Badge className="bg-amber-50 text-amber-800">{ON_HOLD_LABELS[detail.onHoldReason]}</Badge>}
          <PriorityBadge priority={detail.priority} />
          {detail.isMajor && <Badge className="bg-red-600 text-white">Incidente mayor</Badge>}
          <SlaBadge state={detail.slaState} dueAt={detail.resolutionDueAt} />
          {detail.reopenCount > 0 && <Badge className="bg-orange-100 text-orange-800">Reabierto {detail.reopenCount}×</Badge>}
        </div>
        <p className="mt-2 font-medium text-slate-800">{detail.title}</p>

        {canUpdate && !isFinal && (
          <div className="mt-4 flex flex-wrap gap-2">
            {canTake && (
              <Button type="button" loading={busy === "take"} onClick={() => void run("take", () => serviceTicketService.take(id), "Ticket tomado")}>
                Tomar
              </Button>
            )}
            {isOpen && detail.status !== "PENDING_APPROVAL" && (
              <Button type="button" variant="secondary" onClick={() => setAssignOpen(true)}>
                Asignar / escalar
              </Button>
            )}
            {detail.allowedTransitions
              .filter((status) => TRANSITION_ACTIONS[status])
              .map((status) => (
                <Button
                  key={status}
                  type="button"
                  variant={status === "RESOLVED" ? "success" : status === "CANCELLED" ? "ghost" : "secondary"}
                  onClick={() => setStatusModal({ status })}
                >
                  {detail.status === "RESOLVED" && status === "IN_PROGRESS" ? "Reabrir" : detail.status === "ON_HOLD" && status === "IN_PROGRESS" ? "Retomar" : TRANSITION_ACTIONS[status]}
                </Button>
              ))}
            {isOpen && (
              <Button type="button" variant="ghost" onClick={() => setClassifyOpen(true)}>
                Reclasificar
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {canApprove && (
            <Section title="Aprobación pendiente">
              <p className="mb-2 text-sm text-slate-700">
                {detail.roomAccess
                  ? "El Service Desk validó este acceso a sala: revise la sala, el beneficiario, el motivo y el período antes de decidir."
                  : "Esta solicitud espera la decisión de su grupo aprobador."}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="success" onClick={() => setApproval("APPROVED")}>
                  Aprobar
                </Button>
                <Button type="button" variant="secondary" onClick={() => setApproval("REJECTED")}>
                  Rechazar
                </Button>
              </div>
            </Section>
          )}

          <RoomAccessPanel
            detail={detail}
            canValidate={canUpdate && detail.assigneeUserId === user?.userId}
            onUpdated={(ticket) => {
              setDetail(ticket);
              void serviceTicketService.related(id).then(setRelated).catch(() => undefined);
            }}
          />

          <Section title="Descripción">
            <PlainText text={detail.description} />
            {Object.keys(detail.variables).length > 0 && (
              <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
                {Object.entries(detail.variables).map(([key, value]) => (
                  <div key={key}>
                    <dt className="inline font-medium text-slate-600">{humanizeKey(key)}: </dt>
                    <dd className="inline text-slate-800">{typeof value === "boolean" ? (value ? "Sí" : "No") : String(value)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {detail.resolutionNotes && (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-sm font-medium text-emerald-900">
                  Resolución: {detail.resolutionCode ? RESOLUTION_LABELS[detail.resolutionCode] : ""}
                </p>
                <PlainText text={detail.resolutionNotes} />
              </div>
            )}
            {detail.csatScore && (
              <p className="mt-2 text-sm text-slate-600">
                Satisfacción: {"★".repeat(detail.csatScore)}
                {"☆".repeat(5 - detail.csatScore)} {detail.csatComment ? `· ${detail.csatComment}` : ""}
              </p>
            )}
          </Section>

          <Section title="Actividad">
            {canUpdate && !isFinal && (
              <div className="mb-4 space-y-2">
                <div role="radiogroup" aria-label="Visibilidad" className="flex gap-2 text-sm">
                  <label className={`cursor-pointer rounded-md border px-3 py-1 ${isPublic ? "border-brand-600 bg-sky-50" : "border-slate-200"}`}>
                    <input type="radio" className="sr-only" checked={isPublic} onChange={() => setIsPublic(true)} />
                    Respuesta al solicitante
                  </label>
                  <label className={`cursor-pointer rounded-md border px-3 py-1 ${!isPublic ? "border-amber-500 bg-amber-50" : "border-slate-200"}`}>
                    <input type="radio" className="sr-only" checked={!isPublic} onChange={() => setIsPublic(false)} />
                    Nota interna
                  </label>
                </div>
                <Textarea
                  rows={3}
                  maxLength={8000}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  aria-label={isPublic ? "Respuesta al solicitante" : "Nota interna"}
                  className={isPublic ? "bg-zinc-100 focus:bg-indigo-100" : "bg-amber-50"}
                  placeholder={isPublic ? "El solicitante verá este mensaje y recibirá un correo" : "Solo visible para los agentes"}
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <AttachButton onFile={(file) => void upload(file)} loading={busy === "upload"} label={isPublic ? "Adjuntar" : "Adjuntar (interno)"} />
                  <Button
                    type="button"
                    loading={busy === "comment"}
                    disabled={!comment.trim()}
                    onClick={() =>
                      void run("comment", () => serviceTicketService.comment(id, comment.trim(), isPublic), isPublic ? "Respuesta enviada" : "Nota agregada").then(
                        (ok) => ok && setComment(""),
                      )
                    }
                  >
                    {isPublic ? "Responder" : "Guardar nota"}
                  </Button>
                </div>
              </div>
            )}
            <Timeline events={detail.events} />
          </Section>

          <Section title="Adjuntos">
            <AttachmentList attachments={detail.attachments} onDownload={(attachment) => void download(attachment.id, attachment.originalName)} />
          </Section>
        </div>

        <div>
          <Section title="SLA">
            <dl className="space-y-1 text-sm">
              <SlaRow label="Primera respuesta" due={detail.responseDueAt} done={detail.firstResponseAt} breached={detail.responseBreached} />
              <SlaRow label="Resolución" due={detail.resolutionDueAt} done={detail.resolvedAt} breached={detail.resolutionBreached} />
              {detail.onHoldSince && (
                <div className="text-amber-700">Pausado desde {formatDateTime(detail.onHoldSince)}</div>
              )}
              {detail.autoCloseAt && detail.status === "RESOLVED" && (
                <div className="text-slate-600">Cierre automático: {formatDateTime(detail.autoCloseAt)}</div>
              )}
            </dl>
          </Section>

          <Section title="Detalles">
            <dl className="space-y-1 text-sm">
              <Row label="Solicitante" value={detail.requesterName} />
              <Row label="Canal" value={CHANNEL_LABELS[detail.channel]} />
              <Row label="Categoría" value={detail.categoryName ?? "-"} />
              {detail.catalogItemName && <Row label="Servicio" value={detail.catalogItemName} />}
              {detail.purchaseRequest && (
                <Row
                  label="Solicitud de compra"
                  value={`${detail.purchaseRequest.number ?? `#${detail.purchaseRequest.id}`} · ${detail.purchaseRequest.statusLabel ?? "sin estado"}`}
                />
              )}
              <Row label="Impacto / urgencia" value={`${LEVEL_LABELS[detail.impact]} / ${LEVEL_LABELS[detail.urgency]}`} />
              <Row label="Grupo" value={detail.assignedGroupName ?? "Sin grupo"} />
              <Row label="Agente" value={detail.assigneeName ?? "Sin agente"} />
              <Row label="Creado" value={formatDateTime(detail.createdAt)} />
            </dl>
            {detail.approvals.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-slate-600">
                {detail.approvals.map((item) => (
                  <li key={item.approverUserId}>
                    {item.decision === "APPROVED" ? "Aprobada" : "Rechazada"} por {item.approverName ?? "-"} · {formatDateTime(item.decidedAt)}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <AssetsPanel
            ticket={detail}
            editable={canUpdate && isOpen}
            canMove={canMoveAssets && isOpen}
            busy={busy}
            run={run}
          />

          {related && (
            <RelatedPanel
              ticket={detail}
              related={related}
              canUpdate={canUpdate && !isFinal}
              onOpenTicket={onOpenTicket}
              onOpenProblem={onOpenProblem}
              onOpenChange={onOpenChange}
              onCreateProblem={() => setProblemOpen(true)}
              run={run}
            />
          )}
        </div>
      </div>

      {statusModal && (
        <StatusChangeModal
          status={statusModal.status}
          from={detail.status}
          onClose={() => setStatusModal(null)}
          onSubmit={(body) =>
            run("status", () => serviceTicketService.changeStatus(id, { status: statusModal.status, ...body }), `Ticket: ${STATUS_LABELS[statusModal.status]}`).then(
              (ok) => ok && setStatusModal(null),
            )
          }
          loading={busy === "status"}
        />
      )}

      {assignOpen && (
        <AssignModal
          groups={groups}
          currentGroupId={detail.assignedGroupId}
          currentAssigneeId={detail.assigneeUserId}
          loading={busy === "assign"}
          onClose={() => setAssignOpen(false)}
          onSubmit={(groupId, assigneeUserId) =>
            run("assign", () => serviceTicketService.assign(id, groupId, assigneeUserId), "Asignación actualizada").then((ok) => ok && setAssignOpen(false))
          }
        />
      )}

      {classifyOpen && (
        <ClassifyModal
          ticket={detail}
          categories={categories}
          loading={busy === "classify"}
          onClose={() => setClassifyOpen(false)}
          onSubmit={(body) => run("classify", () => serviceTicketService.classify(id, body), "Ticket reclasificado").then((ok) => ok && setClassifyOpen(false))}
        />
      )}

      <Modal
        open={approval !== null}
        title={approval === "APPROVED" ? "Aprobar solicitud" : "Rechazar solicitud"}
        onClose={() => setApproval(null)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setApproval(null)}>
              Volver
            </Button>
            <Button
              type="button"
              variant={approval === "APPROVED" ? "success" : "primary"}
              loading={busy === "approval"}
              disabled={approval === "REJECTED" && !approvalComment.trim()}
              onClick={() =>
                void run("approval", () => serviceTicketService.decide(id, approval!, approvalComment.trim() || undefined), "Decisión registrada").then((ok) => {
                  if (ok) {
                    setApproval(null);
                    setApprovalComment("");
                  }
                })
              }
            >
              Confirmar
            </Button>
          </>
        }
      >
        <Field label={approval === "REJECTED" ? "Motivo del rechazo *" : "Comentario (opcional)"} htmlFor="approval-comment">
          <Textarea id="approval-comment" rows={3} maxLength={500} value={approvalComment} onChange={(e) => setApprovalComment(e.target.value)} />
        </Field>
      </Modal>

      {problemOpen && (
        <CreateProblemModal
          groups={groups}
          categories={categories}
          initial={{
            title: detail.title,
            description: detail.description,
            categoryId: detail.categoryId,
            impact: detail.impact,
            urgency: detail.urgency,
            incidentIds: [detail.id],
            assetIds: detail.assets.map((asset) => asset.assetId),
          }}
          onClose={() => setProblemOpen(false)}
          onCreated={(problemId) => {
            setProblemOpen(false);
            onOpenProblem(problemId);
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-800">{value}</dd>
    </div>
  );
}

function SlaRow({ label, due, done, breached }: { label: string; due: string | null; done: string | null; breached: boolean }) {
  return (
    <div>
      <dt className="font-medium text-slate-700">{label}</dt>
      <dd className={breached ? "text-red-700" : "text-slate-700"}>
        {!due
          ? "Sin SLA (pendiente de aprobación)"
          : done
            ? `${breached ? "Fuera de plazo" : "En plazo"} · ${formatDateTime(done)}`
            : `${formatDue(due)} (${formatDateTime(due)})`}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activos del ticket
// ---------------------------------------------------------------------------
function AssetsPanel({
  ticket,
  editable,
  canMove,
  busy,
  run,
}: {
  ticket: TicketDetail;
  editable: boolean;
  canMove: boolean;
  busy: string | null;
  run: (key: string, action: () => Promise<unknown>, success: string) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);

  function confirmSend(asset: TicketAsset): void {
    const message = `¿Enviar ${asset.tag} a soporte?\n\nEl activo quedará "En soporte"${asset.holderName ? ` y dejará de estar en manos de ${asset.holderName} hasta que se devuelva` : ""}.`;
    if (!window.confirm(message)) return;
    void run(`send-${asset.assetId}`, () => serviceTicketService.sendAssetToSupport(ticket.id, asset.assetId), `${asset.tag} enviado a soporte`);
  }

  function confirmReturn(asset: TicketAsset, target: "HOLDER" | "STOCK"): void {
    const message = target === "HOLDER" ? `¿Devolver ${asset.tag} a ${asset.holderName ?? "su custodio"}?` : `¿Devolver ${asset.tag} a bodega (disponible)?`;
    if (!window.confirm(message)) return;
    void run(`return-${asset.assetId}`, () => serviceTicketService.returnAsset(ticket.id, asset.assetId, target), `${asset.tag} devuelto`);
  }

  return (
    <Section
      title="Activos"
      actions={
        editable && (
          <Button type="button" variant="ghost" onClick={() => setAdding((prev) => !prev)}>
            {adding ? "Cerrar" : "Vincular"}
          </Button>
        )
      }
    >
      {adding && (
        <div className="mb-3">
          <AssetSearch
            search={serviceTicketService.searchAssets}
            excludeIds={ticket.assets.map((asset) => asset.assetId)}
            onPick={(asset) => void run("link", () => serviceTicketService.linkAssets(ticket.id, [asset.assetId]), `${asset.tag} vinculado`)}
          />
        </div>
      )}
      {ticket.assets.length === 0 ? (
        <p className="text-sm text-slate-500">Sin activos vinculados.</p>
      ) : (
        <ul className="space-y-3">
          {ticket.assets.map((asset) => (
            <li key={asset.assetId} className="rounded-md border border-slate-200 p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-800">{asset.tag}</span>
                <Badge className={asset.inSupport ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}>
                  {ASSET_STATUS_LABELS[asset.statusCode] ?? asset.statusCode}
                </Badge>
                {asset.recentIncidentCount >= 3 && (
                  <Badge className="bg-red-100 text-red-800">{asset.recentIncidentCount} incidentes en 90 días</Badge>
                )}
              </div>
              <div className="text-xs text-slate-500">
                {asset.productName ?? "-"} · S/N {asset.serialNumber ?? "-"}
                {asset.holderName && ` · Custodio: ${asset.holderName}`}
              </div>
              {canMove && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {asset.inSupport ? (
                    <>
                      {asset.holderUserId && (
                        <Button type="button" variant="secondary" className="px-2 py-1 text-xs" loading={busy === `return-${asset.assetId}`} onClick={() => confirmReturn(asset, "HOLDER")}>
                          Devolver al custodio
                        </Button>
                      )}
                      <Button type="button" variant="secondary" className="px-2 py-1 text-xs" loading={busy === `return-${asset.assetId}`} onClick={() => confirmReturn(asset, "STOCK")}>
                        Devolver a bodega
                      </Button>
                    </>
                  ) : (
                    (asset.statusCode === "ASSIGNED" || asset.statusCode === "AVAILABLE") && (
                      <Button type="button" variant="secondary" className="px-2 py-1 text-xs" loading={busy === `send-${asset.assetId}`} onClick={() => confirmSend(asset)}>
                        Enviar a soporte
                      </Button>
                    )
                  )}
                  {!asset.supportMovementId && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => void run("unlink", () => serviceTicketService.unlinkAsset(ticket.id, asset.assetId), `${asset.tag} desvinculado`)}
                    >
                      Quitar
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {ticket.assets.some((asset) => asset.inSupport) && (
        <p className="mt-2 text-xs text-amber-700">Devuelva los activos en soporte antes de resolver el ticket.</p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Gestion relacionada
// ---------------------------------------------------------------------------
function RelatedPanel({
  ticket,
  related,
  canUpdate,
  onOpenTicket,
  onOpenProblem,
  onOpenChange,
  onCreateProblem,
  run,
}: {
  ticket: TicketDetail;
  related: TicketRelated;
  canUpdate: boolean;
  onOpenTicket: (id: number) => void;
  onOpenProblem: (id: number) => void;
  onOpenChange: (id: number) => void;
  onCreateProblem: () => void;
  run: (key: string, action: () => Promise<unknown>, success: string) => Promise<boolean>;
}) {
  const { can } = useAuth();
  const canProblems = can("service-problems:read");
  const canChanges = can("service-changes:read");
  const recurring = ticket.assets.some((asset) => asset.recentIncidentCount >= 3);

  return (
    <Section title="Relacionados">
      <div className="space-y-4 text-sm">
        <div>
          <h4 className="font-medium text-slate-700">Problema</h4>
          {related.problem ? (
            <div>
              <button type="button" disabled={!canProblems} onClick={() => onOpenProblem(related.problem!.id)} className="text-brand-700 hover:underline disabled:text-slate-700 disabled:no-underline">
                {related.problem.number}
              </button>{" "}
              · {PROBLEM_STATUS_LABELS[related.problem.status as ProblemStatus] ?? related.problem.status}
              <div className="text-xs text-slate-600">{related.problem.title}</div>
              {related.problem.workaround && (
                <div className="mt-1 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
                  <strong>Solución temporal:</strong> <PlainText text={related.problem.workaround} className="text-xs" />
                </div>
              )}
            </div>
          ) : (
            <div className="text-slate-500">
              Sin problema vinculado.
              {ticket.type === "INCIDENT" && canUpdate && can("service-problems:create") && (
                <div className="mt-1">
                  {recurring && <Alert tone="warning">Un activo de este ticket tiene incidentes recurrentes.</Alert>}
                  <Button type="button" variant="ghost" className="mt-1 px-2 py-1 text-xs" onClick={onCreateProblem}>
                    Crear problema desde este incidente
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {canChanges && related.changes.length > 0 && (
          <div>
            <h4 className="font-medium text-slate-700">Cambios</h4>
            <ul>
              {related.changes.map((change) => (
                <li key={change.id}>
                  <button type="button" onClick={() => onOpenChange(change.id)} className="text-brand-700 hover:underline">
                    {change.number}
                  </button>{" "}
                  · {CHANGE_STATUS_LABELS[change.status as ChangeStatus] ?? change.status}
                  <div className="text-xs text-slate-600">{change.title}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h4 className="font-medium text-slate-700">Conocimiento</h4>
          {related.kbArticles.length === 0 && related.suggestedArticles.length === 0 && <p className="text-slate-500">Sin artículos.</p>}
          <ul className="space-y-1">
            {related.kbArticles.map((article) => (
              <li key={article.id}>
                {article.number} · {article.title} {article.usedToResolve && <Badge className="bg-emerald-100 text-emerald-800">Solución</Badge>}
              </li>
            ))}
          </ul>
          {related.suggestedArticles.length > 0 && (
            <>
              <p className="mt-2 text-xs font-medium text-slate-500">Sugeridos</p>
              <ul className="space-y-2">
                {related.suggestedArticles.map((article) => (
                  <li key={article.id}>
                    <span className="font-medium">{article.title}</span>
                    <p className="line-clamp-2 text-xs text-slate-600">{article.snippet}</p>
                    {canUpdate && (
                      <div className="mt-1 flex gap-1">
                        <Button type="button" variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => void run("kb", () => kbArticleService.linkToTicket(article.id, ticket.id, false), "Artículo vinculado")}>
                          Vincular
                        </Button>
                        <Button type="button" variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => void run("kb", () => kbArticleService.linkToTicket(article.id, ticket.id, true), "Artículo marcado como solución")}>
                          Usar como solución
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {related.sameAssetTickets.length > 0 && (
          <div>
            <h4 className="font-medium text-slate-700">Otros tickets de estos activos</h4>
            <ul className="space-y-1">
              {related.sameAssetTickets.map((other) => (
                <li key={other.id}>
                  <button type="button" onClick={() => onOpenTicket(other.id)} className="text-brand-700 hover:underline">
                    {other.number}
                  </button>{" "}
                  · {STATUS_LABELS[other.status as TicketStatus] ?? other.status} · {other.tags.join(", ")}
                  <div className="text-xs text-slate-600">{other.title}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Modales
// ---------------------------------------------------------------------------
function StatusChangeModal({
  status,
  from,
  onClose,
  onSubmit,
  loading,
}: {
  status: TicketStatus;
  from: TicketStatus;
  onClose: () => void;
  onSubmit: (body: { onHoldReason?: OnHoldReason; resolutionCode?: ResolutionCode; resolutionNotes?: string; comment?: string }) => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState<OnHoldReason>("AWAITING_USER");
  const [code, setCode] = useState<ResolutionCode>("FIXED");
  const [notes, setNotes] = useState("");
  const [comment, setComment] = useState("");
  const title = from === "RESOLVED" && status === "IN_PROGRESS" ? "Reabrir ticket" : (TRANSITION_ACTIONS[status] ?? STATUS_LABELS[status]);
  const invalid = status === "RESOLVED" && notes.trim().length < 5;

  function submit(): void {
    if (status === "RESOLVED") onSubmit({ resolutionCode: code, resolutionNotes: notes.trim() });
    else if (status === "ON_HOLD") onSubmit({ onHoldReason: reason, comment: comment.trim() || undefined });
    else onSubmit({ comment: comment.trim() || undefined });
  }

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="button" loading={loading} disabled={invalid} onClick={submit}>
            Confirmar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {status === "ON_HOLD" && (
          <Field label="Motivo de la espera" htmlFor="hold-reason">
            <Select id="hold-reason" value={reason} onChange={(e) => setReason(e.target.value as OnHoldReason)}>
              {Object.entries(ON_HOLD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {status === "ON_HOLD" && <p className="text-xs text-slate-500">El reloj de resolución se pausa mientras el ticket esté en espera.</p>}
        {status === "RESOLVED" ? (
          <>
            <Field label="Código de resolución" htmlFor="resolution-code">
              <Select id="resolution-code" value={code} onChange={(e) => setCode(e.target.value as ResolutionCode)}>
                {Object.entries(RESOLUTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="¿Qué se hizo? (el solicitante lo verá) *" htmlFor="resolution-notes">
              <Textarea id="resolution-notes" rows={4} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Comentario (visible para el solicitante, opcional)" htmlFor="status-comment">
            <Textarea id="status-comment" rows={3} maxLength={4000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function AssignModal({
  groups,
  currentGroupId,
  currentAssigneeId,
  loading,
  onClose,
  onSubmit,
}: {
  groups: SupportGroup[];
  currentGroupId: number | null;
  currentAssigneeId: number | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (groupId: number | null, assigneeUserId: number | null) => void;
}) {
  const [groupId, setGroupId] = useState<number | "">(currentGroupId ?? "");
  const [assigneeId, setAssigneeId] = useState<number | "">(currentAssigneeId ?? "");
  const group = groups.find((candidate) => candidate.id === groupId);

  return (
    <Modal
      open
      title="Asignar o escalar"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="button" loading={loading} onClick={() => onSubmit(groupId === "" ? null : groupId, assigneeId === "" ? null : assigneeId)}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Grupo resolutor" htmlFor="assign-group">
          <Select
            id="assign-group"
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
        <Field label="Agente" htmlFor="assign-agent">
          <Select id="assign-agent" value={assigneeId === "" ? "" : String(assigneeId)} onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : "")} disabled={!group}>
            <option value="">Sin agente (queda en la cola del grupo)</option>
            {(group?.members ?? []).map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.fullName}
                {member.isLead ? " (líder)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        {group && group.members.length === 0 && <Alert tone="warning">El grupo no tiene miembros: agréguelos en Configuración Service Desk.</Alert>}
        {groupId !== "" && groupId !== currentGroupId && (
          <p className="text-xs text-slate-500">Cambiar de grupo registra un escalamiento funcional y avisa al grupo.</p>
        )}
      </div>
    </Modal>
  );
}

function ClassifyModal({
  ticket,
  categories,
  loading,
  onClose,
  onSubmit,
}: {
  ticket: TicketDetail;
  categories: ServiceCategory[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (body: { categoryId: number | null; impact: number; urgency: number; isMajor: boolean; title: string }) => void;
}) {
  const [categoryId, setCategoryId] = useState<number | "">(ticket.categoryId ?? "");
  const [impact, setImpact] = useState(ticket.impact);
  const [urgency, setUrgency] = useState(ticket.urgency);
  const [isMajor, setIsMajor] = useState(ticket.isMajor);
  const [title, setTitle] = useState(ticket.title);
  const options = categories.filter((category) => category.appliesTo.includes(ticket.type));
  const nameOf = (category: ServiceCategory) => {
    const parent = category.parentId ? categories.find((candidate) => candidate.id === category.parentId) : null;
    return parent ? `${parent.name} › ${category.name}` : category.name;
  };

  return (
    <Modal
      open
      title="Reclasificar ticket"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button
            type="button"
            loading={loading}
            disabled={title.trim().length < 3}
            onClick={() => {
              if (isMajor && !(impact === 1 && urgency === 1)) showWarningToast("Solo un P1 (impacto y urgencia altos) puede ser incidente mayor");
              onSubmit({ categoryId: categoryId === "" ? null : categoryId, impact, urgency, isMajor, title: title.trim() });
            }}
          >
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Asunto" htmlFor="classify-title">
          <input id="classify-title" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Categoría" htmlFor="classify-category">
          <Select id="classify-category" value={categoryId === "" ? "" : String(categoryId)} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Sin categoría</option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {nameOf(category)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Impacto" htmlFor="classify-impact">
            <Select id="classify-impact" value={String(impact)} onChange={(e) => setImpact(Number(e.target.value))}>
              {[1, 2, 3].map((level) => (
                <option key={level} value={level}>
                  {LEVEL_LABELS[level]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Urgencia" htmlFor="classify-urgency">
            <Select id="classify-urgency" value={String(urgency)} onChange={(e) => setUrgency(Number(e.target.value))}>
              {[1, 2, 3].map((level) => (
                <option key={level} value={level}>
                  {LEVEL_LABELS[level]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {ticket.type === "INCIDENT" && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={isMajor} onChange={(e) => setIsMajor(e.target.checked)} />
            Declarar incidente mayor (avisa a todo el grupo)
          </label>
        )}
        <p className="text-xs text-slate-500">Si cambia la prioridad, el SLA se recalcula con la nueva política.</p>
      </div>
    </Modal>
  );
}
