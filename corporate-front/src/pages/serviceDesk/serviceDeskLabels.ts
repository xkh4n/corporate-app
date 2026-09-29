import type {
  Channel,
  ChangeOutcome,
  ChangeRisk,
  ChangeStatus,
  ChangeType,
  KbAudience,
  KbStatus,
  OnHoldReason,
  Priority,
  ProblemStatus,
  ResolutionCode,
  SlaState,
  TicketStatus,
  TicketType,
} from "../../types/serviceDesk";

// Textos y colores del Service Desk (plan 009). Backend en ingles, UI en espanol.

export const TYPE_LABELS: Record<TicketType, string> = {
  INCIDENT: "Incidente",
  SERVICE_REQUEST: "Solicitud",
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  PENDING_APPROVAL: "Por aprobar",
  NEW: "Nuevo",
  ASSIGNED: "Asignado",
  IN_PROGRESS: "En curso",
  ON_HOLD: "En espera",
  RESOLVED: "Resuelto",
  CLOSED: "Cerrado",
  CANCELLED: "Anulado",
};

export const STATUS_CLASSES: Record<TicketStatus, string> = {
  PENDING_APPROVAL: "bg-violet-100 text-violet-800",
  NEW: "bg-sky-100 text-sky-800",
  ASSIGNED: "bg-indigo-100 text-indigo-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  ON_HOLD: "bg-amber-100 text-amber-800",
  RESOLVED: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-slate-200 text-slate-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};

// Acciones del agente para pasar a cada estado (el boton, no el estado).
export const TRANSITION_ACTIONS: Partial<Record<TicketStatus, string>> = {
  IN_PROGRESS: "Poner en curso",
  ON_HOLD: "Poner en espera",
  RESOLVED: "Resolver",
  CLOSED: "Cerrar",
  CANCELLED: "Anular",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  P1: "P1 Crítica",
  P2: "P2 Alta",
  P3: "P3 Media",
  P4: "P4 Baja",
};

export const PRIORITY_CLASSES: Record<Priority, string> = {
  P1: "bg-red-600 text-white",
  P2: "bg-orange-500 text-white",
  P3: "bg-yellow-300 text-yellow-900",
  P4: "bg-slate-200 text-slate-700",
};

// Impacto visto por el solicitante: a cuantos afecta.
export const IMPACT_LABELS: Record<number, string> = {
  1: "Toda la empresa o un servicio crítico",
  2: "Mi área o varias personas",
  3: "Solo a mí",
};

export const URGENCY_LABELS: Record<number, string> = {
  1: "Alta: no puedo trabajar",
  2: "Media: puedo trabajar con dificultad",
  3: "Baja: puede esperar",
};

export const LEVEL_LABELS: Record<number, string> = { 1: "Alto", 2: "Medio", 3: "Bajo" };

export const ON_HOLD_LABELS: Record<OnHoldReason, string> = {
  AWAITING_USER: "Esperando al solicitante",
  AWAITING_VENDOR: "Esperando al proveedor",
  AWAITING_CHANGE: "Esperando un cambio",
  AWAITING_PARTS: "Esperando repuestos",
};

export const RESOLUTION_LABELS: Record<ResolutionCode, string> = {
  FIXED: "Solucionado",
  WORKAROUND: "Solución temporal",
  FULFILLED: "Solicitud cumplida",
  NO_FAULT_FOUND: "Sin falla encontrada",
  USER_EDUCATION: "Orientación al usuario",
  DUPLICATE: "Duplicado",
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  PORTAL: "Portal",
  PHONE: "Teléfono",
  EMAIL: "Correo",
  WALK_IN: "Presencial",
  AGENT: "Agente",
};

export const SLA_LABELS: Record<SlaState, string> = {
  NONE: "Sin SLA",
  ON_TRACK: "En plazo",
  AT_RISK: "En riesgo",
  BREACHED: "Vencido",
  PAUSED: "Pausado",
  MET: "Cumplido",
};

export const SLA_CLASSES: Record<SlaState, string> = {
  NONE: "bg-slate-100 text-slate-500",
  ON_TRACK: "bg-emerald-100 text-emerald-800",
  AT_RISK: "bg-amber-100 text-amber-800",
  BREACHED: "bg-red-100 text-red-800",
  PAUSED: "bg-slate-200 text-slate-700",
  MET: "bg-emerald-50 text-emerald-700",
};

export const EVENT_LABELS: Record<string, string> = {
  CREATED: "Ticket registrado",
  STATUS_CHANGED: "Cambio de estado",
  ASSIGNED: "Asignación",
  ESCALATED: "Escalado a otro grupo",
  PRIORITY_CHANGED: "Cambio de prioridad",
  UPDATED: "Reclasificado",
  PUBLIC_COMMENT: "Comentario",
  WORK_NOTE: "Nota interna",
  ATTACHMENT_ADDED: "Adjunto",
  ASSET_LINKED: "Activo vinculado",
  ASSET_UNLINKED: "Activo desvinculado",
  ASSET_TO_SUPPORT: "Activo enviado a soporte",
  ASSET_RETURNED: "Activo devuelto",
  APPROVAL_DECIDED: "Aprobación",
  SLA_WARNING: "SLA en riesgo",
  SLA_BREACHED: "SLA vencido",
  LINKED_PROBLEM: "Vinculado a un problema",
  UNLINKED_PROBLEM: "Desvinculado del problema",
  LINKED_CHANGE: "Vinculado a un cambio",
  KB_ATTACHED: "Artículo de conocimiento",
  CSAT: "Encuesta de satisfacción",
  INCIDENT_LINKED: "Incidente vinculado",
  INCIDENT_UNLINKED: "Incidente desvinculado",
  ASSETS_LINKED: "Activos vinculados",
  ASSET_UNLINKED_PROBLEM: "Activo desvinculado",
  KB_DRAFTED: "Borrador de artículo creado",
  PURCHASE_REQUEST_LINKED: "Solicitud de compra",
  ROOM_ACCESS_REQUESTED: "Acceso a sala solicitado",
  ROOM_ACCESS_VALIDATED: "Acceso a sala validado",
  ROOM_ACCESS_GRANTED: "Acceso a sala autorizado",
  ROOM_ACCESS_EXPIRED: "Acceso a sala vencido",
  ROOM_ACCESS_REVOKED: "Acceso a sala revocado",
};

export const ASSET_STATUS_LABELS: Record<string, string> = {
  RECEIVED: "Recibido",
  ASSIGNED: "Asignado",
  AVAILABLE: "Disponible",
  SUPPORT: "En soporte",
  DECOMMISSIONED: "Pendiente de baja contable",
  WRITTEN_OFF: "De baja",
  DAMAGED: "Dañado",
  RETURNED: "Devuelto",
  DEVALUATED: "Devaluado",
  MOVE_TO_RETURNED: "En tránsito a devolución",
};

// ---- Problemas -------------------------------------------------------------
export const PROBLEM_STATUS_LABELS: Record<ProblemStatus, string> = {
  NEW: "Nuevo",
  UNDER_INVESTIGATION: "En investigación",
  KNOWN_ERROR: "Error conocido",
  RESOLVED: "Resuelto",
  CLOSED: "Cerrado",
  CANCELLED: "Anulado",
};

export const PROBLEM_STATUS_CLASSES: Record<ProblemStatus, string> = {
  NEW: "bg-sky-100 text-sky-800",
  UNDER_INVESTIGATION: "bg-blue-100 text-blue-800",
  KNOWN_ERROR: "bg-amber-100 text-amber-800",
  RESOLVED: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-slate-200 text-slate-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};

export const PROBLEM_ACTIONS: Record<ProblemStatus, string> = {
  NEW: "Nuevo",
  UNDER_INVESTIGATION: "Investigar",
  KNOWN_ERROR: "Declarar error conocido",
  RESOLVED: "Resolver",
  CLOSED: "Cerrar",
  CANCELLED: "Anular",
};

// ---- Cambios ---------------------------------------------------------------
export const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  STANDARD: "Estándar",
  NORMAL: "Normal",
  EMERGENCY: "Emergencia",
};

export const CHANGE_STATUS_LABELS: Record<ChangeStatus, string> = {
  DRAFT: "Borrador",
  ASSESSMENT: "En evaluación",
  CAB_APPROVAL: "En aprobación (CAB)",
  SCHEDULED: "Programado",
  IMPLEMENTING: "En implementación",
  REVIEW: "En revisión (PIR)",
  CLOSED: "Cerrado",
  REJECTED: "Rechazado",
  CANCELLED: "Anulado",
};

export const CHANGE_STATUS_CLASSES: Record<ChangeStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  ASSESSMENT: "bg-sky-100 text-sky-800",
  CAB_APPROVAL: "bg-violet-100 text-violet-800",
  SCHEDULED: "bg-indigo-100 text-indigo-800",
  IMPLEMENTING: "bg-blue-100 text-blue-800",
  REVIEW: "bg-amber-100 text-amber-800",
  CLOSED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800",
  CANCELLED: "bg-slate-100 text-slate-500",
};

export const CHANGE_RISK_LABELS: Record<ChangeRisk, string> = { LOW: "Bajo", MEDIUM: "Medio", HIGH: "Alto" };

export const CHANGE_OUTCOME_LABELS: Record<ChangeOutcome, string> = {
  SUCCESSFUL: "Exitoso",
  FAILED: "Fallido",
  BACKED_OUT: "Revertido",
};

// ---- Conocimiento ----------------------------------------------------------
export const KB_STATUS_LABELS: Record<KbStatus, string> = {
  DRAFT: "Borrador",
  IN_REVIEW: "En revisión",
  PUBLISHED: "Publicado",
  RETIRED: "Retirado",
};

export const KB_STATUS_CLASSES: Record<KbStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  IN_REVIEW: "bg-amber-100 text-amber-800",
  PUBLISHED: "bg-emerald-100 text-emerald-800",
  RETIRED: "bg-slate-100 text-slate-500",
};

export const KB_AUDIENCE_LABELS: Record<KbAudience, string> = {
  PUBLIC: "Todos los usuarios",
  INTERNAL: "Solo agentes",
};

export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
  7: "Domingo",
};

// Adjuntos: lo mismo que acepta la API (middlewares/upload.ts), 10 MB.
export const ATTACHMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// Minutos habiles a texto corto: 90 -> "1 h 30 min", 1440 -> "24 h".
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// Tiempo restante hasta un vencimiento (corrido, no habil): "vence en 3 h", "vencido hace 20 min".
export function formatDue(iso: string | null): string {
  if (!iso) return "-";
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  const text =
    minutes < 60 ? `${minutes} min` : minutes < 60 * 48 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} días`;
  return diff >= 0 ? `vence en ${text}` : `vencido hace ${text}`;
}

// Clave de un campo del catalogo ("tipo_equipo") a texto legible ("Tipo equipo").
export function humanizeKey(key: string): string {
  const text = key.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
