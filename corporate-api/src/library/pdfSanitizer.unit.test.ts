import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTestPdf, QPDF_BIN, qpdfAvailable } from "../../test/pdfFixtures";
import { findActiveContent, sanitizePdf } from "./pdfSanitizer";

const QPDF = QPDF_BIN;
const buildPdf = buildTestPdf;

const asText = (buffer: Buffer): string => buffer.toString("latin1");

describe("findActiveContent (arbol de qpdf --json)", () => {
  it("acepta un arbol normal, incluido /OpenAction de zoom", () => {
    expect(findActiveContent({ "obj:1 0 R": { value: { "/Type": "/Catalog", "/OpenAction": ["3 0 R", "/Fit"] } } })).toBeNull();
  });

  it("rechaza las claves y los nombres que habilitan contenido activo", () => {
    for (const key of ["/JS", "/JavaScript", "/EF", "/EmbeddedFiles", "/RichMedia", "/XFA", "/Launch", "/GoToR", "/GoToE"]) {
      expect(findActiveContent({ value: { [key]: "u:x" } }), key).not.toBeNull();
    }
    for (const value of ["/JavaScript", "/Launch", "/SubmitForm", "/ImportData", "/FileAttachment", "/EmbeddedFile", "/Sound", "/3D", "/URI", "/Named", "/ResetForm", "/GoToDp", "/SetOCGState"]) {
      expect(findActiveContent({ value: { "/S": value } }), value).not.toBeNull();
      expect(findActiveContent([[value]]), value).not.toBeNull();
    }
  });

  it("no confunde una cadena PDF con un nombre ni un nombre parecido con uno activo", () => {
    expect(findActiveContent({ value: { "/Title": "u:/JavaScript", "/JSON": "b:00", "/JSPrefix": 1 } })).toBeNull();
  });

  it("acota la profundidad", () => {
    let deep: unknown = "x";
    for (let i = 0; i < 300; i += 1) deep = [deep];
    expect(findActiveContent(deep)).toContain("demasiado profunda");
  });
});

describe.skipIf(!qpdfAvailable)("sanitizePdf (qpdf real)", () => {
  it("acepta un PDF normal y devuelve su reescritura", async () => {
    const clean = await sanitizePdf(buildPdf());
    expect(asText(clean).startsWith("%PDF-")).toBe(true);
    expect(asText(clean)).toContain("%%EOF");
  });

  it("elimina la basura despues del PDF (polyglot)", async () => {
    const dirty = Buffer.concat([buildPdf(), Buffer.from("\nPAYLOAD-MALICIOSO-AL-FINAL", "latin1")]);
    expect(asText(await sanitizePdf(dirty))).not.toContain("PAYLOAD-MALICIOSO");
  });

  it("rechaza JavaScript en un objeto normal", async () => {
    const pdf = buildPdf(["<< /S /JavaScript /JS (app.alert(1)) >>"], "/OpenAction 5 0 R");
    await expect(sanitizePdf(pdf)).rejects.toThrow(/contenido activo/);
  });

  it("rechaza JavaScript escondido en un object stream comprimido", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pdf-test-"));
    try {
      const plain = join(dir, "plain.pdf");
      const packed = join(dir, "packed.pdf");
      writeFileSync(plain, buildPdf(["<< /S /JavaScript /JS (app.alert(1)) >>"], "/OpenAction 5 0 R"));
      execFileSync(QPDF, ["--object-streams=generate", "--compress-streams=y", plain, packed], { stdio: "ignore" });
      const hidden = readFileSync(packed);
      // En claro no aparece: solo se ve al parsear el object stream, que es lo que hace qpdf.
      expect(asText(hidden)).not.toContain("JavaScript");
      await expect(sanitizePdf(hidden)).rejects.toThrow(/contenido activo/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rechaza archivos incrustados y saltos a otros archivos", async () => {
    const embedded = buildPdf(
      ["<< /Type /Filespec /F (a.exe) /EF << /F 6 0 R >> >>", "<< /Length 0 >>\nstream\n\nendstream"],
      "/Names << /EmbeddedFiles << /Names [(a) 5 0 R] >> >>",
    );
    await expect(sanitizePdf(embedded)).rejects.toThrow(/contenido activo/);
    const remote = buildPdf(["<< /S /GoToR /F (otro.pdf) /D [0 /Fit] >>"], "/OpenAction 5 0 R");
    await expect(sanitizePdf(remote)).rejects.toThrow(/contenido activo/);
  });

  it("rechaza hipervinculos y acciones de navegacion (URI, Named)", async () => {
    const link = buildPdf(["<< /S /URI /URI (http://phishing.example) >>"], "/OpenAction 5 0 R");
    await expect(sanitizePdf(link)).rejects.toThrow(/contenido activo/);
    const named = buildPdf(["<< /S /Named /N /Print >>"], "/OpenAction 5 0 R");
    await expect(sanitizePdf(named)).rejects.toThrow(/contenido activo/);
  });

  it("acepta un PDF cifrado con contrasena de usuario vacia y lo entrega descifrado", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pdf-test-"));
    try {
      const plain = join(dir, "plain.pdf");
      const locked = join(dir, "locked.pdf");
      writeFileSync(plain, buildPdf());
      execFileSync(QPDF, ["--encrypt", "", "dueno", "256", "--", plain, locked], { stdio: "ignore" });
      expect(asText(readFileSync(locked))).toContain("/Encrypt");
      const clean = await sanitizePdf(readFileSync(locked));
      expect(asText(clean)).not.toContain("/Encrypt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rechaza un archivo que empieza con %PDF- pero no es un PDF", async () => {
    await expect(sanitizePdf(Buffer.from("%PDF-1.4\nesto no es un documento"))).rejects.toThrow(/PDF/);
  });

  it("falla cerrada (503) si qpdf no esta disponible", async () => {
    const previous = process.env.QPDF_BIN;
    process.env.QPDF_BIN = "qpdf-que-no-existe";
    try {
      await expect(sanitizePdf(buildPdf())).rejects.toMatchObject({ statusCode: 503 });
    } finally {
      if (previous === undefined) delete process.env.QPDF_BIN;
      else process.env.QPDF_BIN = previous;
    }
  });
});
