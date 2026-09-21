import path from "node:path";
import PDFDocument from "pdfkit";

export interface AssetHandoverPdfData {
  employeeName: string;
  employeeDocumentId: string;
  position: string | null;
  costCenterName: string | null;
  supervisorName: string | null;
  assetTag: string;
  serialNumber: string | null;
  productName: string | null;
  supplierName: string | null;
  storageCapacity: string | null;
  ramCapacity: string | null;
  hasBag: boolean | null;
  hasLock: boolean | null;
  hasCharger: boolean | null;
  macAddress: string | null;
  assignedAt: Date;
}

// Mismo membrete/paleta que library/pdf/quoteRequestPdf.ts (logo, NAVY,
// Helvetica) -pdfkit puro, sin Chromium/canvas, corre local sin salida a
// internet, igual criterio que el resto de los PDF de este proyecto.
const LOGO_PATH = path.join(__dirname, "assets/imperial-logo.png");
const LOGO_ASPECT_RATIO = 235 / 1902;
const COMPANY_NAME = "IMPERIAL S. A.";
const COMPANY_DEPARTMENT = "Departamento de Tecnología";
const NAVY = "#003764";
const PAGE_MARGIN = 50;
const CONTENT_WIDTH = 612 - PAGE_MARGIN * 2;

export function renderAssetHandoverPdf(data: AssetHandoverPdfData): PDFKit.PDFDocument {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "LETTER" });

  renderLetterhead(doc);
  renderEmployeeBox(doc, data);
  renderAssetBox(doc, data);
  renderDeclaration(doc);
  renderSignatures(doc);

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
    .text("ACTA DE ENTREGA DE EQUIPAMIENTO", PAGE_MARGIN, doc.y, { align: "center" });
  doc.moveDown(1);
}

function drawRow(doc: PDFKit.PDFDocument, y: number, height: number, cells: { width: number; text: string; bold?: boolean }[]): void {
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

function renderEmployeeBox(doc: PDFKit.PDFDocument, data: AssetHandoverPdfData): void {
  const rowHeight = 20;
  const labelWidth = 100;
  const halfWidth = CONTENT_WIDTH / 2;
  let y = doc.y;

  // Nombre completo en su PROPIA fila de ancho completo (no compartida con
  // RUT): un nombre compuesto + 2 apellidos (comun en RUT chilenos) no
  // entraba en la mitad del ancho a 9pt y pdfkit lo envolvia a una segunda
  // linea, que quedaba tapada por el borde de la fila de abajo -se veia
  // como texto tachado. Encontrado en vivo con un nombre real de 26+
  // caracteres, no era un caso hipotetico.
  drawRow(doc, y, rowHeight, [
    { width: labelWidth, text: "Colaborador", bold: true },
    { width: CONTENT_WIDTH - labelWidth, text: data.employeeName },
  ]);
  y += rowHeight;

  drawRow(doc, y, rowHeight, [
    { width: labelWidth, text: "RUT", bold: true },
    { width: halfWidth - labelWidth, text: data.employeeDocumentId },
    { width: labelWidth, text: "Centro de costo", bold: true },
    { width: halfWidth - labelWidth, text: data.costCenterName ?? "" },
  ]);
  y += rowHeight;

  drawRow(doc, y, rowHeight, [
    { width: labelWidth, text: "Cargo", bold: true },
    { width: halfWidth - labelWidth, text: data.position ?? "" },
    { width: labelWidth, text: "Jefe directo", bold: true },
    { width: halfWidth - labelWidth, text: data.supervisorName ?? "" },
  ]);
  y += rowHeight;

  doc.y = y + 15;
}

function yesNo(value: boolean | null): string | null {
  return value === null ? null : value ? "Sí" : "No";
}

// Tabla "Equipamiento / Especificaciones" -una fila por dato del acta
// (Marca/Modelo/N° serie/N° tag/Proveedor/Almacenamiento/Memoria/Bolso/
// Candado/Cargador/MAC). Marca y Modelo se
// omiten a proposito: el Product de corporate-app no tiene esos campos (solo
// nombre/descripcion/tipo) -no hay de donde derivarlos sin agregar columnas
// nuevas al catalogo de productos, que no se pidio. Cada fila con valor nulo
// se omite en vez de mostrarse vacia -el set de campos varia segun si el
// activo tiene producto/proveedor resuelto y si el formulario cargo
// especificaciones de notebook.
function renderAssetBox(doc: PDFKit.PDFDocument, data: AssetHandoverPdfData): void {
  doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("Equipamiento", PAGE_MARGIN, doc.y);
  doc.moveDown(0.4);

  const rowHeight = 20;
  const labelWidth = 220;
  let y = doc.y;

  const rows: { label: string; value: string }[] = [
    { label: "Tag", value: data.assetTag },
    ...(data.productName ? [{ label: "Producto", value: data.productName }] : []),
    ...(data.serialNumber ? [{ label: "N° de serie", value: data.serialNumber }] : []),
    ...(data.supplierName ? [{ label: "Proveedor", value: data.supplierName }] : []),
    ...(data.storageCapacity ? [{ label: "Capacidad de Almacenamiento", value: data.storageCapacity }] : []),
    ...(data.ramCapacity ? [{ label: "Capacidad de Memoria", value: data.ramCapacity }] : []),
    ...(data.hasBag !== null ? [{ label: "Bolso", value: yesNo(data.hasBag)! }] : []),
    ...(data.hasLock !== null ? [{ label: "Candado", value: yesNo(data.hasLock)! }] : []),
    ...(data.hasCharger !== null ? [{ label: "Cargador", value: yesNo(data.hasCharger)! }] : []),
    ...(data.macAddress ? [{ label: "MAC Address", value: data.macAddress }] : []),
  ];

  for (const row of rows) {
    drawRow(doc, y, rowHeight, [
      { width: labelWidth, text: row.label, bold: true },
      { width: CONTENT_WIDTH - labelWidth, text: row.value },
    ]);
    y += rowHeight;
  }

  doc.y = y + 15;
}

function renderDeclaration(doc: PDFKit.PDFDocument): void {
  const dateLabel = new Date().toLocaleDateString("es-CL", { year: "numeric", month: "long", day: "numeric" });
  doc
    .font("Helvetica")
    .fontSize(10)
    .text(
      `Con fecha ${dateLabel}, se hace entrega del equipamiento detallado en el presente documento, el cual queda ` +
        "bajo la responsabilidad y cuidado del colaborador individualizado, comprometiéndose a su buen uso y " +
        "resguardo, así como a la restitución del mismo en caso de desvinculación o cambio de asignación.",
      PAGE_MARGIN,
      doc.y,
      { width: CONTENT_WIDTH, align: "justify" },
    );
  doc.moveDown(2);
}

const SIGNATURE_BLOCK_HEIGHT = 40;

// Mismo criterio que quoteRequestPdf.ts: el bloque de firmas siempre queda
// pegado al pie de la pagina.
function renderSignatures(doc: PDFKit.PDFDocument): void {
  const footerY = doc.page.height - PAGE_MARGIN - SIGNATURE_BLOCK_HEIGHT;
  if (doc.y > footerY) {
    doc.addPage();
  }
  doc.y = footerY;

  const labels = ["Colaborador", "Jefatura / RR.HH."];
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
