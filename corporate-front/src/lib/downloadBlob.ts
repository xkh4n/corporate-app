// Baja un Blob (PDF, etc.) como archivo desde el navegador. Mismo patron que
// el resto de las descargas del front (acta de entrega, OC), en una sola
// funcion para las pantallas nuevas.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  // El <a> se ancla al DOM (Firefox lo exige) y la URL se revoca con demora: revocarla justo tras click()
  // puede cortar la descarga en algunos navegadores.
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
