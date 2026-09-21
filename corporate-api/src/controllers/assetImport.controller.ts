import type { NextFunction, Request, Response } from "express";
import * as assetImportJob from "../services/redis/assetImportJob.service";
import { isImportJobId } from "../models/redis/assetImport.model";
import type { ImportActor } from "../types/postgres/assetImport.types";
import { BadRequestError, UnauthorizedError } from "../library/errors";
import { sendOk } from "../library/response";

// Carga masiva de activos por CSV (plan 005). Flujo: POST / (valida y crea la carga) -> POST /:id/start ->
// GET /:id (estado) -> GET /:id/result (CSV con el resultado por fila). POST /:id/resume y /:id/cancel.

function parseJobId(value: unknown): string {
  if (typeof value !== "string" || !isImportJobId(value)) throw new BadRequestError("Id de carga invalido");
  return value;
}

// El rol sale de la sesion autenticada, nunca del cuerpo de la request.
function requireActor(req: Request): ImportActor {
  const userId = req.user?.userId;
  if (userId === undefined) throw new UnauthorizedError();
  return { userId, isAdmin: req.user?.roleName === "admin" };
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = requireActor(req);
    if (!req.file) throw new BadRequestError("Debe adjuntar un archivo CSV (campo 'file')");
    const csvText = new TextDecoder("utf-8").decode(req.file.buffer);
    const report = await assetImportJob.validateAndCreateImportJob(actor, req.file.originalname, csvText);
    const message =
      report.invalidRows === 0
        ? "Archivo validado: puede iniciar la carga"
        : `Archivo validado con ${report.invalidRows} fila(s) con errores`;
    sendOk(res, report, message, 201);
  } catch (err) {
    next(err);
  }
}

export async function start(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const skipInvalid = req.query.skipInvalid === "true";
    const meta = await assetImportJob.startImportJob(parseJobId(req.params.id), requireActor(req), skipInvalid);
    sendOk(res, meta, "Carga iniciada", 202);
  } catch (err) {
    next(err);
  }
}

export async function resume(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { meta, alreadyProcessing, queued } = await assetImportJob.resumeImportJob(parseJobId(req.params.id), requireActor(req));
    const message = alreadyProcessing
      ? "La carga ya se está procesando"
      : queued
        ? "El servidor está ocupado con otras cargas: la retomará en breve automáticamente"
        : "Carga reanudada";
    sendOk(res, meta, message, 202);
  } catch (err) {
    next(err);
  }
}

export async function cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const meta = await assetImportJob.cancelImportJob(parseJobId(req.params.id), requireActor(req));
    sendOk(res, meta, "Carga cancelada");
  } catch (err) {
    next(err);
  }
}

export async function getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = await assetImportJob.getImportJobStatus(parseJobId(req.params.id), requireActor(req));
    sendOk(res, status, "Estado de la carga obtenido exitosamente");
  } catch (err) {
    next(err);
  }
}

export async function downloadResult(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const jobId = parseJobId(req.params.id);
    const csv = await assetImportJob.buildImportJobResultCsv(jobId, requireActor(req));
    // El nombre del archivo lo arma el servidor (el id ya es un UUID validado). BOM para que Excel lea UTF-8.
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="resultado-carga-${jobId}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(`﻿${csv}`);
  } catch (err) {
    next(err);
  }
}
