// Declaracion minima de WebUSB: alcanza lo que usa lib/zplPrinting.ts, no
// pretende ser el spec completo. Evita agregar una dependencia npm nueva
// (@types/w3c-web-usb) solo para esto -eso hubiera exigido un rebuild
// Docker por el volumen anonimo de node_modules (ver
// feedback_docker_anon_volume_masks_new_deps).
interface USBEndpoint {
  endpointNumber: number;
  direction: "in" | "out";
}

interface USBAlternateInterface {
  endpoints: USBEndpoint[];
}

interface USBInterface {
  interfaceNumber: number;
  alternate: USBAlternateInterface;
}

interface USBConfiguration {
  interfaces: USBInterface[];
}

interface USBOutTransferResult {
  bytesWritten: number;
  status: "ok" | "stall" | "babble";
}

interface USBDevice {
  configuration: USBConfiguration | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>;
}

interface USBDeviceRequestOptions {
  filters: { vendorId?: number; productId?: number }[];
}

interface USB {
  requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice>;
}

interface Navigator {
  readonly usb: USB;
}
