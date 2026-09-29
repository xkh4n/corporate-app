import { UserModel } from "../models/mssql/user.model";
import { createPerson } from "../services/mssql/person.service";
import { createUser } from "../services/mssql/user.service";
import { getRoleByName } from "../services/postgres/role.service";
import { getPermissionIdsCoveredByBundles } from "../services/postgres/permission.service";
import { seedCountries } from "../services/mssql/country.service";
import { seedCities } from "../services/mssql/city.service";
import { seedStates } from "../services/mssql/state.service";
import { seedCostCenters } from "../services/postgres/costCenter.service";
import {
  seedApvInstitutions,
  seedPrevisionalInstitutions,
  seedPrevisionalRates,
} from "../services/mssql/previsionalInstitution.service";
import { PermissionModel } from "../models/postgres/permission.model";
import { RolePermissionModel } from "../models/postgres/rolePermission.model";
import { MenuItemModel } from "../models/postgres/menuItem.model";
import { PermissionIncludeModel } from "../models/postgres/permissionInclude.model";
import { postgres } from "./postgres/connection";
import { PERMISSION_CATALOG, SCREEN_ACCESS_CATALOG } from "./permission-catalog";
import { MENU_CATALOG, RETIRED_MENU_LABELS } from "./menu-catalog";
import { readSecretFromEnv } from "../library/secrets";
import { env } from "../library/env";
import { logger } from "../library/logger";

// Datos de referencia (initial-data/{countries,cities,states}.json, ver
// memoria project-erp-scope-and-data-classification): orden secuencial
// obligatorio -cities necesita countries ya insertados para resolver su FK,
// states necesita cities-. Cada seedX es idempotente (no hace nada si la
// tabla ya tiene filas), asi que es seguro llamarlo en cada arranque.
export async function seedGeography(): Promise<void> {
  await seedCountries();
  await seedCities();
  await seedStates();
}

// Catalogos de la nomina Previred. seedPrevisionalRates resuelve cada tasa
// contra previsional_institutions, asi que va DESPUES de las instituciones;
// seedApvInstitutions no depende de nada.
export async function seedPrevisional(): Promise<void> {
  await seedPrevisionalInstitutions();
  await seedPrevisionalRates();
  await seedApvInstitutions();
}

// Siembra el catalogo de permisos (databases/permission-catalog.ts) y las
// asignaciones por defecto: "admin" recibe el catalogo completo (aunque ya
// tiene bypass total en el middleware, ver authorize.ts -esto es solo para
// que GET /roles/:id/permissions muestre algo consistente) y "user" recibe
// el subset marcado grantToUser, preservando el acceso que ya tenia antes de
// este cambio (el flujo operativo de compras/activos estaba abierto a
// cualquier autenticado). Un rol nuevo (ej. "adquisiciones") nace sin
// permisos: hay que asignarselos via PUT /roles/:id/permissions.
// updateOnDuplicate (en vez de ignoreDuplicates) hace el INSERT idempotente
// a nivel de motor (ON CONFLICT (resource,action) DO UPDATE SET description
// en Postgres) y de paso mantiene sincronizada la descripcion si se edita en
// el catalogo -"resource"+"action" identifican el permiso, "description" es
// metadata que puede cambiar sin que eso implique un permiso distinto.
// Seguro de correr en cada arranque y con las 3 replicas en paralelo sin el
// guard manual que usan seedCountries/seedCities/etc.
export async function seedPermissions(): Promise<void> {
  await PermissionModel.bulkCreate(PERMISSION_CATALOG, {
    updateOnDuplicate: ["description"],
    conflictAttributes: ["resource", "action"],
  });
  // Permisos de pantalla (agrupadores, plan 006). Antes del findAll de abajo
  // para que "admin" los reciba igual que el resto del catalogo.
  await PermissionModel.bulkCreate(
    SCREEN_ACCESS_CATALOG.map((entry) => ({
      resource: entry.resource,
      action: "access" as const,
      description: entry.description,
    })),
    { updateOnDuplicate: ["description"], conflictAttributes: ["resource", "action"] },
  );

  const allPermissions = await PermissionModel.findAll();
  const [adminRole, userRole] = await Promise.all([getRoleByName("admin"), getRoleByName("user")]);

  if (adminRole) {
    await RolePermissionModel.bulkCreate(
      allPermissions.map((permission) => ({ roleId: adminRole.id, permissionId: permission.id })),
      { ignoreDuplicates: true },
    );
  }

  if (userRole) {
    const userGrantableKeys = new Set(
      PERMISSION_CATALOG.filter((entry) => entry.grantToUser).map(
        (entry) => `${entry.resource}:${entry.action}`,
      ),
    );
    // Lo que "user" ya obtiene via un agrupador asignado no se vuelve a
    // asignar directo: la asignacion directa duplicada hace que quitar el
    // permiso en "Modificar Permisos" no revoque nada (ver
    // assertRevocationIsEffective en permission.service.ts), y sin este
    // filtro reaparecia en cada arranque despues de que la limpieza de
    // seedScreenAccessIncludes la borrara.
    const coveredForUser = await getPermissionIdsCoveredByBundles(userRole.id);
    const userPermissions = allPermissions.filter(
      (permission) =>
        userGrantableKeys.has(`${permission.resource}:${permission.action}`) && !coveredForUser.has(permission.id),
    );
    await RolePermissionModel.bulkCreate(
      userPermissions.map((permission) => ({ roleId: userRole.id, permissionId: permission.id })),
      { ignoreDuplicates: true },
    );

    // Revocacion explicita, no solo "dejar de otorgar": este seed es
    // aditivo (ignoreDuplicates arriba), asi que sacar grantToUser del
    // catalogo NO alcanza para instalaciones que ya sembraron la fila
    // RolePermission en un arranque anterior. purchase-requests:read salio
    // de userGrantableKeys por el hallazgo de auditoria de PII
    // cross-departamental (ver permission-catalog.ts) -sin este DELETE la
    // vulnerabilidad seguia viva en cualquier ambiente ya desplegado antes
    // de este fix. Idempotente: no-op si la fila ya no existe.
    const revokedFromUser = allPermissions.filter(
      (permission) => `${permission.resource}:${permission.action}` === "purchase-requests:read",
    );
    if (revokedFromUser.length > 0) {
      await RolePermissionModel.destroy({
        where: { roleId: userRole.id, permissionId: revokedFromUser.map((permission) => permission.id) },
      });
    }
  }

  // Al final: necesita las asignaciones de "user" ya sembradas arriba para
  // otorgarle los agrupadores cuyas pantallas ya cubria.
  await seedScreenAccessIncludes(allPermissions, adminRole?.id ?? null);
}

// Siembra los includes de cada agrupador de SCREEN_ACCESS_CATALOG. Son el
// minimo de la pantalla y se reconcilian en CADA arranque, solo agregando:
// un agrupador creado antes desde "Nueva Pantalla", o sembrado con una
// version anterior del catalogo, recibe los que le falten, y lo que el admin
// le haya agregado desde "Permisos de Pantalla" se conserva.
// La PRIMERA vez (agrupador sin includes) ademas le otorga el agrupador a cada rol no-admin que ya
// tenga TODOS sus permisos base asignados directamente: el menu pasa a
// gatearse con "<slug>:access" (menu-catalog.ts), y sin esto los roles
// existentes perderian sus pantallas. Un rol que tenia el permiso del menu
// pero no el resto (la vista le daba 403 igual) no lo recibe.
// Con las 3 replicas en paralelo, dos pueden ver "sin includes" a la vez:
// ignoreDuplicates hace que la segunda sea un no-op.
async function seedScreenAccessIncludes(allPermissions: PermissionModel[], adminRoleId: number | null): Promise<void> {
  const idByKey = new Map(allPermissions.map((permission) => [`${permission.resource}:${permission.action}`, permission.id]));

  const bundles = SCREEN_ACCESS_CATALOG.map((entry) => {
    const accessId = idByKey.get(`${entry.resource}:access`);
    if (accessId === undefined) {
      throw new Error(`SCREEN_ACCESS_CATALOG: "${entry.resource}:access" no quedo sembrado en permissions.`);
    }
    const includedIds = entry.includes.map((key) => {
      const id = idByKey.get(key);
      if (id === undefined || key.endsWith(":access")) {
        throw new Error(
          `SCREEN_ACCESS_CATALOG: "${entry.resource}" incluye "${key}", que no existe en el catalogo base ` +
            "o es otro permiso de pantalla (ver permission-catalog.ts).",
        );
      }
      return id;
    });
    const revokedIds = (entry.revokedIncludes ?? []).map((key) => {
      const id = idByKey.get(key);
      if (id === undefined || entry.includes.includes(key)) {
        throw new Error(`SCREEN_ACCESS_CATALOG: "${entry.resource}" revoca "${key}", que no existe o tambien esta en includes.`);
      }
      return id;
    });
    return { accessId, includedIds: [...new Set(includedIds)], revokedIds };
  });

  // Correcciones de seguridad del minimo: se quitan siempre (idempotente).
  for (const bundle of bundles) {
    const { revokedIds } = bundle;
    if (revokedIds.length === 0) continue;
    const removed = await PermissionIncludeModel.destroy({ where: { permissionId: bundle.accessId, includedPermissionId: revokedIds } });
    if (removed > 0) logger.info({ removed, permissionId: bundle.accessId }, "Permisos de pantalla: includes revocados por el catalogo");
  }

  const seeded = await PermissionIncludeModel.findAll({
    where: { permissionId: bundles.map((bundle) => bundle.accessId) },
    attributes: ["permissionId", "includedPermissionId"],
  });
  const alreadySeeded = new Set(seeded.map((link) => link.permissionId));
  const existingLinks = new Set(seeded.map((link) => `${link.permissionId}:${link.includedPermissionId}`));

  const missing = bundles
    .filter((bundle) => alreadySeeded.has(bundle.accessId))
    .flatMap((bundle) =>
      bundle.includedIds
        .filter((id) => !existingLinks.has(`${bundle.accessId}:${id}`))
        .map((includedPermissionId) => ({ permissionId: bundle.accessId, includedPermissionId })),
    );
  if (missing.length > 0) {
    await PermissionIncludeModel.bulkCreate(missing, { ignoreDuplicates: true });
    logger.info({ includes: missing.length }, "Permisos de pantalla: includes minimos del catalogo agregados");
  }

  const pending = bundles.filter((bundle) => !alreadySeeded.has(bundle.accessId));
  if (pending.length === 0) return;

  // Una transaccion: si el proceso muere entre los includes y los
  // otorgamientos, el proximo arranque vuelve a ver "sin includes" y repite
  // ambos -sin ella los roles existentes quedarian sin sus agrupadores.
  const grants = await postgres.transaction(async (transaction) => {
    await PermissionIncludeModel.bulkCreate(
      pending.flatMap((bundle) =>
        bundle.includedIds.map((includedPermissionId) => ({ permissionId: bundle.accessId, includedPermissionId })),
      ),
      { ignoreDuplicates: true, transaction },
    );

    const assignments = await RolePermissionModel.findAll({ attributes: ["roleId", "permissionId"], transaction });
    const directByRole = new Map<number, Set<number>>();
    for (const { roleId, permissionId } of assignments) {
      if (roleId === adminRoleId) continue;
      if (!directByRole.has(roleId)) directByRole.set(roleId, new Set());
      directByRole.get(roleId)!.add(permissionId);
    }

    const rows = [...directByRole.entries()].flatMap(([roleId, direct]) =>
      pending
        .filter((bundle) => bundle.includedIds.every((id) => direct.has(id)))
        .map((bundle) => ({ roleId, permissionId: bundle.accessId })),
    );
    if (rows.length > 0) {
      await RolePermissionModel.bulkCreate(rows, { ignoreDuplicates: true, transaction });

      // Una sola fuente de acceso por permiso (hallazgo de la revision de
      // seguridad 2026-09-23): se borran las asignaciones directas que el
      // agrupador recien otorgado ya cubre. Si quedaran, quitar ese permiso
      // en "Modificar Permisos" no revocaria nada, porque el agrupador lo
      // sigue concediendo. El acceso efectivo del rol no cambia.
      const coveredByRole = new Map<number, Set<number>>();
      const includedByBundle = new Map(pending.map((bundle) => [bundle.accessId, bundle.includedIds]));
      for (const { roleId, permissionId } of rows) {
        if (!coveredByRole.has(roleId)) coveredByRole.set(roleId, new Set());
        for (const id of includedByBundle.get(permissionId) ?? []) coveredByRole.get(roleId)!.add(id);
      }
      for (const [roleId, covered] of coveredByRole) {
        await RolePermissionModel.destroy({ where: { roleId, permissionId: [...covered] }, transaction });
      }
    }
    return rows;
  });
  logger.info(
    { screens: pending.length, grants: grants.length },
    "Permisos de pantalla: includes sembrados y agrupadores otorgados a roles existentes",
  );
}

// Siembra el arbol de navegacion (databases/menu-catalog.ts) contra
// menu_items -analogo a seedPermissions, pero secuencial en vez de
// bulkCreate: cada fila necesita el id REAL del padre ya insertado
// (self-referencia por label, no por un id fijo de antemano), asi que se
// procesa el catalogo en orden y se va guardando label->id a medida que se
// resuelve. Debe correr DESPUES de que termine seedPermissions (ver
// index.ts): cada entrada con permissionKey necesita resolverlo contra la
// tabla permissions ya sembrada. upsert() por label (UNIQUE agregado en
// postgres/migrate.ts) lo hace idempotente/seguro de correr en cada
// arranque, y sincroniza icon/link/parent/permiso/orden si el catalogo
// cambia -pero OJO: un edit manual hecho por fuera (via POST/PUT
// /menu-items) a una fila cuyo label esta en este catalogo se pisa en el
// proximo restart. isActive queda afuera del upsert a proposito: si alguien
// desactivo un item a mano, el seed no lo resucita solo.
export async function seedMenuItems(): Promise<void> {
  const permissions = await PermissionModel.findAll();
  const permissionIdByKey = new Map(permissions.map((p) => [`${p.resource}:${p.action}`, p.id]));

  const idByLabel = new Map<string, number>();

  for (const entry of MENU_CATALOG) {
    let parentId: number | null = null;
    if (entry.parentLabel) {
      const resolved = idByLabel.get(entry.parentLabel);
      if (resolved === undefined) {
        throw new Error(
          `MENU_CATALOG: "${entry.label}" referencia parentLabel "${entry.parentLabel}", que todavia no fue ` +
            "insertado -revisar el orden del catalogo (el padre debe aparecer antes que el hijo).",
        );
      }
      parentId = resolved;
    }

    let permissionId: number | null = null;
    if (entry.permissionKey) {
      const resolved = permissionIdByKey.get(entry.permissionKey);
      if (resolved === undefined) {
        throw new Error(
          `MENU_CATALOG: "${entry.label}" referencia el permiso "${entry.permissionKey}", que no existe en ` +
            "el catalogo de permissions (ver permission-catalog.ts).",
        );
      }
      permissionId = resolved;
    }

    const [menuItem] = await MenuItemModel.upsert(
      {
        label: entry.label,
        icon: entry.icon ?? null,
        link: entry.link ?? null,
        parentId,
        permissionId,
        sortOrder: entry.sortOrder,
      },
      { conflictFields: ["label"] },
    );
    idByLabel.set(entry.label, menuItem.id);
  }

  // Idempotente: no-op si el item nunca existio o ya estaba inactivo.
  if (RETIRED_MENU_LABELS.length > 0) {
    await MenuItemModel.update({ isActive: false }, { where: { label: RETIRED_MENU_LABELS, isActive: true } });
  }
}

// Bootstrap de "primer arranque": si la tabla users esta vacia (instalacion
// nueva), crea una persona + usuario admin para poder entrar por primera vez
// sin necesitar ya un admin para crear al admin. Password fijo desde secret
// (ADMIN_BOOTSTRAP_PASSWORD_FILE, generado por ensure-backend-secrets.ps1) -
// se espera que se rote/cambie despues del primer login.
export async function seedBootstrapAdmin(): Promise<void> {
  const existingUsers = await UserModel.count();
  if (existingUsers > 0) return;

  const adminRole = await getRoleByName("admin");
  if (!adminRole) {
    logger.warn("No existe el rol 'admin' todavia, se omite el seed del usuario de arranque");
    return;
  }

  const password = readSecretFromEnv(env.bootstrap.adminPasswordFileVar);

  const person = await createPerson({
    firstName: "Admin",
    lastName: "Sistema",
    documentId: "ADMIN-0001",
    email: "admin@corporate.local",
  });

  await createUser({
    personId: person.id,
    roleId: adminRole.id,
    username: "admin",
    password,
  });

  logger.warn("Usuario de arranque 'admin' creado. Cambiar su password despues del primer login.");
}
