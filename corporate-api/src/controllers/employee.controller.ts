import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as employeeService from "../services/mssql/employee.service";

export const createEmployeeSchema = z.object({
  personId: z.number().int().positive(),
  employeeCode: z.string().min(1).max(20),
  costCenterId: z.number().int().positive(),
});

export const updateEmployeeSchema = createEmployeeSchema.omit({ personId: true }).partial();

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await employeeService.listEmployees());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await employeeService.getEmployeeByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createEmployeeSchema>;
    res.status(201).json(await employeeService.createEmployee({ ...body, createdBy: req.user?.userId }));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updateEmployeeSchema>;
    res.json(await employeeService.updateEmployee(Number(req.params.id), body));
  } catch (err) {
    next(err);
  }
}
