import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Alert, Button, EmptyState, Field, Input, Modal, Select, Textarea } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { Pager } from "../contabilidad/Pager";
import { formatDateTime } from "../inventario/inventoryLabels";
import { serviceChangeService, serviceDeskSettingsService, type CatalogItemPayload } from "../../services/serviceDeskService";
import type {
  CatalogFulfillment,
  BusinessCalendar,
  CatalogField,
  CatalogFieldType,
  CatalogItem,
  ChangeTemplate,
  Priority,
  PriorityMatrixRow,
  ServiceCategory,
  SettingsAuditAction,
  SettingsAuditRecord,
  SlaPolicy,
  SupportGroup,
  TicketType,
} from "../../types/serviceDesk";
import { Badge, CARD, Loading, Section, TD, TH, Tabs, UserSearch } from "./components";
import { LEVEL_LABELS, PRIORITY_CLASSES, PRIORITY_LABELS, TYPE_LABELS, WEEKDAY_LABELS, formatMinutes } from "./serviceDeskLabels";

// Configuracion del Service Desk (plan 009): grupos resolutores y miembros,
// categorias, catalogo de servicios con formulario propio, calendario habil y
// feriados, matriz de prioridad, SLA, plantillas de cambio estandar y la
// auditoria de todos esos cambios.
const REQUIRED_PERMISSIONS = ["service-desk-settings:read"] as const;

type SettingsTab = "groups" | "categories" | "catalog" | "calendar" | "sla" | "templates" | "audit";

export default function ServiceDeskSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as SettingsTab | null;
  const tabs: { key: SettingsTab; label: string }[] = [
    { key: "groups", label: "Grupos" },
    { key: "categories", label: "Categorías" },
    { key: "catalog", label: "Catálogo de servicios" },
    { key: "calendar", label: "Calendario hábil" },
    { key: "sla", label: "Prioridad y SLA" },
    { key: "templates", label: "Cambios estándar" },
    { key: "audit", label: "Auditoría" },
  ];
  const tab: SettingsTab = tabs.some((item) => item.key === tabParam) ? tabParam! : "groups";

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Configuración Service Desk</h1>
        <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
          <Tabs tabs={tabs} active={tab} onChange={(key) => setSearchParams({ tab: key })} />
          <SettingsData tab={tab} />
        </div>
      </div>
    </RequirePermissions>
  );
}

function SettingsData({ tab }: { tab: SettingsTab }) {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<SupportGroup[] | null>(null);
  const [categories, setCategories] = useState<ServiceCategory[] | null>(null);

  const loadBase = useCallback(async () => {
    try {
      const [loadedGroups, loadedCategories] = await Promise.all([serviceDeskSettingsService.groups(), serviceDeskSettingsService.categories()]);
      setGroups(loadedGroups);
      setCategories(loadedCategories);
    } catch (error) {
      handleError(error, navigate);
    }
  }, [navigate]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  if (!groups || !categories) return <Loading />;
  switch (tab) {
    case "groups":
      return <GroupsSettings groups={groups} onChanged={loadBase} />;
    case "categories":
      return <CategoriesSettings categories={categories} groups={groups} onChanged={loadBase} />;
    case "catalog":
      return <CatalogSettings categories={categories} groups={groups} />;
    case "calendar":
      return <CalendarSettings />;
    case "sla":
      return <SlaSettings />;
    case "templates":
      return <TemplateSettings categories={categories} />;
    case "audit":
      return <AuditSettings />;
  }
}

function useCanEdit(): boolean {
  return useAuth().can("service-desk-settings:update");
}

// ---------------------------------------------------------------------------
// Grupos
// ---------------------------------------------------------------------------
function GroupsSettings({ groups, onChanged }: { groups: SupportGroup[]; onChanged: () => Promise<void> }) {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [editing, setEditing] = useState<SupportGroup | "new" | null>(null);
  const [members, setMembers] = useState<SupportGroup | null>(null);

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex justify-end">
          <Button type="button" onClick={() => setEditing("new")}>
            Nuevo grupo
          </Button>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((group) => (
          <div key={group.id} className={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-slate-800">{group.name}</h3>
              {/* Va en el número de los tickets que el grupo recibe: REQ2026<código>000001. */}
              <Badge className="bg-sky-100 text-sky-800">Código {group.code}</Badge>
              {!group.isActive && <Badge className="bg-slate-100 text-slate-500">Inactivo</Badge>}
            </div>
            <p className="text-sm text-slate-600">{group.description ?? ""}</p>
            <p className="text-xs text-slate-500">Buzón: {group.email ?? "sin correo (se avisa a los líderes)"}</p>
            <ul className="mt-2 text-sm">
              {group.members.length === 0 && <li className="text-slate-500">Sin miembros</li>}
              {group.members.map((member) => (
                <li key={member.userId}>
                  {member.fullName} {member.isLead && <Badge className="bg-sky-100 text-sky-800">Líder</Badge>}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="mt-3 flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setEditing(group)}>
                  Editar
                </Button>
                <Button type="button" variant="secondary" onClick={() => setMembers(group)}>
                  Miembros
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <GroupModal
          group={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      )}
      {members && (
        <MembersModal
          group={members}
          onClose={() => setMembers(null)}
          onSave={async (list) => {
            try {
              await serviceDeskSettingsService.replaceMembers(members.id, list);
              showSuccessToast("Miembros actualizados");
              setMembers(null);
              await onChanged();
            } catch (error) {
              handleError(error, navigate);
            }
          }}
        />
      )}
    </div>
  );
}

function GroupModal({ group, onClose, onSaved }: { group: SupportGroup | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const navigate = useNavigate();
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [email, setEmail] = useState(group?.email ?? "");
  const [isActive, setIsActive] = useState(group?.isActive ?? true);
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const body = { name: name.trim(), description: description.trim() || null, email: email.trim() || null, isActive };
      if (group) await serviceDeskSettingsService.updateGroup(group.id, body);
      else await serviceDeskSettingsService.createGroup(body);
      showSuccessToast("Grupo guardado");
      await onSaved();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={group ? `Editar ${group.name}` : "Nuevo grupo"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="button" loading={saving} disabled={!name.trim()} onClick={() => void save()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Nombre *" htmlFor="group-name">
          <Input id="group-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Descripción" htmlFor="group-description">
          <Input id="group-description" maxLength={255} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Correo del grupo" htmlFor="group-email">
          <Input id="group-email" type="email" maxLength={160} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Activo
        </label>
      </div>
    </Modal>
  );
}

function MembersModal({
  group,
  onClose,
  onSave,
}: {
  group: SupportGroup;
  onClose: () => void;
  onSave: (members: { userId: number; isLead: boolean }[]) => Promise<void>;
}) {
  const [list, setList] = useState(group.members.map((member) => ({ ...member })));
  const [saving, setSaving] = useState(false);

  return (
    <Modal
      open
      title={`Miembros de ${group.name}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button
            type="button"
            loading={saving}
            onClick={() => {
              setSaving(true);
              void onSave(list.map(({ userId, isLead }) => ({ userId, isLead }))).finally(() => setSaving(false));
            }}
          >
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <UserSearch
          search={serviceDeskSettingsService.searchUsers}
          onPick={(user) =>
            setList((prev) => (prev.some((member) => member.userId === user.userId) ? prev : [...prev, { userId: user.userId, fullName: user.fullName, isLead: false }]))
          }
        />
        <p className="text-xs text-slate-500">
          Ser miembro no da permisos: el rol de cada agente debe tener los permisos del Service Desk (lo asigna el administrador).
        </p>
        <ul className="divide-y divide-slate-100 text-sm">
          {list.map((member) => (
            <li key={member.userId} className="flex items-center justify-between gap-2 py-2">
              <span>{member.fullName}</span>
              <span className="flex items-center gap-3">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={member.isLead}
                    onChange={(e) => setList((prev) => prev.map((item) => (item.userId === member.userId ? { ...item, isLead: e.target.checked } : item)))}
                  />
                  Líder
                </label>
                <button type="button" className="text-xs text-slate-500 hover:text-red-600" onClick={() => setList((prev) => prev.filter((item) => item.userId !== member.userId))}>
                  Quitar
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------
const APPLIES_TO_LABELS: Record<string, string> = {
  INCIDENT: "Incidentes",
  SERVICE_REQUEST: "Solicitudes",
  PROBLEM: "Problemas",
  CHANGE: "Cambios",
};

function CategoriesSettings({ categories, groups, onChanged }: { categories: ServiceCategory[]; groups: SupportGroup[]; onChanged: () => Promise<void> }) {
  const canEdit = useCanEdit();
  const [editing, setEditing] = useState<ServiceCategory | "new" | null>(null);
  const nameOf = (id: number | null) => categories.find((category) => category.id === id)?.name ?? "";
  const groupOf = (id: number | null) => groups.find((group) => group.id === id)?.name ?? "-";

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex justify-end">
          <Button type="button" onClick={() => setEditing("new")}>
            Nueva categoría
          </Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className={TH}>Categoría</th>
              <th className={TH}>Grupo por defecto</th>
              <th className={TH}>Aplica a</th>
              <th className={TH}>Estado</th>
              {canEdit && <th className={TH}><span className="sr-only">Acciones</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {categories.map((category) => (
              <tr key={category.id}>
                <td className={TD}>{category.parentId ? `${nameOf(category.parentId)} › ${category.name}` : category.name}</td>
                <td className={TD}>{groupOf(category.defaultGroupId)}</td>
                <td className={TD}>{category.appliesTo.map((value) => APPLIES_TO_LABELS[value] ?? value).join(", ")}</td>
                <td className={TD}>{category.isActive ? "Activa" : "Inactiva"}</td>
                {canEdit && (
                  <td className={TD}>
                    <Button type="button" variant="ghost" onClick={() => setEditing(category)}>
                      Editar
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <CategoryModal
          category={editing === "new" ? null : editing}
          categories={categories}
          groups={groups}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function CategoryModal({
  category,
  categories,
  groups,
  onClose,
  onSaved,
}: {
  category: ServiceCategory | null;
  categories: ServiceCategory[];
  groups: SupportGroup[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(category?.name ?? "");
  const [parentId, setParentId] = useState<number | "">(category?.parentId ?? "");
  const [groupId, setGroupId] = useState<number | "">(category?.defaultGroupId ?? "");
  const [appliesTo, setAppliesTo] = useState<string[]>(category?.appliesTo ?? ["INCIDENT", "SERVICE_REQUEST"]);
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const parents = categories.filter((candidate) => candidate.parentId === null && candidate.id !== category?.id);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const body = { name: name.trim(), parentId: parentId === "" ? null : parentId, defaultGroupId: groupId === "" ? null : groupId, appliesTo, isActive };
      if (category) await serviceDeskSettingsService.updateCategory(category.id, body);
      else await serviceDeskSettingsService.createCategory(body);
      showSuccessToast("Categoría guardada");
      await onSaved();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title={category ? `Editar ${category.name}` : "Nueva categoría"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="button" loading={saving} disabled={!name.trim() || appliesTo.length === 0} onClick={() => void save()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Nombre *" htmlFor="category-name">
          <Input id="category-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Categoría padre (para una subcategoría)" htmlFor="category-parent">
          <Select id="category-parent" value={parentId === "" ? "" : String(parentId)} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Ninguna (categoría principal)</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Grupo que atiende por defecto" htmlFor="category-group">
          <Select id="category-group" value={groupId === "" ? "" : String(groupId)} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Sin grupo</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">Aplica a</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {Object.entries(APPLIES_TO_LABELS).map(([value, label]) => (
              <label key={value} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={appliesTo.includes(value)}
                  onChange={(e) => setAppliesTo((prev) => (e.target.checked ? [...prev, value] : prev.filter((item) => item !== value)))}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Activa
        </label>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Catalogo de servicios
// ---------------------------------------------------------------------------
const FIELD_TYPE_LABELS: Record<CatalogFieldType, string> = {
  text: "Texto corto",
  textarea: "Texto largo",
  number: "Número",
  date: "Fecha",
  select: "Lista de opciones",
  boolean: "Sí / No",
};

function CatalogSettings({ categories, groups }: { categories: ServiceCategory[]; groups: SupportGroup[] }) {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [editing, setEditing] = useState<CatalogItem | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await serviceDeskSettingsService.catalogItems());
    } catch (error) {
      handleError(error, navigate);
    }
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!items) return <Loading />;
  const groupOf = (id: number | null | undefined) => groups.find((group) => group.id === id)?.name ?? "-";

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex justify-end">
          <Button type="button" onClick={() => setEditing("new")}>
            Nuevo servicio
          </Button>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState title="Sin servicios en el catálogo" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Servicio</th>
                <th className={TH}>Atiende</th>
                <th className={TH}>Aprueba</th>
                <th className={TH}>Campos</th>
                <th className={TH}>Estado</th>
                {canEdit && <th className={TH}><span className="sr-only">Acciones</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className={TD}>
                    <span className="font-medium">{item.name}</span>
                    <div className="text-xs text-slate-500">{item.description ?? ""}</div>
                  </td>
                  <td className={TD}>{groupOf(item.defaultGroupId)}</td>
                  <td className={TD}>
                    {item.fulfillment === "PURCHASE_REQUEST"
                      ? "Aprobador de la compra"
                      : item.fulfillment === "ROOM_ACCESS"
                        ? `${groupOf(item.approvalGroupId)} (tras validar)`
                        : item.approvalGroupId
                        ? groupOf(item.approvalGroupId)
                        : "Sin aprobación"}
                  </td>
                  <td className={TD}>{item.fields.length}</td>
                  <td className={TD}>{item.isActive ? "Activo" : "Inactivo"}</td>
                  {canEdit && (
                    <td className={TD}>
                      <Button type="button" variant="ghost" onClick={() => setEditing(item)}>
                        Editar
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <CatalogItemModal
          item={editing === "new" ? null : editing}
          categories={categories}
          groups={groups}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function CatalogItemModal({
  item,
  categories,
  groups,
  onClose,
  onSaved,
}: {
  item: CatalogItem | null;
  categories: ServiceCategory[];
  groups: SupportGroup[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [categoryId, setCategoryId] = useState<number | "">(item?.categoryId ?? "");
  const [groupId, setGroupId] = useState<number | "">(item?.defaultGroupId ?? "");
  const [approvalGroupId, setApprovalGroupId] = useState<number | "">(item?.approvalGroupId ?? "");
  // Tipo de atencion: ninguno, solicitud de compra (plan 010) o acceso a sala (plan 016).
  const [fulfillment, setFulfillment] = useState<CatalogFulfillment | "">(item?.fulfillment ?? "");
  const createsPurchase = fulfillment === "PURCHASE_REQUEST";
  const [fields, setFields] = useState<CatalogField[]>(item?.fields ?? []);
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [saving, setSaving] = useState(false);

  function updateField(index: number, patch: Partial<CatalogField>): void {
    setFields((prev) => prev.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const body: CatalogItemPayload = {
        name: name.trim(),
        description: description.trim() || null,
        categoryId: categoryId === "" ? null : categoryId,
        defaultGroupId: groupId === "" ? null : groupId,
        // La solicitud de equipo la aprueba el aprobador de la compra, no un grupo.
        approvalGroupId: createsPurchase || approvalGroupId === "" ? null : approvalGroupId,
        fulfillment: fulfillment === "" ? null : fulfillment,
        fields: fields.map((field) => ({
          ...field,
          key: field.key.trim(),
          label: field.label.trim(),
          options: field.type === "select" ? (field.options ?? []).map((option) => option.trim()).filter(Boolean) : undefined,
        })),
        isActive,
      };
      if (item) await serviceDeskSettingsService.updateCatalogItem(item.id, body);
      else await serviceDeskSettingsService.createCatalogItem(body);
      showSuccessToast("Servicio guardado");
      await onSaved();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={item ? `Editar ${item.name}` : "Nuevo servicio"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="button" loading={saving} disabled={!name.trim()} onClick={() => void save()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Nombre *" htmlFor="item-name">
            <Input id="item-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Descripción (la ve el solicitante)" htmlFor="item-description">
            <Textarea id="item-description" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <Field label="Categoría" htmlFor="item-category">
          <Select id="item-category" value={categoryId === "" ? "" : String(categoryId)} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Sin categoría</option>
            {categories.filter((category) => category.appliesTo.includes("SERVICE_REQUEST")).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Grupo que atiende" htmlFor="item-group">
          <Select id="item-group" value={groupId === "" ? "" : String(groupId)} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">El de la categoría</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Grupo aprobador" htmlFor="item-approval">
          <Select
            id="item-approval"
            disabled={createsPurchase}
            value={createsPurchase || approvalGroupId === "" ? "" : String(approvalGroupId)}
            onChange={(e) => setApprovalGroupId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">{createsPurchase ? "Lo aprueba el aprobador de la compra" : "No requiere aprobación"}</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 self-end text-sm text-slate-700">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Activo
        </label>
        <div className="sm:col-span-2">
          <Field label="Tipo de atención" htmlFor="item-fulfillment">
            <Select id="item-fulfillment" value={fulfillment} onChange={(e) => setFulfillment(e.target.value as CatalogFulfillment | "")}>
              <option value="">Ninguno (solo el ticket)</option>
              <option value="PURCHASE_REQUEST">Solicitud de compra</option>
              <option value="ROOM_ACCESS">Acceso a sala de comunicaciones</option>
            </Select>
          </Field>
          <p className="mt-1 text-xs text-slate-500">
            {fulfillment === "PURCHASE_REQUEST"
              ? "El solicitante elige productos, centro de costo y aprobador; el ticket sigue a la compra hasta la recepción del equipo."
              : fulfillment === "ROOM_ACCESS"
                ? "El solicitante pide sala, beneficiario y período; el Service Desk lo valida y lo aprueba el grupo aprobador (obligatorio)."
                : "El ticket se atiende en la cola del grupo, con la aprobación previa si tiene grupo aprobador."}
          </p>
        </div>
        <div className="sm:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">Campos del formulario</p>
            <Button
              type="button"
              variant="secondary"
              disabled={fields.length >= 20}
              onClick={() => setFields((prev) => [...prev, { key: `campo_${prev.length + 1}`, label: "", type: "text", required: false }])}
            >
              Agregar campo
            </Button>
          </div>
          {fields.length === 0 && <p className="text-sm text-slate-500">Sin campos: el solicitante solo escribe asunto y descripción.</p>}
          <ul className="space-y-2">
            {fields.map((field, index) => (
              <li key={index} className="grid gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-5">
                <Input aria-label="Etiqueta" placeholder="Etiqueta" value={field.label} maxLength={80} onChange={(e) => updateField(index, { label: e.target.value })} className="sm:col-span-2" />
                <Input aria-label="Clave" placeholder="clave" value={field.key} maxLength={40} onChange={(e) => updateField(index, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} />
                <Select aria-label="Tipo" value={field.type} onChange={(e) => updateField(index, { type: e.target.value as CatalogFieldType })}>
                  {(Object.keys(FIELD_TYPE_LABELS) as CatalogFieldType[]).map((value) => (
                    <option key={value} value={value}>
                      {FIELD_TYPE_LABELS[value]}
                    </option>
                  ))}
                </Select>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" checked={field.required} onChange={(e) => updateField(index, { required: e.target.checked })} />
                    Obligatorio
                  </label>
                  <button type="button" className="text-xs text-slate-500 hover:text-red-600" onClick={() => setFields((prev) => prev.filter((_, i) => i !== index))}>
                    Quitar
                  </button>
                </div>
                {field.type === "select" && (
                  <Input
                    aria-label="Opciones"
                    className="sm:col-span-5"
                    placeholder="Opciones separadas por coma"
                    value={(field.options ?? []).join(", ")}
                    onChange={(e) => updateField(index, { options: e.target.value.split(",") })}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Calendario habil
// ---------------------------------------------------------------------------
function CalendarSettings() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [calendar, setCalendar] = useState<BusinessCalendar | null>(null);
  const [hours, setHours] = useState<BusinessCalendar["hours"]>([]);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const calendars = await serviceDeskSettingsService.calendars();
      const current = calendars.find((item) => item.isDefault) ?? calendars[0] ?? null;
      setMissing(!current);
      setCalendar(current);
      if (current) {
        setHours(current.hours);
        setName(current.name);
        setTimezone(current.timezone);
      }
    } catch (error) {
      handleError(error, navigate);
    }
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) return <Alert tone="warning">No hay calendario configurado.</Alert>;
  if (!calendar) return <Loading />;

  async function saveHours(): Promise<void> {
    if (!calendar) return;
    setSaving(true);
    try {
      setCalendar(await serviceDeskSettingsService.updateCalendar(calendar.id, { name: name.trim(), timezone: timezone.trim(), hours }));
      showSuccessToast("Calendario guardado. Los nuevos vencimientos usan este horario.");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  async function addHoliday(): Promise<void> {
    if (!calendar) return;
    try {
      const updated = await serviceDeskSettingsService.addHoliday(calendar.id, holidayDate, holidayName.trim());
      setCalendar(updated);
      setHolidayDate("");
      setHolidayName("");
      showSuccessToast("Feriado guardado");
    } catch (error) {
      handleError(error, navigate);
    }
  }

  async function removeHoliday(date: string): Promise<void> {
    if (!calendar) return;
    try {
      await serviceDeskSettingsService.removeHoliday(calendar.id, date);
      await load();
      showSuccessToast("Feriado eliminado");
    } catch (error) {
      handleError(error, navigate);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Horario hábil">
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <Field label="Nombre" htmlFor="calendar-name">
            <Input id="calendar-name" disabled={!canEdit} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Zona horaria" htmlFor="calendar-tz">
            <Input id="calendar-tz" disabled={!canEdit} value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </Field>
        </div>
        <ul className="space-y-2">
          {hours.map((hour, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2 text-sm">
              <Select aria-label="Día" disabled={!canEdit} value={String(hour.weekday)} onChange={(e) => setHours((prev) => prev.map((item, i) => (i === index ? { ...item, weekday: Number(e.target.value) } : item)))}>
                {Object.entries(WEEKDAY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Input aria-label="Desde" type="time" disabled={!canEdit} value={hour.start} onChange={(e) => setHours((prev) => prev.map((item, i) => (i === index ? { ...item, start: e.target.value } : item)))} className="w-32" />
              <Input aria-label="Hasta" type="time" disabled={!canEdit} value={hour.end} onChange={(e) => setHours((prev) => prev.map((item, i) => (i === index ? { ...item, end: e.target.value } : item)))} className="w-32" />
              {canEdit && (
                <button type="button" className="text-xs text-slate-500 hover:text-red-600" onClick={() => setHours((prev) => prev.filter((_, i) => i !== index))}>
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setHours((prev) => [...prev, { weekday: 1, start: "09:00", end: "18:00" }])}>
              Agregar tramo
            </Button>
            <Button type="button" loading={saving} disabled={hours.length === 0} onClick={() => void saveHours()}>
              Guardar horario
            </Button>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">Para una pausa de colación, agregue dos tramos el mismo día (ej. 09:00–13:00 y 14:00–18:00).</p>
      </Section>
      <Section title={`Feriados (${calendar.holidays.length})`}>
        {canEdit && (
          <div className="mb-3 flex flex-wrap gap-2">
            <Input aria-label="Fecha" type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} className="w-40" />
            <Input aria-label="Nombre del feriado" placeholder="Nombre" value={holidayName} maxLength={120} onChange={(e) => setHolidayName(e.target.value)} className="flex-1" />
            <Button type="button" disabled={!holidayDate || !holidayName.trim()} onClick={() => void addHoliday()}>
              Agregar
            </Button>
          </div>
        )}
        <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto text-sm">
          {calendar.holidays.map((holiday) => (
            <li key={holiday.date} className="flex items-center justify-between gap-2 py-1">
              <span>
                {holiday.date} · {holiday.name}
              </span>
              {canEdit && (
                <button type="button" className="text-xs text-slate-500 hover:text-red-600" onClick={() => void removeHoliday(holiday.date)}>
                  Quitar
                </button>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Matriz de prioridad y SLA
// ---------------------------------------------------------------------------
function SlaSettings() {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [matrix, setMatrix] = useState<PriorityMatrixRow[] | null>(null);
  const [policies, setPolicies] = useState<SlaPolicy[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([serviceDeskSettingsService.matrix(), serviceDeskSettingsService.slaPolicies()])
      .then(([loadedMatrix, loadedPolicies]) => {
        setMatrix(loadedMatrix);
        setPolicies(loadedPolicies);
      })
      .catch((error) => handleError(error, navigate));
  }, [navigate]);

  if (!matrix || !policies) return <Loading />;

  const cell = (impact: number, urgency: number) => matrix.find((row) => row.impact === impact && row.urgency === urgency)?.priority ?? "P4";

  async function saveMatrix(): Promise<void> {
    setSaving("matrix");
    try {
      setMatrix(await serviceDeskSettingsService.replaceMatrix(matrix!));
      showSuccessToast("Matriz guardada");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(null);
    }
  }

  async function savePolicies(): Promise<void> {
    setSaving("sla");
    try {
      setPolicies(await serviceDeskSettingsService.saveSlaPolicies(policies!));
      showSuccessToast("SLA guardado. Aplica a los tickets nuevos y a los que cambien de prioridad.");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(null);
    }
  }

  function setPolicy(ticketType: TicketType, priority: Priority, patch: Partial<SlaPolicy>): void {
    setPolicies((prev) => {
      const list = prev ?? [];
      const exists = list.some((policy) => policy.ticketType === ticketType && policy.priority === priority);
      const base: SlaPolicy = { ticketType, priority, responseMinutes: 60, resolutionMinutes: 480, calendarId: null };
      return exists
        ? list.map((policy) => (policy.ticketType === ticketType && policy.priority === priority ? { ...policy, ...patch } : policy))
        : [...list, { ...base, ...patch }];
    });
  }

  const priorities: Priority[] = ["P1", "P2", "P3", "P4"];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Matriz de prioridad (impacto × urgencia)">
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              <th className={TH}>Impacto \ Urgencia</th>
              {[1, 2, 3].map((urgency) => (
                <th key={urgency} className={TH}>
                  {LEVEL_LABELS[urgency]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map((impact) => (
              <tr key={impact}>
                <th className={TH}>{LEVEL_LABELS[impact]}</th>
                {[1, 2, 3].map((urgency) => (
                  <td key={urgency} className={TD}>
                    {canEdit ? (
                      <Select
                        aria-label={`Impacto ${LEVEL_LABELS[impact]}, urgencia ${LEVEL_LABELS[urgency]}`}
                        value={cell(impact, urgency)}
                        onChange={(e) =>
                          setMatrix((prev) => prev!.map((row) => (row.impact === impact && row.urgency === urgency ? { ...row, priority: e.target.value as Priority } : row)))
                        }
                      >
                        {priorities.map((priority) => (
                          <option key={priority} value={priority}>
                            {priority}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge className={PRIORITY_CLASSES[cell(impact, urgency)]}>{cell(impact, urgency)}</Badge>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit && (
          <div className="mt-3 flex justify-end">
            <Button type="button" loading={saving === "matrix"} onClick={() => void saveMatrix()}>
              Guardar matriz
            </Button>
          </div>
        )}
      </Section>
      <Section title="Objetivos de SLA (minutos hábiles)">
        <table className="min-w-full text-sm">
          <thead>
            <tr>
              <th className={TH}>Tipo</th>
              <th className={TH}>Prioridad</th>
              <th className={TH}>Respuesta</th>
              <th className={TH}>Resolución</th>
            </tr>
          </thead>
          <tbody>
            {(["INCIDENT", "SERVICE_REQUEST"] as TicketType[]).flatMap((ticketType) =>
              priorities.map((priority) => {
                const policy = policies.find((item) => item.ticketType === ticketType && item.priority === priority);
                return (
                  <tr key={`${ticketType}-${priority}`}>
                    <td className={TD}>{TYPE_LABELS[ticketType]}</td>
                    <td className={TD}>{PRIORITY_LABELS[priority]}</td>
                    {(["responseMinutes", "resolutionMinutes"] as const).map((key) => (
                      <td key={key} className={TD}>
                        {canEdit ? (
                          <Input
                            aria-label={`${key === "responseMinutes" ? "Respuesta" : "Resolución"} ${TYPE_LABELS[ticketType]} ${priority}`}
                            type="number"
                            min={1}
                            className="w-24"
                            value={policy?.[key] ?? ""}
                            onChange={(e) => setPolicy(ticketType, priority, { [key]: Number(e.target.value) })}
                          />
                        ) : null}
                        <span className="text-xs text-slate-500">{policy ? formatMinutes(policy[key]) : "-"}</span>
                      </td>
                    ))}
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
        {canEdit && (
          <div className="mt-3 flex justify-end">
            <Button type="button" loading={saving === "sla"} onClick={() => void savePolicies()}>
              Guardar SLA
            </Button>
          </div>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plantillas de cambio estandar
// ---------------------------------------------------------------------------
function TemplateSettings({ categories }: { categories: ServiceCategory[] }) {
  const navigate = useNavigate();
  const canEdit = useCanEdit();
  const [templates, setTemplates] = useState<ChangeTemplate[] | null>(null);
  const [editing, setEditing] = useState<ChangeTemplate | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      setTemplates(await serviceDeskSettingsService.changeTemplates());
    } catch (error) {
      handleError(error, navigate);
    }
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!templates) return <Loading />;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Un cambio estándar es de bajo riesgo, repetitivo y preaprobado: se programa sin pasar por el CAB usando el plan de la plantilla.
      </p>
      {canEdit && (
        <div className="flex justify-end">
          <Button type="button" onClick={() => setEditing("new")}>
            Nueva plantilla
          </Button>
        </div>
      )}
      {templates.length === 0 ? (
        <EmptyState title="Sin plantillas" />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {templates.map((template) => (
            <li key={template.id} className={CARD}>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-slate-800">{template.name}</h3>
                {!template.isActive && <Badge className="bg-slate-100 text-slate-500">Inactiva</Badge>}
              </div>
              <p className="text-sm text-slate-600">{template.description ?? ""}</p>
              {canEdit && (
                <Button type="button" variant="ghost" className="mt-2" onClick={() => setEditing(template)}>
                  Editar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <TemplateModal
          template={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function TemplateModal({
  template,
  categories,
  onClose,
  onSaved,
}: {
  template: ChangeTemplate | null;
  categories: ServiceCategory[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [categoryId, setCategoryId] = useState<number | "">(template?.categoryId ?? "");
  const [implementationPlan, setImplementationPlan] = useState(template?.implementationPlan ?? "");
  const [backoutPlan, setBackoutPlan] = useState(template?.backoutPlan ?? "");
  const [testPlan, setTestPlan] = useState(template?.testPlan ?? "");
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        categoryId: categoryId === "" ? null : categoryId,
        implementationPlan: implementationPlan.trim(),
        backoutPlan: backoutPlan.trim(),
        testPlan: testPlan.trim() || null,
        isActive,
      };
      if (template) await serviceChangeService.updateTemplate(template.id, body);
      else await serviceChangeService.createTemplate(body);
      showSuccessToast("Plantilla guardada");
      await onSaved();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={template ? `Editar ${template.name}` : "Nueva plantilla de cambio estándar"}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button type="button" loading={saving} disabled={!name.trim() || !implementationPlan.trim() || !backoutPlan.trim()} onClick={() => void save()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Nombre *" htmlFor="template-name">
          <Input id="template-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Descripción" htmlFor="template-description">
          <Input id="template-description" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Categoría" htmlFor="template-category">
          <Select id="template-category" value={categoryId === "" ? "" : String(categoryId)} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Sin categoría</option>
            {categories.filter((category) => category.appliesTo.includes("CHANGE")).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Plan de implementación *" htmlFor="template-plan">
          <Textarea id="template-plan" rows={4} maxLength={8000} value={implementationPlan} onChange={(e) => setImplementationPlan(e.target.value)} />
        </Field>
        <Field label="Plan de reversa *" htmlFor="template-backout">
          <Textarea id="template-backout" rows={3} maxLength={8000} value={backoutPlan} onChange={(e) => setBackoutPlan(e.target.value)} />
        </Field>
        <Field label="Plan de pruebas" htmlFor="template-test">
          <Textarea id="template-test" rows={2} maxLength={8000} value={testPlan} onChange={(e) => setTestPlan(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Activa
        </label>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Auditoria (solo lectura): quien cambio que en esta configuracion
// ---------------------------------------------------------------------------
const AUDIT_ENTITY_LABELS: Record<string, string> = {
  group: "Grupo",
  "group-members": "Miembros de grupo",
  category: "Categoría",
  "catalog-item": "Ítem de catálogo",
  calendar: "Calendario",
  holiday: "Feriado",
  "priority-matrix": "Matriz de prioridad",
  "sla-policies": "Políticas de SLA",
  "change-template": "Plantilla de cambio",
};

const AUDIT_ACTION_LABELS: Record<SettingsAuditAction, string> = {
  CREATE: "Creó",
  UPDATE: "Modificó",
  DELETE: "Eliminó",
  REPLACE: "Reemplazó",
};

function AuditSettings() {
  const navigate = useNavigate();
  const [entity, setEntity] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: SettingsAuditRecord[]; totalPages: number; totalItems: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    serviceDeskSettingsService
      .audit({ page, limit: 25, entity: entity || undefined })
      .then((result) => {
        if (!cancelled) {
          setData({ items: result.items, totalPages: result.pagination.totalPages, totalItems: result.pagination.totalItems });
        }
      })
      .catch((error: unknown) => handleError(error, navigate));
    return () => {
      cancelled = true;
    };
  }, [entity, page, navigate]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Registro de solo lectura de cada cambio en esta configuración: quién lo hizo, cuándo y con qué datos.
      </p>
      <Field label="Filtrar por" htmlFor="sd-audit-entity">
        <Select
          id="sd-audit-entity"
          value={entity}
          onChange={(event) => {
            setEntity(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Todo</option>
          {Object.entries(AUDIT_ENTITY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      {!data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <EmptyState title="Sin cambios registrados" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>Fecha</th>
                  <th className={TH}>Usuario</th>
                  <th className={TH}>Acción</th>
                  <th className={TH}>Qué</th>
                  <th className={TH}>Datos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((record) => (
                  <tr key={record.id}>
                    <td className={`${TD} whitespace-nowrap`}>{formatDateTime(record.createdAt)}</td>
                    <td className={TD}>{record.actorName ?? `Usuario ${record.actorUserId}`}</td>
                    <td className={TD}>{AUDIT_ACTION_LABELS[record.action] ?? record.action}</td>
                    <td className={TD}>
                      {AUDIT_ENTITY_LABELS[record.entity] ?? record.entity}
                      {record.entityId ? ` #${record.entityId}` : ""}
                    </td>
                    <td className={TD}>
                      <details>
                        <summary className="cursor-pointer text-brand-700">Ver</summary>
                        <pre className="mt-1 max-w-xl overflow-x-auto whitespace-pre-wrap break-all text-xs text-slate-600">
                          {JSON.stringify(record.payload.body ?? record.payload, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} totalPages={data.totalPages} totalItems={data.totalItems} noun="cambios" onChange={setPage} />
        </>
      )}
    </div>
  );
}
