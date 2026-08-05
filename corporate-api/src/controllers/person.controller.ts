import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as personService from "../services/mssql/person.service";

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

export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await personService.listPersons());
  } catch (err) {
    next(err);
  }
}

export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await personService.getPersonByIdOrThrow(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof createPersonSchema>;
    res.status(201).json(await personService.createPerson(body));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as z.infer<typeof updatePersonSchema>;
    res.json(await personService.updatePerson(Number(req.params.id), body));
  } catch (err) {
    next(err);
  }
}

export async function deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await personService.deactivatePerson(Number(req.params.id));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
