import client from "prom-client";
import type { NextFunction, Request, Response } from "express";

// Un registro propio (no el default global de prom-client) para no arrastrar
// metricas de otros modulos que tambien puedan usar la libreria sin querer.
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duracion de requests HTTP en segundos",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [registry],
});

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total de requests HTTP procesadas",
  labelNames: ["method", "route", "status_code"],
  registers: [registry],
});

// req.route.path (no req.originalUrl) para no explotar la cardinalidad de
// labels con un valor distinto por cada :id -"/api/persons/:id" en vez de
// "/api/persons/42", "/api/persons/43", etc.
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
    const labels = { method: req.method, route, status_code: String(res.statusCode) };
    httpRequestDuration.observe(labels, durationSeconds);
    httpRequestsTotal.inc(labels);
  });

  next();
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.set("Content-Type", registry.contentType);
  res.end(await registry.metrics());
}
