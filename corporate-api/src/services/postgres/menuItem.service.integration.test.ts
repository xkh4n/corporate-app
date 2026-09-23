import { Op } from "sequelize";
import { afterEach, describe, expect, it } from "vitest";
import { ConflictError } from "../../library/errors";
import { MenuItemModel } from "../../models/postgres/menuItem.model";
import { PermissionModel } from "../../models/postgres/permission.model";
import { createMenuItem, updateMenuItem } from "./menuItem.service";
import { createPermission } from "./permission.service";

// Prefijo propio: menu_items y permissions los comparte toda la suite (el
// seed los llena al arrancar), asi que se borra solo lo creado aca.
const PREFIX = "test-menu-";
let seq = 0;

afterEach(async () => {
  await MenuItemModel.destroy({ where: { label: { [Op.like]: `${PREFIX}%` } } });
  await PermissionModel.destroy({ where: { resource: { [Op.like]: `${PREFIX}%` } } });
});

function unique(label: string): string {
  return `${PREFIX}${label}-${++seq}`;
}

describe("menuItem.service (alta desde Nueva Pantalla)", () => {
  it("crea una pantalla bajo una carpeta con su permiso de pantalla", async () => {
    const folder = await createMenuItem({ label: unique("carpeta"), icon: "IoFolder", sortOrder: 10 });
    const screenPermission = await createPermission({
      resource: unique("screen"),
      action: "access",
      description: "Pantalla de prueba",
    });
    const screen = await createMenuItem({
      label: unique("pantalla"),
      icon: "IoList",
      link: `/test-menu/screen-${seq}`,
      parentId: folder.id,
      permissionKey: `${screenPermission.resource}:access`,
      sortOrder: 20,
    });

    expect(screen.parentId).toBe(folder.id);
    expect(screen.permissionId).toBe(screenPermission.id);
  });

  it("responde 409 si el nombre ya existe (en vez del 500 de la UNIQUE)", async () => {
    const label = unique("repetido");
    await createMenuItem({ label, sortOrder: 10 });
    await expect(createMenuItem({ label, sortOrder: 10 })).rejects.toBeInstanceOf(ConflictError);
  });

  it("responde 409 si la ruta ya la usa otro item activo, al crear y al editar", async () => {
    const link = `/test-menu/ruta-${++seq}`;
    await createMenuItem({ label: unique("con-ruta"), link, sortOrder: 10 });
    await expect(createMenuItem({ label: unique("misma-ruta"), link, sortOrder: 10 })).rejects.toBeInstanceOf(
      ConflictError,
    );

    const other = await createMenuItem({ label: unique("otra"), link: `/test-menu/otra-${++seq}`, sortOrder: 10 });
    await expect(updateMenuItem(other.id, { link })).rejects.toBeInstanceOf(ConflictError);
    // Editar sin cambiar la propia ruta no es un conflicto consigo mismo.
    await expect(updateMenuItem(other.id, { link: other.link!, sortOrder: 30 })).resolves.toBeTruthy();
  });
});
