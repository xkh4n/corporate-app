// Impresion de ZPL desde el navegador via WebUSB -el backend NUNCA imprime
// directo (las 3 replicas de corporate-api viven en redes internal:true, sin
// salida a la LAN donde vive la impresora Zebra). Solo Chromium expone
// navigator.usb, y WebUSB exige un contexto seguro (HTTPS) -este proyecto ya
// sirve todo por HTTPS via NGINX, asi que se cumple en cualquier ambiente
// real (dev/testing/prod).
const ZEBRA_VENDOR_ID = 0x0a5f;

export function isWebUsbSupported(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

// Pide al usuario que elija el dispositivo (gesto del navegador, no se puede
// automatizar) -se llama una vez por sesion de impresion, no se cachea el
// device entre llamadas: si la impresora se desconecta, forzar una nueva
// eleccion es mas simple y confiable que manejar reconexion silenciosa.
export async function printZplViaWebUsb(zpl: string): Promise<void> {
  if (!isWebUsbSupported()) {
    throw new Error("Este navegador no soporta WebUSB. Usa Chrome/Edge, o descarga el archivo .zpl.");
  }

  const device = await navigator.usb.requestDevice({ filters: [{ vendorId: ZEBRA_VENDOR_ID }] });
  await device.open();
  // finally: cualquier fallo (sin interfaz, sin endpoint, transferOut) tambien libera el dispositivo; antes
  // quedaba abierto y la siguiente impresion fallaba hasta desconectar el cable.
  try {
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    const iface = device.configuration?.interfaces[0];
    if (!iface) throw new Error("La impresora no expone ninguna interfaz USB utilizable");
    await device.claimInterface(iface.interfaceNumber);

    const outEndpoint = iface.alternate.endpoints.find((endpoint) => endpoint.direction === "out");
    if (!outEndpoint) throw new Error("La impresora no expone un endpoint de salida");

    const data = new TextEncoder().encode(zpl);
    await device.transferOut(outEndpoint.endpointNumber, data);
  } finally {
    // Un close() que falla (dispositivo desconectado) no debe tapar el error original de la impresion.
    await device.close().catch(() => undefined);
  }
}

export function downloadZplFile(zpl: string, filename: string): void {
  const blob = new Blob([zpl], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
