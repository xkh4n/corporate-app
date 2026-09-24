import { QueryTypes, type Transaction } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";
import { BadRequestError, ConflictError, ForbiddenError, isUniqueConstraintError, NotFoundError } from "../../../library/errors";
import { assertValidTimezone, parseHHMM, type BusinessCalendar } from "../../../library/serviceDesk/businessTime";
import {
  matrixKey,
  type CatalogField,
  type Priority,
  type PriorityMatrix,
  type TicketType,
} from "../../../library/serviceDesk/ticketRules";
import { getUserByIdOrThrow, getUserDirectory } from "../../mssql/user.service";

// Configuracion del Service Desk (plan 009): grupos resolutores y sus
// miembros, categorias, catalogo de servicios, calendario habil, matriz de
// prioridad y politicas de SLA.

// ---------------------------------------------------------------------------
// Grupos de soporte
// ---------------------------------------------------------------------------
export interface GroupMember {
  userId: number;
  fullName: string;
  isLead: boolean;
}

export interface SupportGroup {
  id: number;
  name: string;
  description: string | null;
  email: string | null;
  isActive: boolean;
  members: GroupMember[];
}

export async function listGroups(options: { activeOnly?: boolean } = {}): Promise<SupportGroup[]> {
  const groups = await postgres.query<Omit<SupportGroup, "members">>(
    `SELECT id, name, description, email, is_active AS "isActive" FROM support_groups
      ${options.activeOnly ? "WHERE is_active" : ""} ORDER BY name`,
    { type: QueryTypes.SELECT },
  );
  const members = await postgres.query<{ groupId: number; userId: number; isLead: boolean }>(
    `SELECT group_id AS "groupId", user_id AS "userId", is_lead AS "isLead" FROM support_group_members ORDER BY is_lead DESC, user_id`,
    { type: QueryTypes.SELECT },
  );
  const directory = await getUserDirectory(members.map((member) => member.userId));
  return groups.map((group) => ({
    ...group,
    members: members
      .filter((member) => member.groupId === group.id)
      .map((member) => ({
        userId: member.userId,
        isLead: member.isLead,
        fullName: directory.get(member.userId)?.fullName ?? `Usuario ${member.userId}`,
      })),
  }));
}

export async function getGroupOrThrow(id: number): Promise<SupportGroup> {
  const group = (await listGroups()).find((candidate) => candidate.id === id);
  if (!group) throw new NotFoundError(`El grupo ${id} no existe`);
  return group;
}

export interface GroupInput {
  name: string;
  description?: string | null;
  email?: string | null;
  isActive?: boolean;
}

// Nombre repetido -> 409; grupo/categoria/calendario inexistente (FK) -> 400, no un 500.
function rethrowDuplicate(err: unknown, message: string): never {
  if (isUniqueConstraintError(err)) throw new ConflictError(message);
  if (err instanceof Error && err.name === "SequelizeForeignKeyConstraintError") {
    throw new BadRequestError("Hace referencia a un grupo, categoria o calendario que no existe");
  }
  throw err;
}

export async function createGroup(input: GroupInput): Promise<SupportGroup> {
  try {
    const [row] = await postgres.query<{ id: number }>(
      `INSERT INTO support_groups (name, description, email, is_active)
       VALUES (:name, :description, :email, :isActive) RETURNING id`,
      {
        replacements: {
          name: input.name,
          description: input.description ?? null,
          email: input.email ?? null,
          isActive: input.isActive ?? true,
        },
        type: QueryTypes.SELECT,
      },
    );
    return getGroupOrThrow(row!.id);
  } catch (err) {
    rethrowDuplicate(err, `Ya existe un grupo llamado ${input.name}`);
  }
}

export async function updateGroup(id: number, input: GroupInput): Promise<SupportGroup> {
  try {
    const [row] = await postgres.query<{ id: number }>(
      `UPDATE support_groups SET name = :name, description = :description, email = :email,
              is_active = COALESCE(:isActive, is_active), updated_at = now()
        WHERE id = :id RETURNING id`,
      {
        replacements: {
          id,
          name: input.name,
          description: input.description ?? null,
          email: input.email ?? null,
          // Sin isActive se conserva el estado: editar el nombre no reactiva el grupo.
          isActive: input.isActive ?? null,
        },
        type: QueryTypes.SELECT,
      },
    );
    if (!row) throw new NotFoundError(`El grupo ${id} no existe`);
    return getGroupOrThrow(id);
  } catch (err) {
    rethrowDuplicate(err, `Ya existe un grupo llamado ${input.name}`);
  }
}

// Reemplaza la lista completa de miembros (lo que se ve en pantalla es lo que queda).
// actor: quien edita; salvo el admin, nadie cambia su propia membresia (entrar a
// un grupo da acceso a sus tickets). Quien sale del grupo suelta sus tickets
// abiertos de ese grupo: vuelven a la cola (run-3, N5).
export async function replaceGroupMembers(
  id: number,
  members: { userId: number; isLead: boolean }[],
  actor: { userId: number; isAdmin?: boolean } | null = null,
): Promise<SupportGroup> {
  const unique = new Map(members.map((member) => [member.userId, member.isLead]));
  for (const userId of unique.keys()) await getUserByIdOrThrow(userId);
  await postgres.transaction(async (transaction) => {
    const [group] = await postgres.query(`SELECT id FROM support_groups WHERE id = :id FOR UPDATE`, {
      replacements: { id },
      type: QueryTypes.SELECT,
      transaction,
    });
    if (!group) throw new NotFoundError(`El grupo ${id} no existe`);
    const current = await postgres.query<{ userId: number }>(
      `SELECT user_id AS "userId" FROM support_group_members WHERE group_id = :id`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction },
    );
    const before = new Set(current.map((row) => row.userId));
    if (actor && !actor.isAdmin && before.has(actor.userId) !== unique.has(actor.userId)) {
      throw new ForbiddenError("No puede cambiar su propia membresia en un grupo: pidalo al administrador");
    }
    const removed = [...before].filter((userId) => !unique.has(userId));
    if (removed.length > 0) {
      const released = await postgres.query<{ id: number; assigneeUserId: number }>(
        `UPDATE service_tickets t SET assignee_user_id = NULL, updated_at = now(),
                status = CASE WHEN t.status IN ('ASSIGNED','IN_PROGRESS') THEN 'NEW' ELSE t.status END
           FROM (SELECT id, assignee_user_id FROM service_tickets
                  WHERE assigned_group_id = :id AND assignee_user_id IN (:removed)
                    AND status NOT IN ('RESOLVED','CLOSED','CANCELLED') FOR UPDATE) prev
          WHERE t.id = prev.id
          RETURNING t.id, prev.assignee_user_id AS "assigneeUserId"`,
        { replacements: { id, removed }, type: QueryTypes.SELECT, transaction },
      );
      for (const ticket of released) {
        await postgres.query(
          `INSERT INTO service_ticket_events (ticket_id, event_type, actor_user_id, is_public, payload)
           VALUES (:ticketId, 'ASSIGNED', :actorId, false, CAST(:payload AS JSONB))`,
          {
            replacements: {
              ticketId: ticket.id,
              actorId: actor?.userId ?? null,
              payload: JSON.stringify({ fromAssigneeUserId: ticket.assigneeUserId, toAssigneeUserId: null, reason: "REMOVED_FROM_GROUP" }),
            },
            transaction,
          },
        );
      }
    }
    await postgres.query(`DELETE FROM support_group_members WHERE group_id = :id`, { replacements: { id }, transaction });
    for (const [userId, isLead] of unique) {
      await postgres.query(
        `INSERT INTO support_group_members (group_id, user_id, is_lead) VALUES (:id, :userId, :isLead)`,
        { replacements: { id, userId, isLead }, transaction },
      );
    }
  });
  return getGroupOrThrow(id);
}

export async function isGroupMember(groupId: number, userId: number, transaction?: Transaction): Promise<boolean> {
  const rows = await postgres.query(
    `SELECT 1 FROM support_group_members m JOIN support_groups g ON g.id = m.group_id
      WHERE m.group_id = :groupId AND m.user_id = :userId AND g.is_active`,
    { replacements: { groupId, userId }, type: QueryTypes.SELECT, transaction },
  );
  return rows.length > 0;
}

export async function listGroupIdsOfUser(userId: number): Promise<number[]> {
  const rows = await postgres.query<{ groupId: number }>(
    `SELECT group_id AS "groupId" FROM support_group_members WHERE user_id = :userId`,
    { replacements: { userId }, type: QueryTypes.SELECT },
  );
  return rows.map((row) => row.groupId);
}

// Destinatarios de un aviso al grupo: correo del grupo (si tiene) y sus lideres.
export async function getGroupContacts(
  groupId: number,
  transaction?: Transaction,
): Promise<{ name: string; email: string | null; leadUserIds: number[]; memberUserIds: number[] } | null> {
  const [group] = await postgres.query<{ name: string; email: string | null }>(
    `SELECT name, email FROM support_groups WHERE id = :groupId`,
    { replacements: { groupId }, type: QueryTypes.SELECT, transaction },
  );
  if (!group) return null;
  const members = await postgres.query<{ userId: number; isLead: boolean }>(
    `SELECT user_id AS "userId", is_lead AS "isLead" FROM support_group_members WHERE group_id = :groupId`,
    { replacements: { groupId }, type: QueryTypes.SELECT, transaction },
  );
  return {
    ...group,
    leadUserIds: members.filter((member) => member.isLead).map((member) => member.userId),
    memberUserIds: members.map((member) => member.userId),
  };
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------
export interface ServiceCategory {
  id: number;
  parentId: number | null;
  name: string;
  defaultGroupId: number | null;
  appliesTo: string[];
  isActive: boolean;
}

const CATEGORY_COLUMNS = `id, parent_id AS "parentId", name, default_group_id AS "defaultGroupId",
  applies_to AS "appliesTo", is_active AS "isActive"`;

export async function listCategories(options: { activeOnly?: boolean } = {}): Promise<ServiceCategory[]> {
  return postgres.query<ServiceCategory>(
    `SELECT ${CATEGORY_COLUMNS} FROM service_categories ${options.activeOnly ? "WHERE is_active" : ""}
      ORDER BY COALESCE(parent_id, id), parent_id NULLS FIRST, name`,
    { type: QueryTypes.SELECT },
  );
}

export async function getCategory(id: number, transaction?: Transaction): Promise<ServiceCategory | null> {
  const [row] = await postgres.query<ServiceCategory>(`SELECT ${CATEGORY_COLUMNS} FROM service_categories WHERE id = :id`, {
    replacements: { id },
    type: QueryTypes.SELECT,
    transaction,
  });
  return row ?? null;
}

export interface CategoryInput {
  parentId?: number | null;
  name: string;
  defaultGroupId?: number | null;
  appliesTo: string[];
  isActive?: boolean;
}

async function assertCategoryParent(parentId: number | null | undefined, selfId?: number): Promise<void> {
  if (parentId === null || parentId === undefined) return;
  if (parentId === selfId) throw new BadRequestError("Una categoria no puede ser su propia padre");
  const parent = await getCategory(parentId);
  if (!parent) throw new BadRequestError(`La categoria padre ${parentId} no existe`);
  // Dos niveles (categoria > subcategoria): alcanza para clasificar y el arbol no se vuelve ciclico.
  if (parent.parentId !== null) throw new BadRequestError("Solo se admiten dos niveles: categoria y subcategoria");
}

export async function createCategory(input: CategoryInput): Promise<ServiceCategory> {
  await assertCategoryParent(input.parentId);
  try {
    const [row] = await postgres.query<ServiceCategory>(
      `INSERT INTO service_categories (parent_id, name, default_group_id, applies_to, is_active)
       VALUES (:parentId, :name, :defaultGroupId, ARRAY[:appliesTo]::VARCHAR(20)[], :isActive)
       RETURNING ${CATEGORY_COLUMNS}`,
      {
        replacements: {
          parentId: input.parentId ?? null,
          name: input.name,
          defaultGroupId: input.defaultGroupId ?? null,
          appliesTo: input.appliesTo,
          isActive: input.isActive ?? true,
        },
        type: QueryTypes.SELECT,
      },
    );
    return row!;
  } catch (err) {
    rethrowDuplicate(err, `Ya existe la categoria ${input.name} en ese nivel`);
  }
}

export async function updateCategory(id: number, input: CategoryInput): Promise<ServiceCategory> {
  await assertCategoryParent(input.parentId, id);
  if (input.parentId) {
    const [child] = await postgres.query(`SELECT 1 FROM service_categories WHERE parent_id = :id LIMIT 1`, {
      replacements: { id },
      type: QueryTypes.SELECT,
    });
    if (child) throw new BadRequestError("Una categoria con subcategorias no puede pasar a ser subcategoria");
  }
  try {
    const [row] = await postgres.query<ServiceCategory>(
      `UPDATE service_categories SET parent_id = :parentId, name = :name, default_group_id = :defaultGroupId,
              applies_to = ARRAY[:appliesTo]::VARCHAR(20)[], is_active = :isActive, updated_at = now()
        WHERE id = :id RETURNING ${CATEGORY_COLUMNS}`,
      {
        replacements: {
          id,
          parentId: input.parentId ?? null,
          name: input.name,
          defaultGroupId: input.defaultGroupId ?? null,
          appliesTo: input.appliesTo,
          isActive: input.isActive ?? true,
        },
        type: QueryTypes.SELECT,
      },
    );
    if (!row) throw new NotFoundError(`La categoria ${id} no existe`);
    return row;
  } catch (err) {
    rethrowDuplicate(err, `Ya existe la categoria ${input.name} en ese nivel`);
  }
}

// ---------------------------------------------------------------------------
// Catalogo de servicios
// ---------------------------------------------------------------------------
export interface CatalogItem {
  id: number;
  name: string;
  description: string | null;
  categoryId: number | null;
  defaultGroupId: number | null;
  approvalGroupId: number | null;
  fields: CatalogField[];
  isActive: boolean;
}

const CATALOG_COLUMNS = `id, name, description, category_id AS "categoryId", default_group_id AS "defaultGroupId",
  approval_group_id AS "approvalGroupId", fields, is_active AS "isActive"`;

export async function listCatalogItems(options: { activeOnly?: boolean } = {}): Promise<CatalogItem[]> {
  return postgres.query<CatalogItem>(
    `SELECT ${CATALOG_COLUMNS} FROM service_catalog_items ${options.activeOnly ? "WHERE is_active" : ""} ORDER BY name`,
    { type: QueryTypes.SELECT },
  );
}

export async function getCatalogItem(id: number, transaction?: Transaction): Promise<CatalogItem | null> {
  const [row] = await postgres.query<CatalogItem>(`SELECT ${CATALOG_COLUMNS} FROM service_catalog_items WHERE id = :id`, {
    replacements: { id },
    type: QueryTypes.SELECT,
    transaction,
  });
  return row ?? null;
}

export interface CatalogItemInput {
  name: string;
  description?: string | null;
  categoryId?: number | null;
  defaultGroupId?: number | null;
  approvalGroupId?: number | null;
  fields: CatalogField[];
  isActive?: boolean;
}

function catalogReplacements(input: CatalogItemInput) {
  return {
    name: input.name,
    description: input.description ?? null,
    categoryId: input.categoryId ?? null,
    defaultGroupId: input.defaultGroupId ?? null,
    approvalGroupId: input.approvalGroupId ?? null,
    fields: JSON.stringify(input.fields),
    isActive: input.isActive ?? true,
  };
}

export async function createCatalogItem(input: CatalogItemInput): Promise<CatalogItem> {
  try {
    const [row] = await postgres.query<CatalogItem>(
      `INSERT INTO service_catalog_items (name, description, category_id, default_group_id, approval_group_id, fields, is_active)
       VALUES (:name, :description, :categoryId, :defaultGroupId, :approvalGroupId, CAST(:fields AS JSONB), :isActive)
       RETURNING ${CATALOG_COLUMNS}`,
      { replacements: catalogReplacements(input), type: QueryTypes.SELECT },
    );
    return row!;
  } catch (err) {
    rethrowDuplicate(err, `Ya existe el item de catalogo ${input.name}`);
  }
}

export async function updateCatalogItem(id: number, input: CatalogItemInput): Promise<CatalogItem> {
  try {
    const [row] = await postgres.query<CatalogItem>(
      `UPDATE service_catalog_items SET name = :name, description = :description, category_id = :categoryId,
              default_group_id = :defaultGroupId, approval_group_id = :approvalGroupId,
              fields = CAST(:fields AS JSONB), is_active = :isActive, updated_at = now()
        WHERE id = :id RETURNING ${CATALOG_COLUMNS}`,
      { replacements: { id, ...catalogReplacements(input) }, type: QueryTypes.SELECT },
    );
    if (!row) throw new NotFoundError(`El item de catalogo ${id} no existe`);
    return row;
  } catch (err) {
    rethrowDuplicate(err, `Ya existe el item de catalogo ${input.name}`);
  }
}

// ---------------------------------------------------------------------------
// Calendario habil
// ---------------------------------------------------------------------------
export interface CalendarDetail {
  id: number;
  name: string;
  timezone: string;
  isDefault: boolean;
  hours: { weekday: number; start: string; end: string }[];
  holidays: { date: string; name: string }[];
}

export async function listCalendars(): Promise<CalendarDetail[]> {
  const calendars = await postgres.query<Omit<CalendarDetail, "hours" | "holidays">>(
    `SELECT id, name, timezone, is_default AS "isDefault" FROM business_calendars ORDER BY is_default DESC, name`,
    { type: QueryTypes.SELECT },
  );
  const hours = await postgres.query<{ calendarId: number; weekday: number; start: string; end: string }>(
    `SELECT calendar_id AS "calendarId", weekday, to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS "end"
       FROM business_hours ORDER BY weekday, start_time`,
    { type: QueryTypes.SELECT },
  );
  const holidays = await postgres.query<{ calendarId: number; date: string; name: string }>(
    `SELECT calendar_id AS "calendarId", to_char(holiday_date, 'YYYY-MM-DD') AS date, name
       FROM business_holidays ORDER BY holiday_date`,
    { type: QueryTypes.SELECT },
  );
  return calendars.map((calendar) => ({
    ...calendar,
    hours: hours.filter((row) => row.calendarId === calendar.id).map(({ weekday, start, end }) => ({ weekday, start, end })),
    holidays: holidays.filter((row) => row.calendarId === calendar.id).map(({ date, name }) => ({ date, name })),
  }));
}

// Calendario para el calculo del SLA: el indicado, o el por defecto.
export async function loadBusinessCalendar(
  calendarId: number | null,
  transaction?: Transaction,
): Promise<{ id: number; calendar: BusinessCalendar }> {
  const [row] = await postgres.query<{ id: number; timezone: string }>(
    calendarId
      ? `SELECT id, timezone FROM business_calendars WHERE id = :calendarId`
      : `SELECT id, timezone FROM business_calendars WHERE is_default`,
    { replacements: { calendarId }, type: QueryTypes.SELECT, transaction },
  );
  if (!row) throw new ConflictError("No hay un calendario habil configurado para calcular el SLA");
  const hours = await postgres.query<{ weekday: number; start: string; end: string }>(
    `SELECT weekday, to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS "end"
       FROM business_hours WHERE calendar_id = :id`,
    { replacements: { id: row.id }, type: QueryTypes.SELECT, transaction },
  );
  const holidays = await postgres.query<{ date: string }>(
    `SELECT to_char(holiday_date, 'YYYY-MM-DD') AS date FROM business_holidays WHERE calendar_id = :id`,
    { replacements: { id: row.id }, type: QueryTypes.SELECT, transaction },
  );
  return { id: row.id, calendar: { timezone: row.timezone, hours, holidays: holidays.map((holiday) => holiday.date) } };
}

export interface CalendarInput {
  name: string;
  timezone: string;
  hours: { weekday: number; start: string; end: string }[];
}

export async function updateCalendar(id: number, input: CalendarInput): Promise<CalendarDetail> {
  try {
    assertValidTimezone(input.timezone);
  } catch {
    throw new BadRequestError(`Zona horaria desconocida: ${input.timezone}`);
  }
  if (input.hours.length === 0) throw new BadRequestError("El calendario necesita al menos un tramo de horario habil");
  for (const hour of input.hours) {
    if (parseHHMM(hour.end) <= parseHHMM(hour.start)) {
      throw new BadRequestError("Cada tramo debe terminar despues de empezar (sin cruzar la medianoche)");
    }
  }
  await postgres.transaction(async (transaction) => {
    const [row] = await postgres.query(
      `UPDATE business_calendars SET name = :name, timezone = :timezone, updated_at = now() WHERE id = :id RETURNING id`,
      { replacements: { id, name: input.name, timezone: input.timezone }, type: QueryTypes.SELECT, transaction },
    );
    if (!row) throw new NotFoundError(`El calendario ${id} no existe`);
    await postgres.query(`DELETE FROM business_hours WHERE calendar_id = :id`, { replacements: { id }, transaction });
    for (const hour of input.hours) {
      await postgres.query(
        `INSERT INTO business_hours (calendar_id, weekday, start_time, end_time) VALUES (:id, :weekday, :start, :end)`,
        { replacements: { id, ...hour }, transaction },
      );
    }
  });
  const calendar = (await listCalendars()).find((candidate) => candidate.id === id);
  return calendar!;
}

export async function addHoliday(calendarId: number, date: string, name: string): Promise<void> {
  const [calendar] = await postgres.query(`SELECT id FROM business_calendars WHERE id = :calendarId`, {
    replacements: { calendarId },
    type: QueryTypes.SELECT,
  });
  if (!calendar) throw new NotFoundError(`El calendario ${calendarId} no existe`);
  await postgres.query(
    `INSERT INTO business_holidays (calendar_id, holiday_date, name) VALUES (:calendarId, :date, :name)
     ON CONFLICT (calendar_id, holiday_date) DO UPDATE SET name = EXCLUDED.name`,
    { replacements: { calendarId, date, name } },
  );
}

export async function removeHoliday(calendarId: number, date: string): Promise<void> {
  const [row] = await postgres.query(
    `DELETE FROM business_holidays WHERE calendar_id = :calendarId AND holiday_date = :date RETURNING holiday_date`,
    { replacements: { calendarId, date }, type: QueryTypes.SELECT },
  );
  if (!row) throw new NotFoundError(`El feriado ${date} no existe en el calendario`);
}

// ---------------------------------------------------------------------------
// Matriz de prioridad y SLA
// ---------------------------------------------------------------------------
export interface PriorityMatrixRow {
  impact: number;
  urgency: number;
  priority: Priority;
}

export async function listPriorityMatrix(transaction?: Transaction): Promise<PriorityMatrixRow[]> {
  return postgres.query<PriorityMatrixRow>(`SELECT impact, urgency, priority FROM priority_matrix ORDER BY impact, urgency`, {
    type: QueryTypes.SELECT,
    transaction,
  });
}

export async function loadPriorityMatrix(transaction?: Transaction): Promise<PriorityMatrix> {
  const rows = await listPriorityMatrix(transaction);
  return new Map(rows.map((row) => [matrixKey(row.impact, row.urgency), row.priority]));
}

export async function replacePriorityMatrix(rows: PriorityMatrixRow[]): Promise<PriorityMatrixRow[]> {
  const keys = new Set(rows.map((row) => matrixKey(row.impact, row.urgency)));
  if (keys.size !== 9 || rows.length !== 9) throw new BadRequestError("La matriz debe tener las 9 combinaciones de impacto y urgencia");
  await postgres.transaction(async (transaction) => {
    for (const row of rows) {
      await postgres.query(
        `INSERT INTO priority_matrix (impact, urgency, priority) VALUES (:impact, :urgency, :priority)
         ON CONFLICT (impact, urgency) DO UPDATE SET priority = EXCLUDED.priority`,
        { replacements: { ...row }, transaction },
      );
    }
  });
  return listPriorityMatrix();
}

export interface SlaPolicy {
  id: number;
  ticketType: TicketType;
  priority: Priority;
  responseMinutes: number;
  resolutionMinutes: number;
  calendarId: number | null;
}

const SLA_COLUMNS = `id, ticket_type AS "ticketType", priority, response_minutes AS "responseMinutes",
  resolution_minutes AS "resolutionMinutes", calendar_id AS "calendarId"`;

export async function listSlaPolicies(): Promise<SlaPolicy[]> {
  return postgres.query<SlaPolicy>(`SELECT ${SLA_COLUMNS} FROM sla_policies ORDER BY ticket_type, priority`, {
    type: QueryTypes.SELECT,
  });
}

export async function getSlaPolicy(
  ticketType: TicketType,
  priority: Priority,
  transaction?: Transaction,
): Promise<SlaPolicy | null> {
  const [row] = await postgres.query<SlaPolicy>(
    `SELECT ${SLA_COLUMNS} FROM sla_policies WHERE ticket_type = :ticketType AND priority = :priority`,
    { replacements: { ticketType, priority }, type: QueryTypes.SELECT, transaction },
  );
  return row ?? null;
}

export async function upsertSlaPolicies(policies: Omit<SlaPolicy, "id">[]): Promise<SlaPolicy[]> {
  try {
    await saveSlaPolicies(policies);
  } catch (err) {
    rethrowDuplicate(err, "Politica de SLA repetida");
  }
  return listSlaPolicies();
}

async function saveSlaPolicies(policies: Omit<SlaPolicy, "id">[]): Promise<void> {
  await postgres.transaction(async (transaction) => {
    for (const policy of policies) {
      await postgres.query(
        `INSERT INTO sla_policies (ticket_type, priority, response_minutes, resolution_minutes, calendar_id)
         VALUES (:ticketType, :priority, :responseMinutes, :resolutionMinutes, :calendarId)
         ON CONFLICT (ticket_type, priority) DO UPDATE SET response_minutes = EXCLUDED.response_minutes,
           resolution_minutes = EXCLUDED.resolution_minutes, calendar_id = EXCLUDED.calendar_id, updated_at = now()`,
        { replacements: { ...policy, calendarId: policy.calendarId ?? null }, transaction },
      );
    }
  });
}
