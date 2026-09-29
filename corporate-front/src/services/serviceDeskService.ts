import { apiFetch, apiFetchBlob } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { PortalCommRoom, RoomAccessValidationInput } from "../types/commRoom";
import type {
  AssetServiceRecord,
  BusinessCalendar,
  CatalogFulfillment,
  CatalogItem,
  ChangeAction,
  ChangeDetail,
  ChangeOutcome,
  ChangePayload,
  ChangeSummary,
  ChangeTemplate,
  CreateTicketPayload,
  HeldAsset,
  KbArticle,
  KbArticleSummary,
  KbAudience,
  KbStatus,
  OnHoldReason,
  Priority,
  PriorityMatrixRow,
  ProblemDetail,
  ProblemPayload,
  ProblemStatus,
  ProblemSummary,
  QueueView,
  ResolutionCode,
  ServiceCategory,
  ServiceDeskSummary,
  SlaPolicy,
  SupportGroup,
  TicketAttachment,
  TicketDetail,
  TicketRelated,
  TicketStatus,
  TicketSummary,
  TicketType,
  UserOption,
  CatalogField,
  SettingsAuditRecord,
} from "../types/serviceDesk";

// Service Desk (plan 009). Rutas de corporate-api/src/routes/serviceDesk.routes.ts.

export interface TicketListParams extends ListParams {
  view?: QueueView;
  statuses?: string;
  type?: TicketType;
  priority?: Priority;
  groupId?: number;
  includeClosed?: boolean;
}

function uploadForm(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

// ---- Portal del solicitante -------------------------------------------------
export const servicePortalService = {
  catalog: () => apiFetch<{ categories: ServiceCategory[]; catalogItems: CatalogItem[] }>("/service-portal/catalog"),
  myAssets: () => apiFetch<HeldAsset[]>("/service-portal/my-assets"),
  // Salas para pedir acceso (plan 016): sin la direccion.
  commRooms: () => apiFetch<PortalCommRoom[]>("/service-portal/comm-rooms"),
  list: (params?: ListParams & { includeClosed?: boolean }) =>
    apiFetch<Paginated<TicketSummary>>(`/service-portal/tickets${toQuery(params)}`),
  create: (payload: CreateTicketPayload) => apiFetch<TicketDetail>("/service-portal/tickets", { method: "POST", body: payload }),
  // Solicitud de equipo: confirma el beneficiario por RUT (solo id y nombre).
  lookupBeneficiary: (documentId: string) =>
    apiFetch<{ personId: number; fullName: string }>("/service-portal/beneficiary", { method: "POST", body: { documentId } }),
  getById: (id: number) => apiFetch<TicketDetail>(`/service-portal/tickets/${id}`),
  comment: (id: number, body: string) => apiFetch<TicketDetail>(`/service-portal/tickets/${id}/comments`, { method: "POST", body: { body } }),
  uploadAttachment: (id: number, file: File) =>
    apiFetch<TicketAttachment>(`/service-portal/tickets/${id}/attachments`, { method: "POST", body: uploadForm(file) }),
  downloadAttachment: (id: number, attachmentId: number) => apiFetchBlob(`/service-portal/tickets/${id}/attachments/${attachmentId}`),
  cancel: (id: number, comment?: string) => apiFetch<TicketDetail>(`/service-portal/tickets/${id}/cancel`, { method: "POST", body: { comment } }),
  reopen: (id: number, comment: string) => apiFetch<TicketDetail>(`/service-portal/tickets/${id}/reopen`, { method: "POST", body: { comment } }),
  confirm: (id: number, csatScore?: number, csatComment?: string) =>
    apiFetch<TicketDetail>(`/service-portal/tickets/${id}/confirm`, { method: "POST", body: { csatScore, csatComment } }),
  searchKb: (search: string, suggest = false) =>
    apiFetch<KbArticleSummary[]>(`/service-portal/kb${toQuery({ search, suggest: suggest || undefined })}`),
  getKbArticle: (id: number) => apiFetch<KbArticle>(`/service-portal/kb/${id}`),
  kbFeedback: (id: number, helpful: boolean) => apiFetch<null>(`/service-portal/kb/${id}/feedback`, { method: "POST", body: { helpful } }),
};

// ---- Agente -----------------------------------------------------------------
export const serviceTicketService = {
  lookups: () =>
    apiFetch<{ groups: SupportGroup[]; categories: ServiceCategory[]; catalogItems: CatalogItem[] }>("/service-tickets/lookups"),
  searchUsers: (search: string) => apiFetch<UserOption[]>(`/service-tickets/users${toQuery({ search })}`),
  searchAssets: (search: string) => apiFetch<HeldAsset[]>(`/service-tickets/assets${toQuery({ search })}`),
  assetHistory: (assetId: number) => apiFetch<AssetServiceRecord[]>(`/service-tickets/asset-history/${assetId}`),
  list: (params?: TicketListParams) => apiFetch<Paginated<TicketSummary>>(`/service-tickets${toQuery(params)}`),
  approvals: (params?: ListParams) => apiFetch<Paginated<TicketSummary>>(`/service-tickets/approvals${toQuery(params)}`),
  create: (payload: CreateTicketPayload) => apiFetch<TicketDetail>("/service-tickets", { method: "POST", body: payload }),
  getById: (id: number) => apiFetch<TicketDetail>(`/service-tickets/${id}`),
  related: (id: number) => apiFetch<TicketRelated>(`/service-tickets/${id}/related`),
  classify: (id: number, body: { categoryId?: number | null; impact?: number; urgency?: number; isMajor?: boolean; title?: string }) =>
    apiFetch<TicketDetail>(`/service-tickets/${id}`, { method: "PATCH", body }),
  assign: (id: number, groupId: number | null, assigneeUserId: number | null) =>
    apiFetch<TicketDetail>(`/service-tickets/${id}/assign`, { method: "POST", body: { groupId, assigneeUserId } }),
  take: (id: number) => apiFetch<TicketDetail>(`/service-tickets/${id}/take`, { method: "POST" }),
  changeStatus: (
    id: number,
    body: { status: TicketStatus; onHoldReason?: OnHoldReason; resolutionCode?: ResolutionCode; resolutionNotes?: string; comment?: string },
  ) => apiFetch<TicketDetail>(`/service-tickets/${id}/status`, { method: "POST", body }),
  comment: (id: number, body: string, isPublic: boolean) =>
    apiFetch<TicketDetail>(`/service-tickets/${id}/comments`, { method: "POST", body: { body, isPublic } }),
  uploadAttachment: (id: number, file: File, internal: boolean) =>
    apiFetch<TicketAttachment>(`/service-tickets/${id}/attachments${internal ? "?internal=true" : ""}`, { method: "POST", body: uploadForm(file) }),
  downloadAttachment: (id: number, attachmentId: number) => apiFetchBlob(`/service-tickets/${id}/attachments/${attachmentId}`),
  decide: (id: number, decision: "APPROVED" | "REJECTED", comment?: string) =>
    apiFetch<TicketDetail>(`/service-tickets/${id}/approval`, { method: "POST", body: { decision, comment } }),
  // Acceso a sala (plan 016): el agente valida y envia a aprobacion.
  commRooms: () => apiFetch<PortalCommRoom[]>("/service-tickets/comm-rooms"),
  validateRoomAccess: (id: number, body: RoomAccessValidationInput) =>
    apiFetch<{ ticket: TicketDetail; warnings: string[] }>(`/service-tickets/${id}/room-access/validate`, { method: "POST", body }),
  linkAssets: (id: number, assetIds: number[]) => apiFetch<TicketDetail>(`/service-tickets/${id}/assets`, { method: "POST", body: { assetIds } }),
  unlinkAsset: (id: number, assetId: number) => apiFetch<void>(`/service-tickets/${id}/assets/${assetId}`, { method: "DELETE" }),
  sendAssetToSupport: (id: number, assetId: number, notes?: string) =>
    apiFetch<TicketDetail>(`/service-tickets/${id}/assets/${assetId}/send-to-support`, { method: "POST", body: { notes } }),
  returnAsset: (id: number, assetId: number, target: "HOLDER" | "STOCK", notes?: string) =>
    apiFetch<TicketDetail>(`/service-tickets/${id}/assets/${assetId}/return`, { method: "POST", body: { target, notes } }),
};

// ---- Problemas ----------------------------------------------------------------
export const serviceProblemService = {
  list: (params?: ListParams & { statuses?: string; includeClosed?: boolean }) =>
    apiFetch<Paginated<ProblemSummary>>(`/service-problems${toQuery(params)}`),
  getById: (id: number) => apiFetch<ProblemDetail>(`/service-problems/${id}`),
  create: (payload: ProblemPayload) => apiFetch<ProblemDetail>("/service-problems", { method: "POST", body: payload }),
  update: (id: number, payload: ProblemPayload) => apiFetch<ProblemDetail>(`/service-problems/${id}`, { method: "PUT", body: payload }),
  changeStatus: (id: number, status: ProblemStatus, comment?: string, resolveLinkedIncidents?: boolean) =>
    apiFetch<{ problem: ProblemDetail; resolvedIncidents: string[]; skippedIncidents: { number: string; reason: string }[] }>(
      `/service-problems/${id}/status`,
      { method: "POST", body: { status, comment, resolveLinkedIncidents } },
    ),
  linkIncidents: (id: number, ids: number[]) => apiFetch<ProblemDetail>(`/service-problems/${id}/incidents`, { method: "POST", body: { ids } }),
  unlinkIncident: (id: number, ticketId: number) => apiFetch<ProblemDetail>(`/service-problems/${id}/incidents/${ticketId}`, { method: "DELETE" }),
  linkAssets: (id: number, ids: number[]) => apiFetch<ProblemDetail>(`/service-problems/${id}/assets`, { method: "POST", body: { ids } }),
  unlinkAsset: (id: number, assetId: number) => apiFetch<ProblemDetail>(`/service-problems/${id}/assets/${assetId}`, { method: "DELETE" }),
  draftKb: (id: number) => apiFetch<{ articleId: number }>(`/service-problems/${id}/kb-draft`, { method: "POST" }),
};

// ---- Cambios ------------------------------------------------------------------
export const serviceChangeService = {
  list: (params?: ListParams & { statuses?: string; includeClosed?: boolean; from?: string; to?: string; pendingMine?: boolean }) =>
    apiFetch<Paginated<ChangeSummary>>(`/service-changes${toQuery(params)}`),
  getById: (id: number) => apiFetch<ChangeDetail>(`/service-changes/${id}`),
  create: (payload: ChangePayload) => apiFetch<ChangeDetail>("/service-changes", { method: "POST", body: payload }),
  update: (id: number, payload: ChangePayload) => apiFetch<ChangeDetail>(`/service-changes/${id}`, { method: "PUT", body: payload }),
  action: (id: number, body: { action: ChangeAction; approverUserIds?: number[]; outcome?: ChangeOutcome; pirNotes?: string; comment?: string }) =>
    apiFetch<ChangeDetail>(`/service-changes/${id}/actions`, { method: "POST", body }),
  decide: (id: number, decision: "APPROVED" | "REJECTED", comment?: string) =>
    apiFetch<ChangeDetail>(`/service-changes/${id}/decision`, { method: "POST", body: { decision, comment } }),
  templates: (all = false) => apiFetch<ChangeTemplate[]>(`/service-changes/templates${all ? "?all=true" : ""}`),
  createTemplate: (body: Omit<ChangeTemplate, "id">) => apiFetch<ChangeTemplate>("/service-changes/templates", { method: "POST", body }),
  updateTemplate: (id: number, body: Omit<ChangeTemplate, "id">) =>
    apiFetch<ChangeTemplate>(`/service-changes/templates/${id}`, { method: "PUT", body }),
};

// ---- Conocimiento -------------------------------------------------------------
export const kbArticleService = {
  list: (params?: ListParams & { status?: KbStatus }) => apiFetch<Paginated<KbArticleSummary>>(`/kb-articles${toQuery(params)}`),
  search: (search: string) => apiFetch<KbArticleSummary[]>(`/kb-articles/search${toQuery({ search })}`),
  getById: (id: number) => apiFetch<KbArticle>(`/kb-articles/${id}`),
  create: (body: { title: string; body: string; categoryId?: number | null; audience: KbAudience }) =>
    apiFetch<KbArticle>("/kb-articles", { method: "POST", body }),
  update: (id: number, body: { title: string; body: string; categoryId?: number | null; audience: KbAudience }) =>
    apiFetch<KbArticle>(`/kb-articles/${id}`, { method: "PUT", body }),
  changeStatus: (id: number, status: KbStatus) => apiFetch<KbArticle>(`/kb-articles/${id}/status`, { method: "POST", body: { status } }),
  linkToTicket: (id: number, ticketId: number, usedToResolve: boolean) =>
    apiFetch<null>(`/kb-articles/${id}/tickets`, { method: "POST", body: { ticketId, usedToResolve } }),
};

export const serviceDeskReportService = {
  summary: (days: number) => apiFetch<ServiceDeskSummary>(`/service-desk-reports/summary?days=${days}`),
};

// ---- Configuracion -----------------------------------------------------------
export const serviceDeskSettingsService = {
  searchUsers: (search: string) => apiFetch<UserOption[]>(`/service-desk-settings/users${toQuery({ search })}`),
  groups: () => apiFetch<SupportGroup[]>("/service-desk-settings/groups"),
  createGroup: (body: { name: string; description?: string | null; email?: string | null; isActive?: boolean }) =>
    apiFetch<SupportGroup>("/service-desk-settings/groups", { method: "POST", body }),
  updateGroup: (id: number, body: { name: string; description?: string | null; email?: string | null; isActive?: boolean }) =>
    apiFetch<SupportGroup>(`/service-desk-settings/groups/${id}`, { method: "PUT", body }),
  replaceMembers: (id: number, members: { userId: number; isLead: boolean }[]) =>
    apiFetch<SupportGroup>(`/service-desk-settings/groups/${id}/members`, { method: "PUT", body: { members } }),
  categories: () => apiFetch<ServiceCategory[]>("/service-desk-settings/categories"),
  createCategory: (body: Omit<ServiceCategory, "id">) => apiFetch<ServiceCategory>("/service-desk-settings/categories", { method: "POST", body }),
  updateCategory: (id: number, body: Omit<ServiceCategory, "id">) =>
    apiFetch<ServiceCategory>(`/service-desk-settings/categories/${id}`, { method: "PUT", body }),
  catalogItems: () => apiFetch<CatalogItem[]>("/service-desk-settings/catalog-items"),
  createCatalogItem: (body: CatalogItemPayload) => apiFetch<CatalogItem>("/service-desk-settings/catalog-items", { method: "POST", body }),
  updateCatalogItem: (id: number, body: CatalogItemPayload) =>
    apiFetch<CatalogItem>(`/service-desk-settings/catalog-items/${id}`, { method: "PUT", body }),
  calendars: () => apiFetch<BusinessCalendar[]>("/service-desk-settings/calendars"),
  updateCalendar: (id: number, body: { name: string; timezone: string; hours: BusinessCalendar["hours"] }) =>
    apiFetch<BusinessCalendar>(`/service-desk-settings/calendars/${id}`, { method: "PUT", body }),
  addHoliday: (id: number, date: string, name: string) =>
    apiFetch<BusinessCalendar>(`/service-desk-settings/calendars/${id}/holidays`, { method: "POST", body: { date, name } }),
  removeHoliday: (id: number, date: string) => apiFetch<void>(`/service-desk-settings/calendars/${id}/holidays/${date}`, { method: "DELETE" }),
  changeTemplates: () => apiFetch<ChangeTemplate[]>("/service-desk-settings/change-templates"),
  audit: (params?: ListParams & { entity?: string }) =>
    apiFetch<Paginated<SettingsAuditRecord>>(`/service-desk-settings/audit${toQuery(params)}`),
  matrix: () => apiFetch<PriorityMatrixRow[]>("/service-desk-settings/priority-matrix"),
  replaceMatrix: (rows: PriorityMatrixRow[]) =>
    apiFetch<PriorityMatrixRow[]>("/service-desk-settings/priority-matrix", { method: "PUT", body: { rows } }),
  slaPolicies: () => apiFetch<SlaPolicy[]>("/service-desk-settings/sla-policies"),
  saveSlaPolicies: (policies: SlaPolicy[]) =>
    apiFetch<SlaPolicy[]>("/service-desk-settings/sla-policies", {
      method: "PUT",
      body: {
        policies: policies.map(({ ticketType, priority, responseMinutes, resolutionMinutes, calendarId }) => ({
          ticketType,
          priority,
          responseMinutes,
          resolutionMinutes,
          calendarId,
        })),
      },
    }),
};

export interface CatalogItemPayload {
  name: string;
  description?: string | null;
  categoryId?: number | null;
  defaultGroupId?: number | null;
  approvalGroupId?: number | null;
  fulfillment?: CatalogFulfillment | null;
  fields: CatalogField[];
  isActive?: boolean;
}
