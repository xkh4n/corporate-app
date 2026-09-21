import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { getQuoteRequestFolder, sanitizeFilenameSegment } from "../documentStorage";

export interface QuoteRequestPdfItem {
  no: number;
  productName: string;
  categoryName: string | null;
  description: string | null;
  quantity: number;
}

export interface QuoteRequestPdfData {
  requestNumber: string;
  requesterName: string;
  supplierLegalName: string | null;
  supplierNationalId: string | null;
  items: QuoteRequestPdfItem[];
}

const LOGO_PATH = path.join(__dirname, "assets/imperial-logo.png");
const LOGO_ASPECT_RATIO = 235 / 1902;
const COMPANY_NAME = "IMPERIAL S. A.";
const COMPANY_DEPARTMENT = "Departamento de Tecnología";
const NAVY = "#003764";
const PAGE_MARGIN = 50;
const CONTENT_WIDTH = 612 - PAGE_MARGIN * 2;

const TABLE_COLUMNS = [
  { label: "N°", width: 25 },
  { label: "Producto", width: 140 },
  { label: "Categoría", width: 90 },
  { label: "Descripción", width: 147 },
  { label: "Cantidad", width: 50 },
  { label: "Observaciones", width: 60 },
] as const;

// pdfkit (puro JS, sin Chromium/canvas) en vez de puppeteer: el contenedor de
// corporate-api no tiene salida a internet en runtime -pdfkit no la
// necesita, todo el render (logo incluido, embebido como asset local en
// ./assets) es local. Devuelve el PDFDocument sin cerrar el stream hasta
// despues de escribir todo el contenido; quien lo llama hace .pipe(res) y
// espera a doc.end().
export function renderQuoteRequestPdf(data: QuoteRequestPdfData): PDFKit.PDFDocument {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "LETTER" });

  renderLetterhead(doc);
  renderInfoBox(doc, data);
  renderIntro(doc);
  renderItemsTable(doc, data.items);
  renderRequester(doc, data.requesterName);
  renderSignatures(doc);

  doc.end();
  return doc;
}

// Archiva una copia del documento generado en disco, agrupada por solicitud
// (carpeta de descargas del proyecto, no una ruta externa) ademas de
// servirlo por HTTP -es el respaldo formal de la solicitud de cotizacion
// enviada a ESE proveedor especifico (uno por proveedor cotizante, no uno
// solo por solicitud). Sin nationalId (descarga generica, sin proveedor
// elegido todavia) no hay nada que archivar, solo se sirve la descarga. Se
// crea SOLO si no existia todavia: es el respaldo de la version oficial
// emitida la primera vez, no se pisa en descargas posteriores.
export function archiveQuoteRequestPdf(
  doc: PDFKit.PDFDocument,
  requestNumber: string,
  nationalId: string | null,
): void {
  if (!nationalId) return;
  const folder = getQuoteRequestFolder(requestNumber);
  // nationalId es texto libre controlado por el usuario (a diferencia de
  // requestNumber, generado por el sistema) -se sanea igual que
  // documentNumber para no permitir separadores de ruta ni "..".
  const filePath = path.join(folder, `SOLCOT-${sanitizeFilenameSegment(nationalId)}.pdf`);
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(folder, { recursive: true });
  doc.pipe(fs.createWriteStream(filePath));
}

function renderLetterhead(doc: PDFKit.PDFDocument): void {
  const logoWidth = 160;
  const logoHeight = logoWidth * LOGO_ASPECT_RATIO;
  doc.image(LOGO_PATH, (doc.page.width - logoWidth) / 2, doc.y, { width: logoWidth });
  doc.y += logoHeight + 12;

  doc.font("Helvetica-Bold").fontSize(13).fillColor(NAVY).text(COMPANY_NAME, PAGE_MARGIN, doc.y);
  doc.font("Helvetica").fontSize(9).fillColor("black").text(COMPANY_DEPARTMENT, PAGE_MARGIN, doc.y);
  doc.moveDown(0.6);

  doc
    .moveTo(PAGE_MARGIN, doc.y)
    .lineTo(doc.page.width - PAGE_MARGIN, doc.y)
    .strokeColor(NAVY)
    .lineWidth(1.5)
    .stroke();
  doc.moveDown(0.8);

  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor("black")
    .text("SOLICITUD DE COTIZACIÓN", PAGE_MARGIN, doc.y, { align: "center" });
  doc.moveDown(1);
}

function renderInfoBox(doc: PDFKit.PDFDocument, data: QuoteRequestPdfData): void {
  const rowHeight = 20;
  const labelWidth = 80;
  const halfWidth = CONTENT_WIDTH / 2;
  let y = doc.y;

  drawInfoRow(doc, y, rowHeight, [
    { width: labelWidth, text: "Folio", bold: true },
    { width: halfWidth - labelWidth, text: data.requestNumber },
    { width: labelWidth, text: "Fecha", bold: true },
    {
      width: halfWidth - labelWidth,
      text: new Date().toLocaleDateString("es-CL", { year: "numeric", month: "2-digit", day: "2-digit" }),
    },
  ]);
  y += rowHeight;

  drawInfoRow(doc, y, rowHeight, [
    { width: labelWidth, text: "Dirigido a", bold: true },
    { width: CONTENT_WIDTH - labelWidth, text: data.supplierLegalName ?? "" },
  ]);
  y += rowHeight;

  doc.y = y + 15;
}

function drawInfoRow(
  doc: PDFKit.PDFDocument,
  y: number,
  height: number,
  cells: { width: number; text: string; bold?: boolean }[],
): void {
  let cellX = PAGE_MARGIN;
  for (const cell of cells) {
    doc.rect(cellX, y, cell.width, height).strokeColor("black").stroke();
    doc
      .font(cell.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(9)
      .fillColor("black")
      .text(cell.text, cellX + 5, y + 6, { width: cell.width - 10 });
    cellX += cell.width;
  }
}

function renderIntro(doc: PDFKit.PDFDocument): void {
  doc
    .font("Helvetica")
    .fontSize(10)
    .text(
      "Estimados, solicitamos a ustedes presentar una cotización formal para los productos y/o servicios " +
        "detallados a continuación.",
      PAGE_MARGIN,
      doc.y,
      { width: CONTENT_WIDTH, align: "justify" },
    );
  doc.moveDown(1);
}

function renderItemsTable(doc: PDFKit.PDFDocument, items: QuoteRequestPdfItem[]): void {
  const headerHeight = 20;
  const rowHeight = 22;
  const bottomLimit = doc.page.height - PAGE_MARGIN;

  drawTableHeader(doc, headerHeight);

  for (const item of items) {
    if (doc.y + rowHeight > bottomLimit) {
      doc.addPage();
      doc.y = PAGE_MARGIN;
      drawTableHeader(doc, headerHeight);
    }
    drawTableRow(doc, rowHeight, item);
  }
  doc.moveDown(1);
}

function drawTableHeader(doc: PDFKit.PDFDocument, headerHeight: number): void {
  const y = doc.y;
  let cellX = PAGE_MARGIN;
  for (const col of TABLE_COLUMNS) {
    doc.rect(cellX, y, col.width, headerHeight).fillAndStroke(NAVY, NAVY);
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor("white")
      .text(col.label, cellX + 4, y + 6, { width: col.width - 8 });
    cellX += col.width;
  }
  doc.y = y + headerHeight;
}

function drawTableRow(doc: PDFKit.PDFDocument, rowHeight: number, item: QuoteRequestPdfItem): void {
  const y = doc.y;
  const values = [
    String(item.no),
    item.productName,
    item.categoryName ?? "",
    item.description ?? "",
    String(item.quantity),
    "",
  ];
  let cellX = PAGE_MARGIN;
  TABLE_COLUMNS.forEach((col, i) => {
    doc.rect(cellX, y, col.width, rowHeight).strokeColor("black").stroke();
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("black")
      .text(values[i] ?? "", cellX + 4, y + 6, { width: col.width - 8 });
    cellX += col.width;
  });
  doc.y = y + rowHeight;
}

function renderRequester(doc: PDFKit.PDFDocument, requesterName: string): void {
  if (doc.y + 60 > doc.page.height - PAGE_MARGIN) doc.addPage();
  doc.font("Helvetica").fontSize(10).fillColor("black").text(`Solicitado por: ${requesterName}`, PAGE_MARGIN, doc.y);
  doc.moveDown(3);
}

const SIGNATURE_BLOCK_HEIGHT = 40;

// Siempre al pie de la pagina (mismo criterio que la plantilla en papel):
// si el contenido de arriba ya llego hasta ahi, pasa a una pagina nueva; si
// termino mas arriba, el bloque de firmas "baja" hasta el margen inferior en
// vez de quedar pegado al contenido.
function renderSignatures(doc: PDFKit.PDFDocument): void {
  const footerY = doc.page.height - PAGE_MARGIN - SIGNATURE_BLOCK_HEIGHT;
  if (doc.y > footerY) {
    doc.addPage();
  }
  doc.y = footerY;

  const labels = ["Solicitante", "Jefatura", "Abastecimiento / Compras"];
  const blockWidth = CONTENT_WIDTH / labels.length;
  const lineY = doc.y;

  labels.forEach((label, i) => {
    const x = PAGE_MARGIN + i * blockWidth + 10;
    const width = blockWidth - 20;
    doc.moveTo(x, lineY).lineTo(x + width, lineY).strokeColor("black").lineWidth(1).stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("black").text(label, x, lineY + 5, { width, align: "center" });
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("black")
      .text("Nombre, Firma y Fecha", x, lineY + 18, { width, align: "center" });
  });
}
