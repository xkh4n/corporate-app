import { describe, expect, it } from "vitest";
import { ASSET_LABEL_DEFAULT_CONFIG, renderAssetLabelZpl, renderAssetLabelsZpl } from "./assetLabelZpl";

describe("assetLabelZpl", () => {
  it("genera un bloque ^XA...^XZ balanceado con el tag y el ancho/alto en dots", () => {
    const zpl = renderAssetLabelZpl({ tag: "ACT000000001", serialNumber: "SN-1", productName: "Notebook" });

    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl.endsWith("^XZ")).toBe(true);
    // 50mm a 203dpi (203/25.4 dots/mm) redondea a 400 dots.
    expect(zpl).toContain("^PW400");
    expect(zpl).toContain("ACT000000001");
    expect(zpl).toContain("Notebook");
    expect(zpl).toContain("S/N SN-1");
  });

  it("usa CODE128 por defecto y cambia de comando segun barcodeType", () => {
    const code128 = renderAssetLabelZpl({ tag: "ACT1" });
    expect(code128).toContain("^BCN");

    const qr = renderAssetLabelZpl({ tag: "ACT1" }, { ...ASSET_LABEL_DEFAULT_CONFIG, barcodeType: "QR" });
    expect(qr).toContain("^BQN");

    const code39 = renderAssetLabelZpl({ tag: "ACT1" }, { ...ASSET_LABEL_DEFAULT_CONFIG, barcodeType: "CODE39" });
    expect(code39).toContain("^B3N");
  });

  it("respeta los toggles showBorder/showProductName/showSerialNumber", () => {
    const minimal = renderAssetLabelZpl(
      { tag: "ACT1", serialNumber: "SN-1", productName: "Notebook" },
      { ...ASSET_LABEL_DEFAULT_CONFIG, showBorder: false, showProductName: false, showSerialNumber: false },
    );
    expect(minimal).not.toContain("^GB");
    expect(minimal).not.toContain("Notebook");
    expect(minimal).not.toContain("S/N");
  });

  it("escapa '^' y '~' en campos de texto libre para no cortar el comando ZPL a la mitad", () => {
    const zpl = renderAssetLabelZpl({ tag: "ACT1", productName: 'Producto "raro" ^con~caracteres' });
    expect(zpl).not.toMatch(/\^con~caracteres/);
    expect(zpl).toContain("Producto \"raro\" concaracteres");
  });

  it("un lote de N activos produce N bloques ^XA...^XZ concatenados, uno por etiqueta fisica", () => {
    const zpl = renderAssetLabelsZpl([{ tag: "ACT1" }, { tag: "ACT2" }, { tag: "ACT3" }]);
    expect(zpl.match(/\^XA/g)).toHaveLength(3);
    expect(zpl.match(/\^XZ/g)).toHaveLength(3);
    expect(zpl).toContain("ACT1");
    expect(zpl).toContain("ACT2");
    expect(zpl).toContain("ACT3");
  });
});
