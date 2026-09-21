import { apiFetch, apiFetchBlob } from "../lib/apiClient";
import { toQuery } from "../lib/query";
import type { ListParams, Paginated } from "../types/api";
import type { AssetLabelConfig } from "../types/asset";
import type {
  InventoryCount,
  InventoryCountClosed,
  InventoryCountDetail,
  InventoryCountReport,
  InventoryCountStarted,
  InventoryHolder,
  InventoryLineInput,
  InventoryLineRecord,
  InventoryLineUpdateInput,
  InventoryReportLine,
  InventoryLookup,
  InventoryLookupBy,
} from "../types/inventoryCount";

export const inventoryCountService = {
  // "Inicio de Inventario": si el auditor ya tiene una toma abierta el backend
  // la devuelve (resumed) en vez de fallar.
  start: (body: { name?: string; notes?: string } = {}) =>
    apiFetch<InventoryCountStarted>("/inventory-counts/start", { method: "POST", body }),
  list: (params?: ListParams) => apiFetch<Paginated<InventoryCount>>(`/inventory-counts${toQuery(params)}`),
  getById: (id: number) => apiFetch<InventoryCountDetail>(`/inventory-counts/${id}`),

  // Valida un colaborador por RUT EXACTO (usuario activo), detras del permiso de esta pantalla: el auditor
  // no necesita asset-movements:create. POST para que el RUT no viaje en la URL (logs de NGINX). null = no existe.
  findHolder: (documentId: string) =>
    apiFetch<InventoryHolder | null>("/inventory-counts/holders/lookup", { method: "POST", body: { documentId } }),

  // null = el equipo no existe en el sistema (se generara una etiqueta nueva).
  lookup: (id: number, by: InventoryLookupBy, value: string) =>
    apiFetch<InventoryLookup | null>(`/inventory-counts/${id}/lookup${toQuery({ by, value })}`),

  listLines: (id: number, params?: ListParams) =>
    apiFetch<Paginated<InventoryReportLine>>(`/inventory-counts/${id}/lines${toQuery(params)}`),
  addLine: (id: number, body: InventoryLineInput) =>
    apiFetch<InventoryLineRecord>(`/inventory-counts/${id}/lines`, { method: "POST", body }),
  updateLine: (id: number, lineId: number, body: InventoryLineUpdateInput) =>
    apiFetch<InventoryLineRecord>(`/inventory-counts/${id}/lines/${lineId}`, { method: "PUT", body }),
  deleteLine: (id: number, lineId: number) =>
    apiFetch<null>(`/inventory-counts/${id}/lines/${lineId}`, { method: "DELETE" }),

  // "Fin Inventario": devuelve los ids de los activos creados por la toma.
  close: (id: number) => apiFetch<InventoryCountClosed>(`/inventory-counts/${id}/close`, { method: "POST" }),

  report: (id: number) => apiFetch<InventoryCountReport>(`/inventory-counts/${id}/report`),
  // PDF directo, no el sobre {codigo,message,data} -mismo criterio que downloadHandover.
  downloadReportPdf: (id: number) => apiFetchBlob(`/inventory-counts/${id}/report.pdf`),

  // ZPL (etiquetas.txt) de SOLO los activos creados por la toma; la impresion
  // real la hace el navegador (WebUSB) con este mismo texto.
  downloadLabels: async (id: number, config?: Partial<AssetLabelConfig>): Promise<string> => {
    const blob = await apiFetchBlob(`/inventory-counts/${id}/labels.zpl${toQuery(config)}`);
    return blob.text();
  },
};
