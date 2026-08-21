import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as employeeService from "../services/mssql/employee.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const createEmployeeSchema = z.object({
  personId: z.number().int().positive(),
  employeeCode: z.string().min(1).max(20),
  costCenterId: z.number().int().positive(),
  // ObjectId de Mongo (coleccion positions) -mismo criterio que categoryId
  // en product.controller.ts.
  positionId: z.string().length(24),
});

export const updateEmployeeSchema = createEmployeeSchema.omit({ personId: true }).partial();

export const findByDocumentIdSchema = z.object({ documentId: z.string().min(1) });
export const findByNameSchema = z.object({ name: z.string().min(1) });

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "employeeCode");
    const { items, total } = await employeeService.listEmployees(params);
    sendList(res, items, buildPaginationMeta(params, total), "Colaboradores obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

// POST (no GET: el body no viaja en un GET real, fetch/axios lo rechazan
// del lado del cliente) /employees/bydocumentId - match EXACTO contra la
// persona asociada.
export async function findByDocumentId(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { documentId } = req.body as z.infer<typeof findByDocumentIdSchema>;
    const params = parsePaginationParams(req.body, "employeeCode");
    const { items, total } = await employeeService.listEmployees(params, { documentId });
    sendList(res, items, buildPaginationMeta(params, total), "Colaboradores obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

// POST /employees/byname - LIKE contra firstName/lastName de la persona
// asociada.
export async function findByName(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name } = req.body as z.infer<typeof findByNameSchema>;
    const params = parsePaginationParams(req.body, "employeeCode");
    const { items, total } = await employeeService.listEmployees(params, { name });
    sendList(res, items, buildPaginationMeta(params, total), "Colaboradores obtenidos exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const employee = await employeeService.getEmployeeByIdOrThrow(Number(req.params.id));
    sendOk(res, employee, "Colaborador obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createEmployeeSchema>;
    const employee = await employeeService.createEmployee({ ...body, createdBy: req.user?.userId });
    sendOk(res, employee, "Colaborador creado exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateEmployeeSchema>;
    const employee = await employeeService.updateEmployee(Number(req.params.id), {
      ...body,
      updatedBy: req.user?.userId,
    });
    sendOk(res, employee, "Colaborador actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}
