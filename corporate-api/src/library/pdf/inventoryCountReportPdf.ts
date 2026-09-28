import path from "node:path";
import PDFDocument from "pdfkit";
import type {
  InventoryCountSummary,
  InventoryChange,
  InventoryReportLine,
  InventoryReportMissingAsset,
  InventoryUserLabel,
} from "../../types/postgres/inventoryCount.types";

export interface InventoryCountReportPdfData {
  number: string;
  name: string;
  status: "OPEN" | "CLOSED";
  startedAt: Date;
  closedAt: Date | null;
  auditor: InventoryUserLabel | null;
  summary: InventoryCountSummary;
  lines: InventoryReportLine[];
  missingAssets: InventoryReportMissingAsset[];
}

// Mismo membrete/paleta que library/pdf/assetHandoverPdf.ts. Apaisado: las
// tablas de equipos no entran en vertical sin truncar el texto.
const LOGO_PATH = path.join(__dirname, "assets/imperial-logo.png");
const LOGO_ASPECT_RATIO = 235 / 1902;
const COMPANY_NAME = "IMPERIAL S. A.";
const COMPANY_DEPARTMENT = "Departamento de Tecnología";
const NAVY = "#003764";
const PAGE_MARGIN = 50;
const ROW_HEIGHT = 30;

const STATUS_LABELS: Record<string, string> = {
  RECEIVED: "Ingresado",
  ASSIGNED: "Asignado",
  AVAILABLE: "Disponible",
  SUPPORT: "Mantención",
  DAMAGED: "Dañado",
  DECOMMISSIONED: "Pendiente de baja contable",
  WRITTEN_OFF: "De baja",
  RETURNED: "Devolución",
  DEVALUATED: "Devaluado",
  MOVE_TO_RETURNED: "En tránsito a devolución",
};

const statusLabel = (code: string | null) => (code ? (STATUS_LABELS[code] ?? code) : "");
const formatDate = (date: Date | null) =>
  date ? date.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "";
const userText = (user: InventoryUserLabel | null) => (user ? `${user.fullName} (${user.documentId})` : "");
const costCenterText = (center: { code: number; name: string } | null) => (center ? `${center.code} ${center.name}` : "sin centro");

// Texto de lo que la toma CAMBIO en un activo existente ("antes -> despues").
function changeText(line: InventoryReportLine, change: InventoryChange): string {
  switch (change) {
    case "STATUS_CHANGED":
      return `Estado: ${statusLabel(line.systemStatusCode)} → ${statusLabel(line.statusCode)}`;
    case "HOLDER_CHANGED":
      return `Usuario: ${line.systemHolder?.fullName ?? "sin usuario"} → ${line.holder?.fullName ?? "sin usuario"}`;
    case "COST_CENTER_CHANGED":
      return `Centro de costo: ${costCenterText(line.systemCostCenter)} → ${costCenterText(line.costCenter)}`;
  }
}

function observationText(line: InventoryReportLine): string {
  if (line.assetCreated) return "Alta nueva (etiqueta generada)";
  const parts = line.changes.map((change) => changeText(line, change));
  if (line.supportFollowUp) parts.push("Enviar a Soporte TI / Adquisiciones TI");
  return parts.join("; ");
}

export function renderInventoryCountReportPdf(data: InventoryCountReportPdfData): PDFKit.PDFDocument {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "LETTER", layout: "landscape" });

  renderLetterhead(doc);
  renderInfoBox(doc, data);
  renderSummary(doc, data.summary);

  renderSectionTitle(doc, "Equipos levantados");
  const contentWidth = doc.page.width - PAGE_MARGIN * 2;
  drawTable(
    doc,
    [
      { header: "Tag", width: 0.12 },
      { header: "Producto", width: 0.16 },
      { header: "Serie", width: 0.11 },
      { header: "Estado", width: 0.1 },
      { header: "Usuario", width: 0.17 },
      { header: "Observación", width: 0.34 },
    ].map((column) => ({ ...column, width: column.width * contentWidth })),
    data.lines.map((line) => [
      line.tag,
      line.productName ?? "",
      line.serialNumber ?? "",
      statusLabel(line.statusCode),
      userText(line.holder),
      observationText(line),
    ]),
    "Sin equipos levantados",
  );

  if (data.status === "CLOSED") {
    renderSectionTitle(doc, "Activos del sistema no encontrados");
    drawTable(
      doc,
      [
        { header: "Tag", width: 0.14 },
        { header: "Producto", width: 0.28 },
        { header: "Serie", width: 0.16 },
        { header: "Estado en sistema", width: 0.14 },
        { header: "Usuario en sistema", width: 0.28 },
      ].map((column) => ({ ...column, width: column.width * contentWidth })),
      data.missingAssets.map((asset) => [
        asset.tag,
        asset.productName ?? "",
        asset.serialNumber ?? "",
        statusLabel(asset.systemStatusCode),
        userText(asset.systemHolder),
      ]),
      "Todos los activos del sistema fueron encontrados",
    );
  }

  doc.end();
  return doc;
}

function renderLetterhead(doc: PDFKit.PDFDocument): void {
  const logoWidth = 160;
  const logoHeight = logoWidth * LOGO_ASPECT_RATIO;
  doc.image(LOGO_PATH, (doc.page.width - logoWidth) / 2, doc.y, { width: logoWidth });
  doc.y += logoHeight + 12;

  doc.font("Helvetica-Bold").fontSize(13).fillColor(NAVY).text(COMPANY_NAME, PAGE_MARGIN, doc.y);
  doc.font("Helvetica").fontSize(9).fillColor("black").text(COMPANY_DEPARTMENT, PAGE_MARGIN, doc.y);
  doc.moveDown(0.6);

  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(doc.page.width - PAGE_MARGIN, doc.y).strokeColor(NAVY).lineWidth(1.5).stroke();
  doc.moveDown(0.8);

  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor("black")
    .text("INFORME DE TOMA DE INVENTARIO", PAGE_MARGIN, doc.y, { align: "center" });
  doc.moveDown(1);
}

function renderInfoBox(doc: PDFKit.PDFDocument, data: InventoryCountReportPdfData): void {
  const rows: [string, string][] = [
    ["Folio", data.number],
    ["Nombre", data.name],
    ["Auditor", userText(data.auditor)],
    ["Inicio", formatDate(data.startedAt)],
    ["Fin", data.closedAt ? formatDate(data.closedAt) : "Toma abierta"],
  ];
  for (const [label, value] of rows) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor("black").text(`${label}: `, PAGE_MARGIN, doc.y, { continued: true });
    doc.font("Helvetica").text(value);
  }
  doc.moveDown(0.8);
}

function renderSummary(doc: PDFKit.PDFDocument, summary: InventoryCountSummary): void {
  const parts = [
    `Equipos levantados: ${summary.totalLines}`,
    `Vinculados a activos existentes: ${summary.linkedLines}`,
    `Altas nuevas: ${summary.createdAssets}`,
    `Con cambios: ${summary.withChanges}`,
    `No encontrados: ${summary.missingAssets ?? "se determina al cerrar"}`,
  ];
  doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("Resumen", PAGE_MARGIN, doc.y);
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(9).fillColor("black").text(parts.join("   ·   "), PAGE_MARGIN, doc.y);
  doc.moveDown(1);
}

function renderSectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  if (doc.y > doc.page.height - PAGE_MARGIN - ROW_HEIGHT * 3) doc.addPage();
  doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text(title, PAGE_MARGIN, doc.y);
  doc.moveDown(0.4);
}

interface TableColumn {
  header: string;
  width: number;
}

function drawRow(doc: PDFKit.PDFDocument, y: number, columns: TableColumn[], cells: string[], bold: boolean): void {
  let x = PAGE_MARGIN;
  columns.forEach((column, index) => {
    doc.rect(x, y, column.width, ROW_HEIGHT).strokeColor("black").lineWidth(0.5).stroke();
    doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(8)
      .fillColor("black")
      // height + ellipsis: un texto largo se corta en vez de invadir la fila de abajo.
      .text(cells[index] ?? "", x + 4, y + 4, { width: column.width - 8, height: ROW_HEIGHT - 8, ellipsis: true });
    x += column.width;
  });
}

// Tabla con encabezado repetido en cada pagina. Cada fila mide ROW_HEIGHT fijo.
function drawTable(doc: PDFKit.PDFDocument, columns: TableColumn[], rows: string[][], emptyMessage: string): void {
  const bottom = doc.page.height - PAGE_MARGIN;
  let y = doc.y;
  drawRow(doc, y, columns, columns.map((column) => column.header), true);
  y += ROW_HEIGHT;

  if (rows.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor("black").text(emptyMessage, PAGE_MARGIN, y + 6);
    doc.y = y + ROW_HEIGHT + 6;
    doc.moveDown(1);
    return;
  }

  for (const row of rows) {
    if (y + ROW_HEIGHT > bottom) {
      doc.addPage();
      y = PAGE_MARGIN;
      drawRow(doc, y, columns, columns.map((column) => column.header), true);
      y += ROW_HEIGHT;
    }
    drawRow(doc, y, columns, row, false);
    y += ROW_HEIGHT;
  }
  doc.y = y + 12;
}
