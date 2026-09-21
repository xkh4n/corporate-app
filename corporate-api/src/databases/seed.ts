import { UserModel } from "../models/mssql/user.model";
import { createPerson } from "../services/mssql/person.service";
import { createUser } from "../services/mssql/user.service";
import { getRoleByName } from "../services/postgres/role.service";
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
import { PERMISSION_CATALOG } from "./permission-catalog";
import { MENU_CATALOG } from "./menu-catalog";
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
    const userPermissions = allPermissions.filter((permission) =>
      userGrantableKeys.has(`${permission.resource}:${permission.action}`),
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
