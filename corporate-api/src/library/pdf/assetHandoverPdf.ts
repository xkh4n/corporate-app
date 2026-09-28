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
  // assets.value (DECIMAL como string). null = activo sin valorizar.
  assetValue: string | null;
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
// Margenes de 0,5 cm por lado (72 pt = 2,54 cm), a pedido del usuario.
const PAGE_MARGIN = (0.5 * 72) / 2.54;
const CONTENT_WIDTH = 612 - PAGE_MARGIN * 2;
// Tablas de 2 columnas (etiqueta | valor), como el formulario en papel que usa TI.
const LABEL_WIDTH = CONTENT_WIDTH * 0.45;
const HEADER_FILL = "#d9d9d9";
// El contenedor corre en UTC: sin zona fija, una entrega hecha de noche en Chile
// saldria con el dia siguiente.
const TIME_ZONE = "America/Santiago";
const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP" });

function formatAssetValue(value: string | null): string {
  if (value === null) return "Sin valorizar";
  const amount = Number(value);
  return Number.isFinite(amount) ? CLP.format(amount) : "Sin valorizar";
}

export function renderAssetHandoverPdf(data: AssetHandoverPdfData): PDFKit.PDFDocument {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: "LETTER" });

  renderLetterhead(doc);
  renderObjetive(doc);
  renderEmployeeBox(doc, data);
  renderDeclaration(doc, data.assignedAt);
  renderAssetBox(doc, data);
  renderSignatures(doc);

  doc.end();
  return doc;
}

function renderLetterhead(doc: PDFKit.PDFDocument): void {
  const logoWidth = 160;
  const logoHeight = logoWidth * LOGO_ASPECT_RATIO;
  doc.image(LOGO_PATH, (doc.page.width - logoWidth) / 2, doc.y, { width: logoWidth });
  doc.y += logoHeight + 12;

  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(doc.page.width - PAGE_MARGIN, doc.y).strokeColor(NAVY).lineWidth(1.5).stroke();
  doc.moveDown(1);
}

interface Cell {
  width: number;
  text: string;
  bold?: boolean;
  align?: "left" | "center";
  fill?: string;
}

function drawRow(doc: PDFKit.PDFDocument, y: number, height: number, cells: Cell[]): void {
  let cellX = PAGE_MARGIN;
  for (const cell of cells) {
    if (cell.fill) {
      doc.rect(cellX, y, cell.width, height).fillAndStroke(cell.fill, "black");
    } else {
      doc.rect(cellX, y, cell.width, height).strokeColor("black").stroke();
    }
    doc
      .font(cell.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(9)
      .fillColor("black")
      .text(cell.text, cellX + 5, y + 6, { width: cell.width - 10, align: cell.align ?? "left" });
    cellX += cell.width;
  }
}

// Tabla de 2 columnas: fila de encabezado sombreada y luego etiqueta | valor
// (valor centrado). header de 1 celda ocupa el ancho completo; de 2, una por columna.
function drawTwoColumnTable(
  doc: PDFKit.PDFDocument,
  header: string[],
  rows: { label: string; value: string }[],
): void {
  const rowHeight = 20;
  let y = doc.y;
  const headerCells: Cell[] =
    header.length === 1
      ? [{ width: CONTENT_WIDTH, text: header[0] ?? "", bold: true, fill: HEADER_FILL }]
      : [
          { width: LABEL_WIDTH, text: header[0] ?? "", bold: true, align: "center", fill: HEADER_FILL },
          { width: CONTENT_WIDTH - LABEL_WIDTH, text: header[1] ?? "", bold: true, align: "center", fill: HEADER_FILL },
        ];
  drawRow(doc, y, rowHeight, headerCells);
  y += rowHeight;
  for (const row of rows) {
    drawRow(doc, y, rowHeight, [
      { width: LABEL_WIDTH, text: row.label },
      { width: CONTENT_WIDTH - LABEL_WIDTH, text: row.value, align: "center" },
    ]);
    y += rowHeight;
  }
  doc.y = y + 15;
}

function renderEmployeeBox(doc: PDFKit.PDFDocument, data: AssetHandoverPdfData): void {
  drawTwoColumnTable(doc, ["Identificación del empleado"], [
    { label: "Nombre completo del empleado", value: data.employeeName },
    { label: "RUT del empleado", value: data.employeeDocumentId },
    { label: "Cargo del empleado", value: data.position ?? "" },
    { label: "Centro de costo", value: data.costCenterName ?? "" },
    { label: "Nombre jefe directo", value: data.supervisorName ?? "" },
  ]);
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
  const rows: { label: string; value: string }[] = [
    { label: "Tag", value: data.assetTag },
    ...(data.productName ? [{ label: "Producto", value: data.productName }] : []),
    ...(data.serialNumber ? [{ label: "N° de serie", value: data.serialNumber }] : []),
    { label: "Valor", value: formatAssetValue(data.assetValue) },
    ...(data.supplierName ? [{ label: "Proveedor", value: data.supplierName }] : []),
    ...(data.storageCapacity ? [{ label: "Capacidad de Almacenamiento", value: data.storageCapacity }] : []),
    ...(data.ramCapacity ? [{ label: "Capacidad de Memoria", value: data.ramCapacity }] : []),
    ...(data.hasBag !== null ? [{ label: "Bolso", value: yesNo(data.hasBag)! }] : []),
    ...(data.hasLock !== null ? [{ label: "Candado", value: yesNo(data.hasLock)! }] : []),
    ...(data.hasCharger !== null ? [{ label: "Cargador", value: yesNo(data.hasCharger)! }] : []),
    ...(data.macAddress ? [{ label: "MAC Address", value: data.macAddress }] : []),
  ];

  drawTwoColumnTable(doc, ["Equipamiento", "Especificaciones"], rows);
}

// La fecha es la de la asignacion (no la de generacion del PDF): al reimprimir
// el acta desde Formulario Asignacion debe seguir diciendo cuando se entrego.
function renderDeclaration(doc: PDFKit.PDFDocument, assignedAt: Date): void {
  const dateLabel = new Date(assignedAt).toLocaleDateString("es-CL", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: TIME_ZONE,
  });
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("black")
    .text("Con fecha ", PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, align: "justify", continued: true })
    .font("Helvetica-Bold")
    .text(dateLabel, { continued: true })
    .font("Helvetica")
    .text(
      ", se hace entrega del equipamiento detallado en el presente documento, el cual queda " +
        "bajo la responsabilidad y cuidado del colaborador individualizado, comprometiéndose a su buen uso y " +
        "resguardo, así como a la restitución del mismo en caso de desvinculación o cambio de asignación.",
    );
  doc.moveDown(2);
}


function renderObjetive(doc: PDFKit.PDFDocument): void{
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("black")
    .font("Helvetica")
    .text(
      "El objetivo del presente formulario es registrar la entrega de implementos " +
        "tecnológicos a usuarios finales dejando constancia de la fecha, tipo y valor " +
        "del equipamiento entregado.",
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
