import type { AssetLabelBarcodeType, AssetLabelConfig } from "../types/asset";

// Opciones de etiqueta compartidas por la impresion de etiquetas de activos
// (pages/activos/PrintAssetLabels.tsx) y por las etiquetas nuevas de una toma
// de inventario (pages/inventario). Espejo de ASSET_LABEL_DEFAULT_CONFIG en
// corporate-api/src/library/labels/assetLabelZpl.ts.
export const BARCODE_OPTIONS: { value: AssetLabelBarcodeType; label: string }[] = [
  { value: "CODE128", label: "Código de barras (CODE128)" },
  { value: "CODE39", label: "Código de barras (CODE39)" },
  { value: "QR", label: "Código QR" },
];

export const DEFAULT_LABEL_CONFIG: AssetLabelConfig = {
  widthMm: 50,
  heightMm: 30,
  barcodeType: "CODE128",
  showBorder: true,
  showProductName: true,
  showSerialNumber: true,
};
