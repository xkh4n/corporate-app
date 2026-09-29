import { z } from "zod";

// Reglas puras de los tickets del Service Desk (plan 009): estados y
// transiciones de incidentes y solicitudes (ITIL v4), matriz de prioridad y
// validacion de los campos dinamicos de un item del catalogo. Sin BD.

export const TICKET_TYPES = ["INCIDENT", "SERVICE_REQUEST"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_STATUSES = [
  "PENDING_APPROVAL",
  "NEW",
  "ASSIGNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "RESOLVED",
  "CLOSED",
  "CANCELLED",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

// Estados en los que el ticket sigue vivo para el resolutor (cuentan para la cola y el SLA).
export const OPEN_STATUSES: readonly TicketStatus[] = ["NEW", "ASSIGNED", "IN_PROGRESS", "ON_HOLD"];
// Estados en los que corre el reloj de resolucion (ON_HOLD lo pausa).
export const SLA_RUNNING_STATUSES: readonly TicketStatus[] = ["NEW", "ASSIGNED", "IN_PROGRESS"];
export const FINAL_STATUSES: readonly TicketStatus[] = ["CLOSED", "CANCELLED"];

export const ON_HOLD_REASONS = ["AWAITING_USER", "AWAITING_VENDOR", "AWAITING_CHANGE", "AWAITING_PARTS"] as const;
export type OnHoldReason = (typeof ON_HOLD_REASONS)[number];

export const RESOLUTION_CODES = [
  "FIXED",
  "WORKAROUND",
  "FULFILLED",
  "NO_FAULT_FOUND",
  "USER_EDUCATION",
  "DUPLICATE",
] as const;
export type ResolutionCode = (typeof RESOLUTION_CODES)[number];

export const CHANNELS = ["PORTAL", "PHONE", "EMAIL", "WALK_IN", "AGENT"] as const;
export type Channel = (typeof CHANNELS)[number];

// Transiciones que el agente pide explicitamente por PATCH /status. La
// asignacion (NEW -> ASSIGNED), la aprobacion (PENDING_APPROVAL -> NEW), la
// reapertura y la confirmacion del solicitante tienen su propio endpoint.
const AGENT_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  PENDING_APPROVAL: ["CANCELLED"],
  NEW: ["IN_PROGRESS", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "ON_HOLD", "RESOLVED", "CANCELLED"],
  IN_PROGRESS: ["ON_HOLD", "RESOLVED", "CANCELLED"],
  ON_HOLD: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["IN_PROGRESS", "CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export function canAgentTransition(from: TicketStatus, to: TicketStatus): boolean {
  return AGENT_TRANSITIONS[from].includes(to);
}

export function agentTransitionsFrom(from: TicketStatus): readonly TicketStatus[] {
  return AGENT_TRANSITIONS[from];
}

// El solicitante puede anular mientras nadie empezo a trabajar el ticket.
export function canRequesterCancel(status: TicketStatus): boolean {
  return status === "PENDING_APPROVAL" || status === "NEW" || status === "ASSIGNED";
}

// ---------------------------------------------------------------------------
// Prioridad: impacto (1 alto .. 3 bajo) x urgencia (1 alta .. 3 baja).
// ---------------------------------------------------------------------------
export const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type PriorityMatrix = Map<string, Priority>;

export const DEFAULT_PRIORITY_MATRIX: { impact: number; urgency: number; priority: Priority }[] = [
  { impact: 1, urgency: 1, priority: "P1" },
  { impact: 1, urgency: 2, priority: "P2" },
  { impact: 1, urgency: 3, priority: "P3" },
  { impact: 2, urgency: 1, priority: "P2" },
  { impact: 2, urgency: 2, priority: "P3" },
  { impact: 2, urgency: 3, priority: "P4" },
  { impact: 3, urgency: 1, priority: "P3" },
  { impact: 3, urgency: 2, priority: "P4" },
  { impact: 3, urgency: 3, priority: "P4" },
];

export function matrixKey(impact: number, urgency: number): string {
  return `${impact}:${urgency}`;
}

export function resolvePriority(matrix: PriorityMatrix, impact: number, urgency: number): Priority {
  return matrix.get(matrixKey(impact, urgency)) ?? "P4";
}

// Porcentaje del tiempo de resolucion en que se avisa que el SLA esta en riesgo.
export const SLA_WARNING_RATIO = 0.75;

// ---------------------------------------------------------------------------
// Solicitud de equipo (plan 010): el item del catalogo que genera la solicitud
// de compra y como mueve la compra al ticket vinculado.
// ---------------------------------------------------------------------------
// ROOM_ACCESS (plan 016): el ticket pide acceso a una sala de comunicaciones; el agente lo
// valida y lo envia a aprobacion, y al aprobarse queda el registro de acceso.
export const CATALOG_FULFILLMENTS = ["PURCHASE_REQUEST", "ROOM_ACCESS"] as const;
export type CatalogFulfillment = (typeof CATALOG_FULFILLMENTS)[number];

// ---------------------------------------------------------------------------
// Acceso a salas de comunicaciones (plan 016).
// ---------------------------------------------------------------------------
export const ROOM_ACCESS_TYPES = ["TEMPORARY", "PERMANENT", "SINGLE_USE"] as const;
export type RoomAccessType = (typeof ROOM_ACCESS_TYPES)[number];
export const ROOM_ACCESS_TYPE_LABELS: Record<RoomAccessType, string> = {
  TEMPORARY: "Temporal",
  PERMANENT: "Permanente",
  SINGLE_USE: "Única vez",
};
export const ROOM_BENEFICIARY_KINDS = ["INTERNAL", "EXTERNAL"] as const;
export type RoomBeneficiaryKind = (typeof ROOM_BENEFICIARY_KINDS)[number];

// Reglas de periodo comunes a lo solicitado y a lo validado: permanente sin termino, el resto con
// termino posterior al inicio. Devuelve el mensaje de error o null.
export function roomAccessPeriodError(type: RoomAccessType, from: Date, until: Date | null): string | null {
  if (Number.isNaN(from.getTime())) return "Indique la fecha de inicio del acceso";
  if (type === "PERMANENT") return until ? "Un acceso permanente no lleva fecha de termino" : null;
  if (!until || Number.isNaN(until.getTime())) return "Un acceso temporal o de unica vez requiere fecha de termino";
  if (until.getTime() <= from.getTime()) return "La fecha de termino debe ser posterior al inicio";
  return null;
}

// Estados de la compra desde los que el ticket ya no espera nada de ella: el
// agente vuelve a poder resolverlo o anularlo a mano.
export const PURCHASE_SETTLED_STATUSES: readonly string[] = ["DELIVERED", "CLOSED", "REJECTED", "CANCELLED"];
// El solicitante retira la compra (anulando el ticket) solo antes de que alguien la apruebe.
export const PURCHASE_WITHDRAWABLE_STATUSES: readonly string[] = ["DRAFT", "SUBMITTED"];

export type PurchaseSyncEffect = "EVENT" | "HOLD" | "RESOLVE" | "CLOSE" | "CANCEL";

// Que le pasa al ticket cuando la compra llega a "status". OC emitida: espera al
// proveedor (pausa el SLA). Recepcion completa: resuelto. Rechazo o anulacion:
// el ticket se anula. El resto solo deja constancia en la linea de tiempo.
export function purchaseSyncEffect(status: string): PurchaseSyncEffect {
  switch (status) {
    case "OC_GENERATED":
      return "HOLD";
    case "DELIVERED":
      return "RESOLVE";
    case "CLOSED":
      return "CLOSE";
    case "REJECTED":
    case "CANCELLED":
      return "CANCEL";
    default:
      return "EVENT";
  }
}

// Texto para el solicitante de cada estado de la compra.
export const PURCHASE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Registrada",
  SUBMITTED: "Enviada a aprobación",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  IN_QUOTATION: "En cotización",
  APPROVE_QUOTE: "Cotizaciones en revisión",
  QUOTE_APPROVED: "Cotización aprobada",
  OC_GENERATED: "Orden de compra emitida",
  PENDING_DELIVERY: "Esperando la entrega del proveedor",
  AVAILABLE: "Recepción parcial",
  DELIVERED: "Equipo recepcionado",
  CANCELLED: "Anulada",
  CLOSED: "Cerrada",
};

// ---------------------------------------------------------------------------
// Campos dinamicos de un item del catalogo de servicios.
// ---------------------------------------------------------------------------
export const CATALOG_FIELD_TYPES = ["text", "textarea", "number", "date", "select", "boolean"] as const;

export const catalogFieldSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Clave: minusculas, numeros y _ (max 40)"),
    label: z.string().trim().min(1).max(80),
    type: z.enum(CATALOG_FIELD_TYPES),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  })
  .strict()
  .refine((field) => field.type !== "select" || (field.options?.length ?? 0) > 0, {
    message: "Un campo de seleccion necesita opciones",
  });

export type CatalogField = z.infer<typeof catalogFieldSchema>;

export const catalogFieldsSchema = z
  .array(catalogFieldSchema)
  .max(20)
  .refine((fields) => new Set(fields.map((field) => field.key)).size === fields.length, {
    message: "Las claves de los campos deben ser unicas",
  });

const DATE_VALUE = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Formato esperado: AAAA-MM-DD");

// Esquema zod para las respuestas del solicitante: solo las claves definidas,
// cada una con su tipo; las obligatorias no pueden faltar ni venir vacias.
export function buildVariablesSchema(fields: CatalogField[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    let schema: z.ZodTypeAny;
    switch (field.type) {
      case "text":
        schema = z.string().trim().max(200);
        break;
      case "textarea":
        schema = z.string().trim().max(2000);
        break;
      case "number":
        schema = z.number().finite();
        break;
      case "date":
        schema = DATE_VALUE;
        break;
      case "select":
        schema = z.enum(field.options as [string, ...string[]]);
        break;
      case "boolean":
        schema = z.boolean();
        break;
    }
    if (field.required) {
      shape[field.key] =
        field.type === "text" || field.type === "textarea" ? (schema as z.ZodString).min(1, `${field.label} es obligatorio`) : schema;
    } else {
      shape[field.key] = schema.optional().nullable();
    }
  }
  return z.object(shape).strict();
}
