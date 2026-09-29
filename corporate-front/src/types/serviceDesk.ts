// Espejo de los tipos del Service Desk en corporate-api (plan 009):
// services/postgres/serviceDesk/*.service.ts.
import type {
  RoomAccessRequestInput,
  RoomAccessRequestStatus,
  RoomAccessType,
  RoomBeneficiaryKind,
} from "./commRoom";

export type TicketType = "INCIDENT" | "SERVICE_REQUEST";
export type TicketStatus =
  | "PENDING_APPROVAL"
  | "NEW"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "ON_HOLD"
  | "RESOLVED"
  | "CLOSED"
  | "CANCELLED";
export type Priority = "P1" | "P2" | "P3" | "P4";
export type OnHoldReason = "AWAITING_USER" | "AWAITING_VENDOR" | "AWAITING_CHANGE" | "AWAITING_PARTS";
export type ResolutionCode = "FIXED" | "WORKAROUND" | "FULFILLED" | "NO_FAULT_FOUND" | "USER_EDUCATION" | "DUPLICATE";
export type Channel = "PORTAL" | "PHONE" | "EMAIL" | "WALK_IN" | "AGENT";
export type SlaState = "NONE" | "ON_TRACK" | "AT_RISK" | "BREACHED" | "PAUSED" | "MET";
export type QueueView = "all" | "mine" | "my-groups" | "unassigned" | "breached" | "pending-approval";

export interface TicketSummary {
  id: number;
  number: string;
  type: TicketType;
  status: TicketStatus;
  onHoldReason: OnHoldReason | null;
  title: string;
  priority: Priority;
  impact: number;
  urgency: number;
  isMajor: boolean;
  channel: Channel;
  categoryId: number | null;
  categoryName: string | null;
  catalogItemId: number | null;
  catalogItemName: string | null;
  requesterUserId: number;
  requesterName: string;
  assignedGroupId: number | null;
  assignedGroupName: string | null;
  assigneeUserId: number | null;
  assigneeName: string | null;
  responseDueAt: string | null;
  resolutionDueAt: string | null;
  firstResponseAt: string | null;
  slaState: SlaState;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketEvent {
  id: number;
  eventType: string;
  actorUserId: number | null;
  actorName: string | null;
  isPublic: boolean;
  body: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface TicketAttachment {
  id: number;
  isPublic: boolean;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: number;
  uploadedByName: string | null;
  createdAt: string;
}

export interface TicketAsset {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  statusCode: string;
  costCenterName: string | null;
  productName: string | null;
  holderUserId: number | null;
  holderName: string | null;
  statusBefore: string | null;
  inSupport: boolean;
  supportMovementId: number | null;
  returnMovementId: number | null;
  linkedAt: string;
  recentIncidentCount: number;
}

export interface TicketDetail extends TicketSummary {
  description: string;
  variables: Record<string, unknown>;
  resolutionCode: ResolutionCode | null;
  resolutionNotes: string | null;
  resolutionWarnAt: string | null;
  responseBreached: boolean;
  resolutionBreached: boolean;
  onHoldSince: string | null;
  autoCloseAt: string | null;
  reopenCount: number;
  csatScore: number | null;
  csatComment: string | null;
  parentTicketId: number | null;
  problemId: number | null;
  approvalGroupId: number | null;
  events: TicketEvent[];
  attachments: TicketAttachment[];
  approvals: { approverUserId: number; approverName: string | null; decision: "APPROVED" | "REJECTED"; comment: string | null; decidedAt: string }[];
  assets: TicketAsset[];
  // Solicitud de compra que genero el ticket (solicitud de equipo, plan 010).
  purchaseRequest: LinkedPurchaseRequest | null;
  // Solicitud de acceso a una sala de comunicaciones (plan 016).
  roomAccess: TicketRoomAccess | null;
  allowedTransitions: TicketStatus[];
}

export interface TicketRoomAccess {
  status: RoomAccessRequestStatus;
  roomId: number;
  roomName: string;
  costCenterName: string;
  beneficiaryKind: RoomBeneficiaryKind;
  beneficiaryName: string;
  beneficiaryDocumentId: string;
  beneficiaryCompany: string | null;
  reason: string;
  requestedType: RoomAccessType;
  requestedFrom: string;
  requestedUntil: string | null;
  accessType: RoomAccessType | null;
  validFrom: string | null;
  validUntil: string | null;
  validatedByName: string | null;
  validatedAt: string | null;
  validationNotes: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  grantId: number | null;
  grantStatus: string | null;
}

export interface LinkedPurchaseRequest {
  id: number;
  number: string | null;
  status: string | null;
  statusLabel: string | null;
}

export interface TicketRelated {
  problem: { id: number; number: string; title: string; status: string; workaround: string | null } | null;
  changes: { id: number; number: string; title: string; status: string; plannedStart: string | null }[];
  kbArticles: { id: number; number: string; title: string; usedToResolve: boolean }[];
  suggestedArticles: { id: number; number: string; title: string; snippet: string }[];
  sameAssetTickets: { id: number; number: string; title: string; status: string; type: string; createdAt: string; tags: string[] }[];
}

export type CatalogFieldType = "text" | "textarea" | "number" | "date" | "select" | "boolean";

export interface CatalogField {
  key: string;
  label: string;
  type: CatalogFieldType;
  required: boolean;
  options?: string[];
}

export interface ServiceCategory {
  id: number;
  parentId: number | null;
  name: string;
  defaultGroupId: number | null;
  appliesTo: string[];
  isActive: boolean;
}

export type CatalogFulfillment = "PURCHASE_REQUEST" | "ROOM_ACCESS";

export interface CatalogItem {
  id: number;
  name: string;
  description: string | null;
  categoryId: number | null;
  defaultGroupId?: number | null;
  approvalGroupId?: number | null;
  requiresApproval?: boolean;
  // PURCHASE_REQUEST: el pedido genera la solicitud de compra junto con el ticket (plan 010).
  // ROOM_ACCESS: acceso a una sala de comunicaciones, validado y aprobado por ticket (plan 016).
  fulfillment: CatalogFulfillment | null;
  fields: CatalogField[];
  isActive: boolean;
}

export interface SupportGroup {
  id: number;
  // 2 digitos del grupo en los folios: REQ2026<code>000001. Lo asigna la API.
  code: string;
  name: string;
  description: string | null;
  email: string | null;
  isActive: boolean;
  members: { userId: number; fullName: string; isLead: boolean }[];
}

export interface HeldAsset {
  assetId: number;
  tag: string;
  serialNumber: string | null;
  productName: string | null;
  statusCode: string;
  holderName?: string | null;
}

export interface UserOption {
  userId: number;
  username: string;
  fullName: string;
}

export interface CreateTicketPayload {
  type: TicketType;
  title: string;
  description: string;
  categoryId?: number | null;
  catalogItemId?: number | null;
  variables?: Record<string, unknown>;
  impact: number;
  urgency: number;
  assetIds?: number[];
  channel?: Channel;
  requesterUserId?: number;
  assignedGroupId?: number | null;
  isMajor?: boolean;
  purchaseRequest?: EquipmentPurchasePayload;
  roomAccess?: RoomAccessRequestInput;
}

// Datos de la compra de una solicitud de equipo. El solicitante es el usuario de la sesion.
export interface EquipmentPurchasePayload {
  beneficiaryPersonId?: number | null;
  costCenterId: number;
  approverId: number;
  requesterEmail?: string;
  requesterPhone?: string;
  lines: { productId: string; quantity: number }[];
}

// ---- Problemas -------------------------------------------------------------
export type ProblemStatus = "NEW" | "UNDER_INVESTIGATION" | "KNOWN_ERROR" | "RESOLVED" | "CLOSED" | "CANCELLED";

export interface ProblemSummary {
  id: number;
  number: string;
  status: ProblemStatus;
  title: string;
  priority: Priority;
  categoryName: string | null;
  assignedGroupId: number | null;
  assignedGroupName: string | null;
  assigneeUserId: number | null;
  assigneeName: string | null;
  incidentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecordEvent {
  id: number;
  eventType: string;
  actorName: string | null;
  body: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ProblemDetail extends ProblemSummary {
  description: string;
  categoryId: number | null;
  impact: number;
  urgency: number;
  rootCause: string | null;
  workaround: string | null;
  permanentFix: string | null;
  kbArticleId: number | null;
  knownErrorAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  allowedTransitions: ProblemStatus[];
  incidents: TicketSummary[];
  assets: { assetId: number; tag: string; statusCode: string }[];
  changes: { id: number; number: string; title: string; status: string }[];
  events: RecordEvent[];
}

export interface ProblemPayload {
  title: string;
  description: string;
  categoryId?: number | null;
  impact: number;
  urgency: number;
  assignedGroupId?: number | null;
  assigneeUserId?: number | null;
  rootCause?: string | null;
  workaround?: string | null;
  permanentFix?: string | null;
  incidentIds?: number[];
  assetIds?: number[];
}

// ---- Cambios ---------------------------------------------------------------
export type ChangeType = "STANDARD" | "NORMAL" | "EMERGENCY";
export type ChangeStatus =
  | "DRAFT"
  | "ASSESSMENT"
  | "CAB_APPROVAL"
  | "SCHEDULED"
  | "IMPLEMENTING"
  | "REVIEW"
  | "CLOSED"
  | "REJECTED"
  | "CANCELLED";
export type ChangeRisk = "LOW" | "MEDIUM" | "HIGH";
export type ChangeOutcome = "SUCCESSFUL" | "FAILED" | "BACKED_OUT";
export type ChangeAction = "submit" | "request-approval" | "start" | "complete" | "close" | "cancel";

export interface ChangeSummary {
  id: number;
  number: string;
  type: ChangeType;
  status: ChangeStatus;
  title: string;
  risk: ChangeRisk;
  impact: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  assignedGroupId: number | null;
  assignedGroupName: string | null;
  assigneeUserId: number | null;
  assigneeName: string | null;
  requestedBy: number;
  requestedByName: string | null;
  outcome: ChangeOutcome | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeDetail extends ChangeSummary {
  description: string;
  justification: string | null;
  categoryId: number | null;
  categoryName: string | null;
  implementationPlan: string | null;
  backoutPlan: string | null;
  testPlan: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  pirNotes: string | null;
  problemId: number | null;
  problemNumber: string | null;
  templateId: number | null;
  allowedActions: ChangeAction[];
  approvals: { approverUserId: number; approverName: string | null; decision: "APPROVED" | "REJECTED" | null; comment: string | null; requestedAt: string; decidedAt: string | null }[];
  assets: { assetId: number; tag: string; statusCode: string }[];
  tickets: { id: number; number: string; title: string; status: string }[];
  conflicts: { id: number; number: string; title: string; status: ChangeStatus; plannedStart: string; plannedEnd: string; sharedAssetTags: string[] }[];
  events: RecordEvent[];
}

export interface ChangePayload {
  type?: ChangeType;
  templateId?: number | null;
  title: string;
  description: string;
  justification?: string | null;
  categoryId?: number | null;
  risk: ChangeRisk;
  impact: number;
  implementationPlan?: string | null;
  backoutPlan?: string | null;
  testPlan?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  assignedGroupId?: number | null;
  assigneeUserId?: number | null;
  problemId?: number | null;
  assetIds?: number[];
  ticketIds?: number[];
}

export interface ChangeTemplate {
  id: number;
  name: string;
  description: string | null;
  categoryId: number | null;
  implementationPlan: string;
  backoutPlan: string;
  testPlan: string | null;
  isActive: boolean;
}

// ---- Conocimiento ----------------------------------------------------------
export type KbAudience = "PUBLIC" | "INTERNAL";
export type KbStatus = "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "RETIRED";

export interface KbArticleSummary {
  id: number;
  number: string;
  title: string;
  categoryId: number | null;
  categoryName: string | null;
  audience: KbAudience;
  status: KbStatus;
  version: number;
  authorId: number;
  authorName: string | null;
  publishedAt: string | null;
  helpfulYes: number;
  helpfulNo: number;
  views: number;
  updatedAt: string;
  snippet?: string;
}

export interface KbArticle extends KbArticleSummary {
  body: string;
  sourceProblemId: number | null;
  sourceProblemNumber: string | null;
  versions?: { version: number; title: string; publishedBy: number; publishedAt: string }[];
}

// ---- Configuracion ---------------------------------------------------------
export interface BusinessCalendar {
  id: number;
  name: string;
  timezone: string;
  isDefault: boolean;
  hours: { weekday: number; start: string; end: string }[];
  holidays: { date: string; name: string }[];
}

export interface PriorityMatrixRow {
  impact: number;
  urgency: number;
  priority: Priority;
}

export interface SlaPolicy {
  id?: number;
  ticketType: TicketType;
  priority: Priority;
  responseMinutes: number;
  resolutionMinutes: number;
  calendarId: number | null;
}

// ---- Indicadores -----------------------------------------------------------
export interface ServiceDeskSummary {
  days: number;
  backlogByStatus: { status: TicketStatus; total: number }[];
  backlogByGroup: { groupName: string; total: number; breached: number }[];
  created: number;
  resolved: number;
  slaCompliance: number | null;
  responseCompliance: number | null;
  mttrHours: number | null;
  firstContactResolution: number | null;
  reopenRate: number | null;
  csatAverage: number | null;
  csatResponses: number;
  topCategories: { name: string; total: number }[];
  topAssets: { assetId: number; tag: string; incidents: number }[];
  byPriority: { priority: Priority; total: number }[];
}

export interface AssetServiceRecord {
  kind: "TICKET" | "PROBLEM" | "CHANGE";
  id: number;
  number: string;
  type: string;
  status: string;
  title: string;
  priority: string | null;
  createdAt: string;
  closedAt: string | null;
}

// Auditoria de la configuracion del Service Desk (GET /service-desk-settings/audit).
export type SettingsAuditAction = "CREATE" | "UPDATE" | "DELETE" | "REPLACE";

export interface SettingsAuditRecord {
  id: number;
  entity: string;
  entityId: number | null;
  action: SettingsAuditAction;
  actorUserId: number;
  actorName: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}
