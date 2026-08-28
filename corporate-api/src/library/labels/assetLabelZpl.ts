// Generador de ZPL (Zebra Programming Language) para la etiqueta fisica de
// un activo. Puro/sin dependencias -corre igual en el backend (aca) o en el
// navegador si algun dia hiciera falta-, no requiere ninguna libreria de
// impresion: el backend solo arma texto plano, la impresion real la hace el
// NAVEGADOR (WebUSB), nunca este servidor -las 3 replicas de la API viven en
// redes internal:true (ver compose.dev.yml) y no alcanzan la LAN donde vive
// la impresora Zebra.
//
// A diferencia de un layout de hoja de etiquetas para imprimir en PDF (que
// necesita "tiling" en columnas/filas con margenes), una impresora Zebra
// real imprime de a UNA etiqueta por bloque ^XA...^XZ -cada ^XZ hace avanzar
// el rollo a la siguiente etiqueta. Por eso un lote de N activos es
// simplemente N bloques concatenados, no una grilla.
const DOTS_PER_MM = 203 / 25.4; // 203 dpi, resolucion estandar Zebra

export type AssetLabelBarcodeType = "CODE128" | "CODE39" | "QR";

export interface AssetLabelData {
  tag: string;
  serialNumber?: string | null;
  productName?: string | null;
}

export interface AssetLabelConfig {
  widthMm: number;
  heightMm: number;
  barcodeType: AssetLabelBarcodeType;
  showBorder: boolean;
  showProductName: boolean;
  showSerialNumber: boolean;
}

export const ASSET_LABEL_DEFAULT_CONFIG: AssetLabelConfig = {
  widthMm: 50,
  heightMm: 30,
  barcodeType: "CODE128",
  showBorder: true,
  showProductName: true,
  showSerialNumber: true,
};

function mm(value: number): number {
  return Math.round(value * DOTS_PER_MM);
}

// Escapa los 3 caracteres que ZPL reserva como delimitadores de comando
// (^ ~ y el separador de campo por defecto) -tag/serialNumber/productName
// vienen de datos reales (tag generado por el sistema, pero serialNumber y
// productName son texto libre cargado por un usuario en algun punto de la
// cadena), sin esto un valor con "^" cortaria el comando ZPL a la mitad.
function escapeZpl(value: string): string {
  return value.replace(/[\^~]/g, "");
}

function renderBarcodeCommand(type: AssetLabelBarcodeType, tag: string, x: number, y: number, heightDots: number): string {
  const value = escapeZpl(tag);
  if (type === "QR") {
    return `^FO${x},${y}^BQN,2,5\n^FDQA,${value}^FS`;
  }
  if (type === "CODE39") {
    return `^FO${x},${y}^B3N,N,${heightDots},Y,N\n^FD${value}^FS`;
  }
  return `^FO${x},${y}^BCN,${heightDots},Y,N,N\n^FD${value}^FS`;
}

// Un solo bloque ^XA...^XZ = una etiqueta fisica.
export function renderAssetLabelZpl(data: AssetLabelData, config: AssetLabelConfig = ASSET_LABEL_DEFAULT_CONFIG): string {
  const widthDots = mm(config.widthMm);
  const heightDots = mm(config.heightMm);
  const margin = mm(2);
  const barcodeHeight = mm(config.heightMm * 0.35);

  const lines: string[] = ["^XA", `^PW${widthDots}`, `^LL${heightDots}`, "^CI28"];

  if (config.showBorder) {
    lines.push(`^FO0,0^GB${widthDots},${heightDots},2^FS`);
  }

  let cursorY = margin;
  if (config.showProductName && data.productName) {
    lines.push(`^FO${margin},${cursorY}^A0N,${mm(3)},${mm(3)}^FD${escapeZpl(data.productName)}^FS`);
    cursorY += mm(4);
  }

  lines.push(renderBarcodeCommand(config.barcodeType, data.tag, margin, cursorY, barcodeHeight));
  cursorY += barcodeHeight + mm(2);

  lines.push(`^FO${margin},${cursorY}^A0N,${mm(2.5)},${mm(2.5)}^FD${escapeZpl(data.tag)}^FS`);
  cursorY += mm(3.5);

  if (config.showSerialNumber && data.serialNumber) {
    lines.push(`^FO${margin},${cursorY}^A0N,${mm(2)},${mm(2)}^FDS/N ${escapeZpl(data.serialNumber)}^FS`);
  }

  lines.push("^XZ");
  return lines.join("\n");
}

export function renderAssetLabelsZpl(items: AssetLabelData[], config: AssetLabelConfig = ASSET_LABEL_DEFAULT_CONFIG): string {
  return items.map((item) => renderAssetLabelZpl(item, config)).join("\n");
}
