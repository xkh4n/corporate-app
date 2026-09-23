import { Op } from "sequelize";
import { afterEach, describe, expect, it } from "vitest";
import { BadRequestError, ConflictError } from "../../library/errors";
import { PermissionModel, type PermissionAction } from "../../models/postgres/permission.model";
import { PermissionIncludeModel } from "../../models/postgres/permissionInclude.model";
import { RoleModel } from "../../models/postgres/role.model";
import { SCREEN_ACCESS_CATALOG } from "../../databases/permission-catalog";
import { seedPermissions } from "../../databases/seed";
import { createRole, deactivateRole } from "./role.service";
import {
  addPermissionInclude,
  addRolePermission,
  createPermission,
  getAssignedPermissionsForRole,
  getEffectivePermissionsForRole,
  getRoleIdsWithPermission,
  hasPermission,
  removePermissionInclude,
  removeRolePermission,
  setRolePermissions,
} from "./permission.service";

// Todo lo que crea este archivo lleva el prefijo "test-perm-": el catalogo
// sembrado (permissions/role_permissions del arranque) se comparte con el
// resto de la suite, asi que no se trunca -se borra solo lo propio.
const PREFIX = "test-perm-";
let seq = 0;

afterEach(async () => {
  await RoleModel.destroy({ where: { name: { [Op.like]: `${PREFIX}%` } } });
  await PermissionModel.destroy({ where: { resource: { [Op.like]: `${PREFIX}%` } } });
});

function uniqueName(label: string): string {
  return `${PREFIX}${label}-${++seq}`;
}

async function basePermission(resource: string, action: "read" | "create" | "approve") {
  const permission = await PermissionModel.findOne({ where: { resource, action } });
  if (!permission) throw new Error(`Falta el permiso sembrado ${resource}:${action}`);
  return permission;
}

describe("permisos de pantalla (agrupadores access)", () => {
  it("un rol con solo el agrupador obtiene lo incluido y nada mas", async () => {
    const assetsRead = await basePermission("assets", "read");
    const productsRead = await basePermission("products", "read");
    const bundle = await createPermission({
      resource: uniqueName("screen"),
      action: "access",
      description: "Pantalla de prueba",
      includedPermissionIds: [assetsRead.id],
    });
    const role = await createRole({ name: uniqueName("role") });
    await addRolePermission(role.id, bundle.id);

    expect(await hasPermission(role.id, "assets", "read")).toBe(true);
    expect(await hasPermission(role.id, bundle.resource, "access")).toBe(true);
    expect(await hasPermission(role.id, "products", "read")).toBe(false);

    const assigned = await getAssignedPermissionsForRole(role.id);
    expect(assigned.map((permission) => permission.id)).toEqual([bundle.id]);

    const effective = (await getEffectivePermissionsForRole(role.id)).map((permission) => permission.id);
    expect(effective).toEqual(expect.arrayContaining([bundle.id, assetsRead.id]));
    expect(effective).not.toContain(productsRead.id);
  });

  it("agregar y quitar un include cambia el acceso al instante", async () => {
    const productsRead = await basePermission("products", "read");
    const bundle = await createPermission({ resource: uniqueName("screen"), action: "access", description: "Pantalla" });
    const role = await createRole({ name: uniqueName("role") });
    await addRolePermission(role.id, bundle.id);

    expect(await hasPermission(role.id, "products", "read")).toBe(false);
    await addPermissionInclude(bundle.id, productsRead.id);
    expect(await hasPermission(role.id, "products", "read")).toBe(true);
    await removePermissionInclude(bundle.id, productsRead.id);
    expect(await hasPermission(role.id, "products", "read")).toBe(false);
  });

  it("un rol desactivado no obtiene nada via agrupador", async () => {
    const assetsRead = await basePermission("assets", "read");
    const bundle = await createPermission({
      resource: uniqueName("screen"),
      action: "access",
      description: "Pantalla",
      includedPermissionIds: [assetsRead.id],
    });
    const role = await createRole({ name: uniqueName("role") });
    await addRolePermission(role.id, bundle.id);
    await deactivateRole(role.id);

    expect(await hasPermission(role.id, "assets", "read")).toBe(false);
  });

  it("getRoleIdsWithPermission incluye roles que lo tienen solo via agrupador (aprobadores)", async () => {
    const approve = await basePermission("purchase-requests", "approve");
    const bundle = await createPermission({
      resource: uniqueName("screen"),
      action: "access",
      description: "Pantalla",
      includedPermissionIds: [approve.id],
    });
    const viaBundle = await createRole({ name: uniqueName("role") });
    await addRolePermission(viaBundle.id, bundle.id);
    const inactive = await createRole({ name: uniqueName("role") });
    await addRolePermission(inactive.id, bundle.id);
    await deactivateRole(inactive.id);

    const roleIds = await getRoleIdsWithPermission("purchase-requests", "approve");
    expect(roleIds).toContain(viaBundle.id);
    expect(roleIds).not.toContain(inactive.id);
  });

  it("no deja quitar un permiso que el rol sigue teniendo via agrupador (revocacion efectiva)", async () => {
    const assetsRead = await basePermission("assets", "read");
    const bundle = await createPermission({
      resource: uniqueName("screen"),
      action: "access",
      description: "Pantalla que incluye assets:read",
      includedPermissionIds: [assetsRead.id],
    });
    const role = await createRole({ name: uniqueName("role") });
    await addRolePermission(role.id, bundle.id);
    await addRolePermission(role.id, assetsRead.id);

    await expect(removeRolePermission(role.id, assetsRead.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(setRolePermissions(role.id, [bundle.id])).rejects.toBeInstanceOf(ConflictError);
    // Nada se borro: el rol conserva ambas asignaciones.
    expect((await getAssignedPermissionsForRole(role.id)).map((p) => p.id).sort()).toEqual(
      [bundle.id, assetsRead.id].sort(),
    );

    // Quitando primero la pantalla, la revocacion del permiso base si aplica.
    await removeRolePermission(role.id, bundle.id);
    await removeRolePermission(role.id, assetsRead.id);
    expect(await hasPermission(role.id, "assets", "read")).toBe(false);

    // Reemplazar el set completo quitando ambos a la vez tambien vale.
    await addRolePermission(role.id, bundle.id);
    await addRolePermission(role.id, assetsRead.id);
    await setRolePermissions(role.id, []);
    expect(await hasPermission(role.id, "assets", "read")).toBe(false);
  });

  it("rechaza anidar agrupadores e includes en permisos que no son access", async () => {
    const assetsRead = await basePermission("assets", "read");
    const inner = await createPermission({ resource: uniqueName("screen"), action: "access", description: "Interna" });
    const outer = await createPermission({ resource: uniqueName("screen"), action: "access", description: "Externa" });

    await expect(addPermissionInclude(outer.id, inner.id)).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      createPermission({
        resource: uniqueName("screen"),
        action: "access",
        description: "Anidada",
        includedPermissionIds: [inner.id],
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      createPermission({
        resource: uniqueName("plain"),
        action: "read",
        description: "No es pantalla",
        includedPermissionIds: [assetsRead.id],
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(addPermissionInclude(assetsRead.id, inner.id)).rejects.toBeInstanceOf(BadRequestError);
  });

  it("la primera siembra de una pantalla la otorga y deja una sola fuente de acceso (sin duplicados directos)", async () => {
    // Fuerza el camino de "primera vez" sobre una pantalla real del catalogo:
    // sin includes, seedPermissions la vuelve a sembrar y a otorgar.
    const entry = SCREEN_ACCESS_CATALOG.find((screen) => screen.resource === "asset-labels")!;
    const bundle = await PermissionModel.findOne({ where: { resource: entry.resource, action: "access" } });
    const assetsRead = await basePermission("assets", "read");
    const role = await createRole({ name: uniqueName("role") });
    await addRolePermission(role.id, assetsRead.id);

    await PermissionIncludeModel.destroy({ where: { permissionId: bundle!.id } });
    await seedPermissions();

    const assigned = (await getAssignedPermissionsForRole(role.id)).map((permission) => permission.id);
    expect(assigned).toEqual([bundle!.id]);
    expect(await hasPermission(role.id, "assets", "read")).toBe(true);
    expect(await PermissionIncludeModel.count({ where: { permissionId: bundle!.id } })).toBe(entry.includes.length);
  });

  it("la siembra deja cada pantalla del catalogo con todos sus includes minimos", async () => {
    const keyById = new Map(
      (await PermissionModel.findAll()).map((permission) => [permission.id, `${permission.resource}:${permission.action}`]),
    );
    for (const entry of SCREEN_ACCESS_CATALOG) {
      const bundle = await PermissionModel.findOne({ where: { resource: entry.resource, action: "access" } });
      expect(bundle, entry.resource).not.toBeNull();
      const links = await PermissionIncludeModel.findAll({ where: { permissionId: bundle!.id } });
      const keys = links.map((link) => keyById.get(link.includedPermissionId));
      expect(keys, entry.resource).toEqual(expect.arrayContaining(entry.includes));
    }
  });

  it("la siembra completa un agrupador existente sin quitarle lo agregado desde la UI", async () => {
    const entry = SCREEN_ACCESS_CATALOG.find((screen) => screen.resource === "accounting-capitalization")!;
    const bundle = await PermissionModel.findOne({ where: { resource: entry.resource, action: "access" } });
    const productsRead = await basePermission("products", "read");
    const [firstKey] = entry.includes;
    const [firstResource, firstAction] = firstKey!.split(":");
    const first = await PermissionModel.findOne({
      where: { resource: firstResource!, action: firstAction as PermissionAction },
    });

    // Como en Development: el agrupador tiene includes elegidos en la UI y le
    // falta parte del minimo del catalogo.
    await PermissionIncludeModel.destroy({ where: { permissionId: bundle!.id, includedPermissionId: first!.id } });
    await addPermissionInclude(bundle!.id, productsRead.id);
    await seedPermissions();

    const includedIds = (await PermissionIncludeModel.findAll({ where: { permissionId: bundle!.id } })).map(
      (link) => link.includedPermissionId,
    );
    expect(includedIds).toEqual(expect.arrayContaining([first!.id, productsRead.id]));

    // Lo agregado desde la UI se puede quitar; el minimo del catalogo no.
    await removePermissionInclude(bundle!.id, productsRead.id);
    await expect(removePermissionInclude(bundle!.id, first!.id)).rejects.toBeInstanceOf(ConflictError);
  });
});
