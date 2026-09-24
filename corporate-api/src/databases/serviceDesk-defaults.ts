import type { CatalogField, Priority, TicketType } from "../library/serviceDesk/ticketRules";

// Configuracion inicial del Service Desk (plan 009). Se siembra UNA vez, solo
// si la tabla correspondiente esta vacia (ver migrateServiceDesk en
// postgres/migrate.ts): despues todo se edita desde "Configuración Service
// Desk" y el arranque no pisa esos cambios.

export const DEFAULT_CALENDAR = {
  name: "Horario hábil Chile",
  timezone: "America/Santiago",
  // Lunes a viernes, 09:00 a 18:00.
  hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "09:00", end: "18:00" })),
};

// Feriados legales de Chile 2026-2027 (con los traslados de la ley vigente al
// armar esta lista). Revisarlos cada anio: se editan desde la configuracion.
export const DEFAULT_HOLIDAYS: { date: string; name: string }[] = [
  { date: "2026-01-01", name: "Año Nuevo" },
  { date: "2026-04-03", name: "Viernes Santo" },
  { date: "2026-04-04", name: "Sábado Santo" },
  { date: "2026-05-01", name: "Día del Trabajo" },
  { date: "2026-05-21", name: "Día de las Glorias Navales" },
  { date: "2026-06-21", name: "Día Nacional de los Pueblos Indígenas" },
  { date: "2026-06-29", name: "San Pedro y San Pablo" },
  { date: "2026-07-16", name: "Virgen del Carmen" },
  { date: "2026-08-15", name: "Asunción de la Virgen" },
  { date: "2026-09-18", name: "Independencia Nacional" },
  { date: "2026-09-19", name: "Día de las Glorias del Ejército" },
  { date: "2026-10-12", name: "Encuentro de Dos Mundos" },
  { date: "2026-10-31", name: "Día de las Iglesias Evangélicas y Protestantes" },
  { date: "2026-11-01", name: "Día de Todos los Santos" },
  { date: "2026-12-08", name: "Inmaculada Concepción" },
  { date: "2026-12-25", name: "Navidad" },
  { date: "2027-01-01", name: "Año Nuevo" },
  { date: "2027-03-26", name: "Viernes Santo" },
  { date: "2027-03-27", name: "Sábado Santo" },
  { date: "2027-05-01", name: "Día del Trabajo" },
  { date: "2027-05-21", name: "Día de las Glorias Navales" },
  { date: "2027-06-21", name: "Día Nacional de los Pueblos Indígenas" },
  { date: "2027-06-28", name: "San Pedro y San Pablo" },
  { date: "2027-07-16", name: "Virgen del Carmen" },
  { date: "2027-08-15", name: "Asunción de la Virgen" },
  { date: "2027-09-17", name: "Feriado adicional Fiestas Patrias" },
  { date: "2027-09-18", name: "Independencia Nacional" },
  { date: "2027-09-19", name: "Día de las Glorias del Ejército" },
  { date: "2027-10-11", name: "Encuentro de Dos Mundos" },
  { date: "2027-10-31", name: "Día de las Iglesias Evangélicas y Protestantes" },
  { date: "2027-11-01", name: "Día de Todos los Santos" },
  { date: "2027-12-08", name: "Inmaculada Concepción" },
  { date: "2027-12-25", name: "Navidad" },
];

// Minutos HABILES: respuesta / resolucion.
export const DEFAULT_SLA_POLICIES: {
  ticketType: TicketType;
  priority: Priority;
  responseMinutes: number;
  resolutionMinutes: number;
}[] = [
  { ticketType: "INCIDENT", priority: "P1", responseMinutes: 30, resolutionMinutes: 240 },
  { ticketType: "INCIDENT", priority: "P2", responseMinutes: 60, resolutionMinutes: 480 },
  { ticketType: "INCIDENT", priority: "P3", responseMinutes: 240, resolutionMinutes: 1440 },
  { ticketType: "INCIDENT", priority: "P4", responseMinutes: 480, resolutionMinutes: 2400 },
  { ticketType: "SERVICE_REQUEST", priority: "P1", responseMinutes: 60, resolutionMinutes: 480 },
  { ticketType: "SERVICE_REQUEST", priority: "P2", responseMinutes: 120, resolutionMinutes: 960 },
  { ticketType: "SERVICE_REQUEST", priority: "P3", responseMinutes: 480, resolutionMinutes: 2400 },
  { ticketType: "SERVICE_REQUEST", priority: "P4", responseMinutes: 960, resolutionMinutes: 4800 },
];

export const DEFAULT_GROUPS = [
  { name: "Mesa de Ayuda N1", description: "Primer contacto: registra, clasifica y resuelve lo conocido" },
  { name: "Soporte N2", description: "Soporte técnico especializado en terreno y remoto" },
  { name: "Infraestructura", description: "Redes, servidores, correo y comunicaciones" },
];

// group: nombre del grupo por defecto de la categoria.
export const DEFAULT_CATEGORIES: { name: string; group: string; appliesTo: string[] }[] = [
  { name: "Hardware", group: "Soporte N2", appliesTo: ["INCIDENT", "SERVICE_REQUEST", "PROBLEM", "CHANGE"] },
  { name: "Software", group: "Mesa de Ayuda N1", appliesTo: ["INCIDENT", "SERVICE_REQUEST", "PROBLEM", "CHANGE"] },
  { name: "Red y conectividad", group: "Infraestructura", appliesTo: ["INCIDENT", "PROBLEM", "CHANGE"] },
  { name: "Correo y colaboración", group: "Infraestructura", appliesTo: ["INCIDENT", "SERVICE_REQUEST", "PROBLEM", "CHANGE"] },
  { name: "Accesos y cuentas", group: "Mesa de Ayuda N1", appliesTo: ["INCIDENT", "SERVICE_REQUEST"] },
  { name: "Impresoras", group: "Soporte N2", appliesTo: ["INCIDENT", "SERVICE_REQUEST", "PROBLEM"] },
  { name: "Otros", group: "Mesa de Ayuda N1", appliesTo: ["INCIDENT", "SERVICE_REQUEST"] },
];

export const DEFAULT_CATALOG_ITEMS: { name: string; description: string; category: string; fields: CatalogField[] }[] = [
  {
    name: "Solicitud de equipo",
    description: "Notebook, monitor, periféricos u otro equipo para un colaborador.",
    category: "Hardware",
    fields: [
      {
        key: "equipo",
        label: "Equipo",
        type: "select",
        required: true,
        options: ["Notebook", "Monitor", "Teclado/Mouse", "Teléfono", "Otro"],
      },
      { key: "justificacion", label: "Justificación", type: "textarea", required: true },
    ],
  },
  {
    name: "Acceso a sistema",
    description: "Alta o cambio de permisos en un sistema corporativo.",
    category: "Accesos y cuentas",
    fields: [
      { key: "sistema", label: "Sistema", type: "text", required: true },
      { key: "perfil", label: "Perfil o permiso requerido", type: "text", required: true },
    ],
  },
  {
    name: "Instalación de software",
    description: "Instalación de un programa licenciado o autorizado.",
    category: "Software",
    fields: [
      { key: "software", label: "Software", type: "text", required: true },
      { key: "equipo", label: "Etiqueta del equipo", type: "text", required: false },
    ],
  },
  {
    name: "Restablecer contraseña",
    description: "Desbloqueo o restablecimiento de contraseña de una cuenta.",
    category: "Accesos y cuentas",
    fields: [{ key: "cuenta", label: "Cuenta o sistema", type: "text", required: true }],
  },
];
