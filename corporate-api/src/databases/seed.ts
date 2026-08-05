import { UserModel } from "../models/mssql/user.model";
import { createPerson } from "../services/mssql/person.service";
import { createUser } from "../services/mssql/user.service";
import { getRoleByName } from "../services/postgres/role.service";
import { seedCountries } from "../services/mssql/country.service";
import { seedCities } from "../services/mssql/city.service";
import { seedStates } from "../services/mssql/state.service";
import { seedCostCenters } from "../services/postgres/costCenter.service";
import { PermissionModel } from "../models/postgres/permission.model";
import { RolePermissionModel } from "../models/postgres/rolePermission.model";
import { PERMISSION_CATALOG } from "./permission-catalog";
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
