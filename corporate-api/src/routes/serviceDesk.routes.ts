import { Router } from "express";
import * as portal from "../controllers/servicePortal.controller";
import * as tickets from "../controllers/serviceTicket.controller";
import * as management from "../controllers/serviceDeskManagement.controller";
import * as settings from "../controllers/serviceDeskSettings.controller";
import { authenticate } from "../middlewares/authenticate";
import { authorize } from "../middlewares/authorize";
import {
  kbSearchRateLimiter,
  serviceDeskLookupRateLimiter,
  ticketCommentRateLimiter,
  ticketCreateRateLimiter,
} from "../middlewares/rateLimit";
import { uploadSingle } from "../middlewares/upload";
import { validateBody } from "../middlewares/validate";

// Service Desk ITIL v4 (plan 009). Ningun permiso se otorga por defecto: el
// admin arma rol -> cargo -> colaborador. Rutas literales ANTES de "/:id".

// Adjuntos de tickets: PDF, imagenes y correos, 10 MB cada uno.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// ---- Portal del solicitante ("Generar Ticket") -----------------------------
export const servicePortalRouter = Router();
servicePortalRouter.use(authenticate);

servicePortalRouter.get("/catalog", authorize("service-tickets", "create"), portal.catalog);
servicePortalRouter.get("/my-assets", authorize("service-tickets", "create"), portal.myAssets);
servicePortalRouter.get("/kb", authorize("kb-articles", "read"), kbSearchRateLimiter, portal.searchKb);
servicePortalRouter.get("/kb/:articleId", authorize("kb-articles", "read"), portal.getKbArticle);
servicePortalRouter.post(
  "/kb/:articleId/feedback",
  authorize("kb-articles", "read"),
  validateBody(portal.feedbackSchema),
  portal.kbFeedback,
);

servicePortalRouter.get("/tickets", authorize("service-tickets", "create"), portal.list);
servicePortalRouter.post(
  "/tickets",
  authorize("service-tickets", "create"),
  ticketCreateRateLimiter,
  validateBody(portal.createPortalTicketSchema),
  portal.create,
);
servicePortalRouter.get("/tickets/:id", authorize("service-tickets", "create"), portal.getById);
servicePortalRouter.post(
  "/tickets/:id/comments",
  authorize("service-tickets", "create"),
  ticketCommentRateLimiter,
  validateBody(portal.portalCommentSchema),
  portal.comment,
);
servicePortalRouter.post(
  "/tickets/:id/attachments",
  authorize("service-tickets", "create"),
  portal.precheckAttachment,
  uploadSingle("file", { sanitizePdf: true, maxFileSizeBytes: MAX_ATTACHMENT_BYTES }),
  portal.uploadAttachment,
);
servicePortalRouter.get("/tickets/:id/attachments/:attachmentId", authorize("service-tickets", "create"), portal.downloadAttachment);
servicePortalRouter.post("/tickets/:id/cancel", authorize("service-tickets", "create"), validateBody(portal.cancelSchema), portal.cancel);
servicePortalRouter.post("/tickets/:id/reopen", authorize("service-tickets", "create"), validateBody(portal.reopenSchema), portal.reopen);
servicePortalRouter.post("/tickets/:id/confirm", authorize("service-tickets", "create"), validateBody(portal.confirmSchema), portal.confirm);

// ---- Trabajo del agente ("Gestión de Tickets") -----------------------------
export const serviceTicketRouter = Router();
serviceTicketRouter.use(authenticate);

serviceTicketRouter.get("/lookups", authorize("service-tickets", "read"), tickets.lookups);
serviceTicketRouter.get("/users", authorize("service-tickets", "update"), serviceDeskLookupRateLimiter, tickets.searchUsers);
serviceTicketRouter.get("/assets", authorize("service-tickets", "update"), serviceDeskLookupRateLimiter, tickets.searchAssets);
// Historial de servicio de un activo (lo muestra tambien la ficha Kardex). Exige ver tickets, no solo
// assets:read: ese permiso lo tiene cualquier usuario y el historial expone asuntos de tickets ajenos.
serviceTicketRouter.get("/asset-history/:assetId", authorize("service-tickets", "read"), tickets.assetHistory);
serviceTicketRouter.get("/approvals", authorize("service-tickets", "approve"), tickets.listApprovals);

serviceTicketRouter.get("/", authorize("service-tickets", "read"), tickets.list);
serviceTicketRouter.post("/", authorize("service-tickets", "update"), ticketCreateRateLimiter, validateBody(tickets.createTicketSchema), tickets.create);
serviceTicketRouter.get("/:id", authorize("service-tickets", "read"), tickets.getById);
serviceTicketRouter.get("/:id/related", authorize("service-tickets", "read"), tickets.related);
serviceTicketRouter.patch("/:id", authorize("service-tickets", "update"), validateBody(tickets.classificationSchema), tickets.updateClassification);
serviceTicketRouter.post("/:id/assign", authorize("service-tickets", "update"), validateBody(tickets.assignSchema), tickets.assign);
serviceTicketRouter.post("/:id/take", authorize("service-tickets", "update"), tickets.take);
serviceTicketRouter.post("/:id/status", authorize("service-tickets", "update"), validateBody(tickets.statusSchema), tickets.changeStatus);
serviceTicketRouter.post("/:id/comments", authorize("service-tickets", "update"), ticketCommentRateLimiter, validateBody(tickets.commentSchema), tickets.comment);
serviceTicketRouter.post(
  "/:id/attachments",
  authorize("service-tickets", "update"),
  tickets.precheckAttachment,
  uploadSingle("file", { sanitizePdf: true, maxFileSizeBytes: MAX_ATTACHMENT_BYTES }),
  tickets.uploadAttachment,
);
serviceTicketRouter.get("/:id/attachments/:attachmentId", authorize("service-tickets", "read"), tickets.downloadAttachment);
serviceTicketRouter.post("/:id/approval", authorize("service-tickets", "approve"), validateBody(tickets.approvalSchema), tickets.decideApproval);
serviceTicketRouter.post("/:id/assets", authorize("service-tickets", "update"), validateBody(tickets.linkAssetsSchema), tickets.linkAssets);
serviceTicketRouter.delete("/:id/assets/:assetId", authorize("service-tickets", "update"), tickets.unlinkAsset);
// Mover el activo es un movimiento de activos: exige tambien asset-movements:create.
serviceTicketRouter.post(
  "/:id/assets/:assetId/send-to-support",
  authorize("service-tickets", "update"),
  authorize("asset-movements", "create"),
  validateBody(tickets.assetNotesSchema),
  tickets.sendAssetToSupport,
);
serviceTicketRouter.post(
  "/:id/assets/:assetId/return",
  authorize("service-tickets", "update"),
  authorize("asset-movements", "create"),
  validateBody(tickets.returnAssetSchema),
  tickets.returnAsset,
);

// ---- Problemas -------------------------------------------------------------
export const serviceProblemRouter = Router();
serviceProblemRouter.use(authenticate);

serviceProblemRouter.get("/", authorize("service-problems", "read"), management.listProblems);
serviceProblemRouter.post("/", authorize("service-problems", "create"), validateBody(management.createProblemSchema), management.createProblem);
serviceProblemRouter.get("/:id", authorize("service-problems", "read"), management.getProblem);
serviceProblemRouter.put("/:id", authorize("service-problems", "update"), validateBody(management.updateProblemSchema), management.updateProblem);
serviceProblemRouter.post(
  "/:id/status",
  authorize("service-problems", "update"),
  validateBody(management.problemStatusSchema),
  management.changeProblemStatus,
);
serviceProblemRouter.post("/:id/incidents", authorize("service-problems", "update"), validateBody(management.idsSchema), management.linkProblemIncidents);
serviceProblemRouter.delete("/:id/incidents/:ticketId", authorize("service-problems", "update"), management.unlinkProblemIncident);
serviceProblemRouter.post("/:id/assets", authorize("service-problems", "update"), validateBody(management.idsSchema), management.linkProblemAssets);
serviceProblemRouter.delete("/:id/assets/:assetId", authorize("service-problems", "update"), management.unlinkProblemAsset);
serviceProblemRouter.post("/:id/kb-draft", authorize("service-problems", "update"), authorize("kb-articles", "create"), management.draftKbFromProblem);

// ---- Cambios ---------------------------------------------------------------
export const serviceChangeRouter = Router();
serviceChangeRouter.use(authenticate);

serviceChangeRouter.get("/templates", authorize("service-changes", "read"), management.listTemplates);
serviceChangeRouter.post(
  "/templates",
  authorize("service-desk-settings", "update"),
  validateBody(management.templateSchema),
  management.createTemplate,
);
serviceChangeRouter.put(
  "/templates/:id",
  authorize("service-desk-settings", "update"),
  validateBody(management.templateSchema),
  management.updateTemplate,
);
serviceChangeRouter.get("/", authorize("service-changes", "read"), management.listChanges);
serviceChangeRouter.post("/", authorize("service-changes", "create"), validateBody(management.createChangeSchema), management.createChange);
serviceChangeRouter.get("/:id", authorize("service-changes", "read"), management.getChange);
serviceChangeRouter.put("/:id", authorize("service-changes", "update"), validateBody(management.updateChangeSchema), management.updateChange);
serviceChangeRouter.post("/:id/actions", authorize("service-changes", "update"), validateBody(management.changeActionSchema), management.runChangeAction);
serviceChangeRouter.post("/:id/decision", authorize("service-changes", "approve"), validateBody(management.changeDecisionSchema), management.decideChange);

// ---- Conocimiento (agentes) ------------------------------------------------
export const kbArticleRouter = Router();
kbArticleRouter.use(authenticate);

kbArticleRouter.get("/search", authorize("kb-articles", "read"), kbSearchRateLimiter, management.searchArticles);
kbArticleRouter.get("/", authorize("kb-articles", "update"), management.listArticles);
kbArticleRouter.post("/", authorize("kb-articles", "create"), validateBody(management.articleSchema), management.createArticle);
kbArticleRouter.get("/:id", authorize("kb-articles", "update"), management.getArticle);
kbArticleRouter.put("/:id", authorize("kb-articles", "update"), validateBody(management.articleSchema), management.updateArticle);
kbArticleRouter.post("/:id/status", authorize("kb-articles", "update"), validateBody(management.articleStatusSchema), management.changeArticleStatus);
kbArticleRouter.post(
  "/:id/tickets",
  authorize("kb-articles", "read"),
  authorize("service-tickets", "update"),
  validateBody(management.linkArticleSchema),
  management.linkArticleToTicket,
);

// ---- Indicadores -----------------------------------------------------------
export const serviceDeskReportRouter = Router();
serviceDeskReportRouter.use(authenticate);
serviceDeskReportRouter.get("/summary", authorize("service-desk-reports", "read"), management.summary);

// ---- Configuracion ---------------------------------------------------------
export const serviceDeskSettingsRouter = Router();
serviceDeskSettingsRouter.use(authenticate);

const read = authorize("service-desk-settings", "read");
const write = authorize("service-desk-settings", "update");

serviceDeskSettingsRouter.get("/users", write, serviceDeskLookupRateLimiter, tickets.searchUsers);
serviceDeskSettingsRouter.get("/audit", read, settings.listAudit);
serviceDeskSettingsRouter.get("/groups", read, settings.listGroups);
serviceDeskSettingsRouter.post("/groups", write, validateBody(settings.groupSchema), settings.createGroup);
serviceDeskSettingsRouter.put("/groups/:id", write, validateBody(settings.groupSchema), settings.updateGroup);
serviceDeskSettingsRouter.put("/groups/:id/members", write, validateBody(settings.membersSchema), settings.replaceMembers);
serviceDeskSettingsRouter.get("/categories", read, settings.listCategories);
serviceDeskSettingsRouter.post("/categories", write, validateBody(settings.categorySchema), settings.createCategory);
serviceDeskSettingsRouter.put("/categories/:id", write, validateBody(settings.categorySchema), settings.updateCategory);
serviceDeskSettingsRouter.get("/catalog-items", read, settings.listCatalogItems);
serviceDeskSettingsRouter.post("/catalog-items", write, validateBody(settings.catalogItemSchema), settings.createCatalogItem);
serviceDeskSettingsRouter.put("/catalog-items/:id", write, validateBody(settings.catalogItemSchema), settings.updateCatalogItem);
serviceDeskSettingsRouter.get("/calendars", read, settings.listCalendars);
serviceDeskSettingsRouter.put("/calendars/:id", write, validateBody(settings.calendarSchema), settings.updateCalendar);
serviceDeskSettingsRouter.post("/calendars/:id/holidays", write, validateBody(settings.holidaySchema), settings.addHoliday);
serviceDeskSettingsRouter.delete("/calendars/:id/holidays/:date", write, settings.removeHoliday);
serviceDeskSettingsRouter.get("/priority-matrix", read, settings.getMatrix);
serviceDeskSettingsRouter.put("/priority-matrix", write, validateBody(settings.matrixSchema), settings.replaceMatrix);
serviceDeskSettingsRouter.get("/sla-policies", read, settings.listSla);
// Plantillas de cambio estandar (todas, incluidas las inactivas) para la pantalla de configuracion.
serviceDeskSettingsRouter.get("/change-templates", read, management.listAllTemplates);
serviceDeskSettingsRouter.put("/sla-policies", write, validateBody(settings.slaSchema), settings.upsertSla);
