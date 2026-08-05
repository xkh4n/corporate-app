import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as personService from "../services/mssql/person.service";
import { parsePaginationParams, buildPaginationMeta } from "../library/pagination";
import { sendList, sendOk, sendNoContent } from "../library/response";

export const createPersonSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  documentId: z.string().min(1).max(20),
  email: z.string().email().max(150),
  phone: z.string().max(30).optional(),
  birthDate: z.string().date().optional(),
  isActive: z.boolean().optional(),
});

export const updatePersonSchema = createPersonSchema.partial();

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const params = parsePaginationParams({ ...req.query, ...req.body }, "id");
    const { items, total } = await personService.listPersons(params);
    sendList(res, items, buildPaginationMeta(params, total), "Personas obtenidas exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const person = await personService.getPersonByIdOrThrow(Number(req.params.id));
    sendOk(res, person, "Persona obtenida exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createPersonSchema>;
    const person = await personService.createPerson(body);
    sendOk(res, person, "Persona creada exitosamente", 201);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updatePersonSchema>;
    const person = await personService.updatePerson(Number(req.params.id), body);
    sendOk(res, person, "Persona actualizada exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await personService.deactivatePerson(Number(req.params.id));
    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}
