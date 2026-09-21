import { spawnSync } from "node:child_process";

// Solo para tests: armado de PDF minimos validos (con su tabla xref) para probar el saneado con qpdf
// (src/library/pdfSanitizer.ts).

// Binario de qpdf que usan los tests (QPDF_BIN o "qpdf" en el PATH).
export const QPDF_BIN = process.env.QPDF_BIN?.trim() || "qpdf";

// Los tests que suben PDF de verdad necesitan qpdf: en el contenedor esta instalado; en el equipo
// de desarrollo (winget install QPDF.QPDF) hay que tenerlo en el PATH o en QPDF_BIN.
export const qpdfAvailable = spawnSync(QPDF_BIN, ["--version"]).status === 0;

// `extra` agrega objetos completos (numerados desde el 5) y `catalogExtra` claves al catalogo.
export function buildTestPdf(extra: string[] = [], catalogExtra = "", pageText = "Guia de despacho"): Buffer {
  const content = `BT /F1 12 Tf 20 100 Td (${pageText}) Tj ET`;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${catalogExtra} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...extra,
  ];
  let body = "%PDF-1.5\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

// PDF con una accion de JavaScript que se ejecuta al abrirlo.
export function buildJavaScriptPdf(): Buffer {
  return buildTestPdf(["<< /S /JavaScript /JS (app.alert(1)) >>"], "/OpenAction 5 0 R");
}
