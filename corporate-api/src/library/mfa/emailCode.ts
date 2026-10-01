import { randomInt } from "node:crypto";

export function generateEmailCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

// "osvaldo@empresa.cl" -> "o*****o@empresa.cl": la pantalla confirma a que buzon se mando sin
// mostrar la direccion completa a quien todavia no termino de autenticarse.
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (local.length <= 2) return `${local[0] ?? ""}*@${domain}`;
  return `${local[0]}${"*".repeat(Math.min(local.length - 2, 6))}${local[local.length - 1]}@${domain}`;
}
