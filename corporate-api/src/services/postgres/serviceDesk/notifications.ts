import { logger } from "../../../library/logger";
import { sendMailViaMailer } from "../../../library/mailerClient";
import { notifyServiceDesk, type NotificationReason } from "../../../library/realtime/notify";
import { getUserDirectory } from "../../mssql/user.service";
import { getGroupContacts } from "./settings.service";

// Avisos del Service Desk (plan 009): push en tiempo real + correo en texto
// plano. Se disparan DESPUES del commit y son best-effort: un correo o un push
// que falla nunca revierte el cambio del ticket (mismo contrato que
// sendMailViaMailer y notifyUser).

export interface NotifiableRecord {
  id: number;
  number: string;
  title: string;
}

const FOOTER = "\n\n--\nMensaje automático de la Mesa de Servicios. No responda este correo.";

async function emailUsers(userIds: (number | null | undefined)[], subject: string, text: string): Promise<void> {
  const ids = [...new Set(userIds.filter((id): id is number => typeof id === "number"))];
  if (ids.length === 0) return;
  const directory = await getUserDirectory(ids);
  const to = [...directory.values()].filter((entry) => entry.isActive && entry.email).map((entry) => entry.email!);
  if (to.length === 0) return;
  const result = await sendMailViaMailer({ to, subject, text: text + FOOTER });
  if (!result.ok) logger.warn({ error: result.error, subject }, "Service Desk: no se pudo enviar el correo");
}

// Ejecuta el aviso sin bloquear la respuesta y sin propagar errores.
export function fireAndForget(task: () => Promise<void>): void {
  void task().catch((err) => logger.error({ err }, "Service Desk: fallo un aviso"));
}

export function pushTo(userIds: (number | null | undefined)[], reason: NotificationReason, record: NotifiableRecord): void {
  notifyServiceDesk(userIds, reason, record);
}

export async function emailRequester(requesterUserId: number, record: NotifiableRecord, subject: string, body: string): Promise<void> {
  await emailUsers([requesterUserId], `[${record.number}] ${subject}`, `${body}\n\nTicket: ${record.number} - ${record.title}\nPuede seguirlo en Solicitudes › Generar Ticket › Mis tickets.`);
}

export async function emailUsersAbout(
  userIds: (number | null | undefined)[],
  record: NotifiableRecord,
  subject: string,
  body: string,
): Promise<void> {
  await emailUsers(userIds, `[${record.number}] ${subject}`, `${body}\n\n${record.number} - ${record.title}`);
}

// Aviso al grupo: push a sus lideres (o a todos si no tiene lideres) y correo al buzon del grupo.
export async function notifyGroup(
  groupId: number | null,
  reason: NotificationReason,
  record: NotifiableRecord,
  subject: string,
  body: string,
  options: { allMembers?: boolean } = {},
): Promise<void> {
  if (groupId === null) return;
  const contacts = await getGroupContacts(groupId);
  if (!contacts) return;
  const pushTargets =
    options.allMembers || contacts.leadUserIds.length === 0 ? contacts.memberUserIds : contacts.leadUserIds;
  pushTo(pushTargets, reason, record);
  const text = `${body}\n\n${record.number} - ${record.title}\nGrupo: ${contacts.name}`;
  if (contacts.email) {
    const result = await sendMailViaMailer({ to: [contacts.email], subject: `[${record.number}] ${subject}`, text: text + FOOTER });
    if (!result.ok) logger.warn({ error: result.error, groupId }, "Service Desk: no se pudo enviar el correo al grupo");
  } else if (options.allMembers) {
    await emailUsers(contacts.memberUserIds, `[${record.number}] ${subject}`, text);
  }
}
