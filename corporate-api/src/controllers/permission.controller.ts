import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as permissionService from "../services/postgres/permission.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendNoContent, sendOk } from "../library/response";
import { permissionActor } from "../library/permissionActor";

// resource en kebab-case minuscula, mismo formato que el resto del catalogo
// (ej. "purchase-requests", "menu-items") -es la mitad de la clave
// "recurso:accion" que usan authorize(), /auth/me y menu_items, asi que no
// puede traer espacios ni ":". action: mismo enum que el CHECK
// permissions_action_allowed (postgres/migrate.ts).
export const createPermissionSchema = z.object({
  resource: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, "resource debe ser kebab-case en minusculas (ej. 'asset-returns')"),
  action: z.enum(["create", "read", "update", "delete", "approve", "activate", "access", "all_view"]),
  description: z.string().trim().min(3).max(255),
  // Solo para action "access" (permiso de pantalla): los permisos base que
  // incluye. El servicio rechaza (400) incluirlos en otra accion, incluir
  // otro "access" o ids inexistentes.
  includedPermissionIds: z.array(z.number().int().positive()).max(200).optional(),
});

export const addPermissionIncludeSchema = z.object({
  permissionId: z.number().int().positive(),
});

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "resource");
    const { items, total } = await permissionService.listPermissions(params);
    sendList(res, items, buildPaginationMeta(params, total), "Permisos obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createPermissionSchema>;
    await permissionService.assertActorCanGrant(permissionActor(req), body.includedPermissionIds ?? []);
    const permission = await permissionService.createPermission(body);
    sendOk(res, permission, "Permiso creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function getIncludes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const includes = await permissionService.getPermissionIncludes(Number(req.params.id));
    sendOk(res, includes, "Permisos incluidos obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function addInclude(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { permissionId } = req.body as z.infer<typeof addPermissionIncludeSchema>;
    const actor = permissionActor(req);
    await permissionService.assertActorCanEditBundle(actor, Number(req.params.id));
    await permissionService.assertActorCanGrant(actor, [permissionId]);
    const includes = await permissionService.addPermissionInclude(Number(req.params.id), permissionId);
    sendOk(res, includes, "Permiso incluido exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function removeInclude(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await permissionService.assertActorCanEditBundle(permissionActor(req), Number(req.params.id));
    await permissionService.removePermissionInclude(Number(req.params.id), Number(req.params.includedId));
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}
