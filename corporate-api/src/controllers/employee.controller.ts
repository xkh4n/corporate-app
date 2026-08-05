import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as employeeService from "../services/mssql/employee.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk } from "../library/response";

export const createEmployeeSchema = z.object({
  personId: z.number().int().positive(),
  employeeCode: z.string().min(1).max(20),
  costCenterId: z.number().int().positive(),
});

export const updateEmployeeSchema = createEmployeeSchema.omit({ personId: true }).partial();

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "employeeCode");
    const { items, total } = await employeeService.listEmployees(params);
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
    const employee = await employeeService.updateEmployee(Number(req.params.id), body);
    sendOk(res, employee, "Colaborador actualizado exitosamente");
  } catch (err) {
    next(err);
  }
}
