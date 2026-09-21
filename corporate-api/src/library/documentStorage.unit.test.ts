import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteIfExists, findFileByPrefix, listFiles, saveBuffer } from "./documentStorage";

let folder: string;

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "docstorage-"));
});

afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true });
});

describe("saveBuffer", () => {
  it("escribe el archivo, sobrescribe y no deja temporales", () => {
    saveBuffer(folder, "OC-1.pdf", Buffer.from("uno"));
    saveBuffer(folder, "OC-1.pdf", Buffer.from("dos"));

    expect(fs.readFileSync(path.join(folder, "OC-1.pdf"), "utf8")).toBe("dos");
    expect(fs.readdirSync(folder)).toEqual(["OC-1.pdf"]);
  });

  it("crea la carpeta si no existe", () => {
    const nested = path.join(folder, "a", "b");
    saveBuffer(nested, "x.pdf", Buffer.from("x"));
    expect(fs.existsSync(path.join(nested, "x.pdf"))).toBe(true);
  });
});

describe("deleteIfExists", () => {
  it("borra el archivo y no falla si ya no existe", () => {
    saveBuffer(folder, "x.pdf", Buffer.from("x"));
    deleteIfExists(folder, "x.pdf");
    expect(fs.existsSync(path.join(folder, "x.pdf"))).toBe(false);
    expect(() => deleteIfExists(folder, "x.pdf")).not.toThrow();
  });
});

describe("findFileByPrefix", () => {
  it("coincide solo con el prefijo exacto seguido de la extension", () => {
    saveBuffer(folder, "OC-10.pdf", Buffer.from("diez"));
    saveBuffer(folder, "COT-1234.pdf", Buffer.from("otro proveedor"));

    // "OC-1" y "COT-123" NO deben casar con "OC-10.pdf" ni con "COT-1234.pdf".
    expect(findFileByPrefix(folder, "OC-1")).toBeNull();
    expect(findFileByPrefix(folder, "COT-123")).toBeNull();

    saveBuffer(folder, "OC-1.pdf", Buffer.from("uno"));
    expect(findFileByPrefix(folder, "OC-1")).toBe("OC-1.pdf");
    expect(findFileByPrefix(folder, "OC-10")).toBe("OC-10.pdf");
  });

  it("ignora los temporales y devuelve null si la carpeta no existe", () => {
    fs.writeFileSync(path.join(folder, "OC-5.pdf.123.tmp"), "a medias");
    expect(findFileByPrefix(folder, "OC-5")).toBeNull();
    expect(findFileByPrefix(path.join(folder, "no-existe"), "OC-5")).toBeNull();
  });
});

describe("listFiles", () => {
  it("lista archivos, no subcarpetas ni temporales", () => {
    saveBuffer(folder, "a.pdf", Buffer.from("a"));
    fs.mkdirSync(path.join(folder, "sub"));
    fs.writeFileSync(path.join(folder, "b.pdf.9.tmp"), "b");
    expect(listFiles(folder)).toEqual(["a.pdf"]);
  });
});
