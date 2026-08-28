// Preview ZPL -> PNG via la API publica de Labelary (http://labelary.com).
// Corre desde el NAVEGADOR del usuario (que si tiene salida a internet
// real), nunca desde el backend -las 3 replicas de corporate-api viven en
// redes internal:true. 8dpmm = 203 dpi, la resolucion Zebra estandar que ya
// asume assetLabelZpl.ts en el backend.
const LABELARY_BASE_URL = "https://api.labelary.com/v1/printers/8dpmm/labels";

function mmToInches(mm: number): string {
  return (mm / 25.4).toFixed(2);
}

// Devuelve un object URL (blob:) listo para un <img src>. El caller es
// responsable de hacer URL.revokeObjectURL cuando ya no lo necesite, para no
// filtrar memoria en una sesion larga generando muchos previews.
export async function renderZplPreview(zpl: string, widthMm: number, heightMm: number): Promise<string> {
  const url = `${LABELARY_BASE_URL}/${mmToInches(widthMm)}x${mmToInches(heightMm)}/0/`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "image/png" },
    body: zpl,
  });
  if (!res.ok) {
    throw new Error(`No se pudo generar la vista previa (Labelary respondió ${res.status})`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
