import { sendMailViaMailer } from "../mailerClient";

export { generateEmailCode, maskEmail } from "./emailCode";

const PURPOSE_TEXT = {
  login: "iniciar sesión",
  "verify-email": "confirmar su correo antes de continuar",
  enroll: "activar el código por correo como segundo factor",
  "step-up": "confirmar un cambio en la seguridad de su cuenta",
} as const;

export type EmailCodePurpose = keyof typeof PURPOSE_TEXT;

// El codigo nunca se loguea: sendMailViaMailer solo registra el estado HTTP del mailer.
export async function sendMfaCodeEmail(to: string, code: string, purpose: EmailCodePurpose): Promise<boolean> {
  const result = await sendMailViaMailer({
    to: [to],
    // Sin el codigo en el asunto: se veria en la pantalla bloqueada del telefono.
    subject: "Código de verificación",
    text:
      `Su código para ${PURPOSE_TEXT[purpose]} es:\n\n    ${code}\n\n` +
      "Vence en 5 minutos y sirve una sola vez.\n\n" +
      "Si usted no lo pidió, alguien conoce su contraseña: cámbiela y avise a la Mesa de Servicios." +
      "\n\n--\nMensaje automático. No responda este correo.",
  });
  return result.ok;
}

// Aviso al dueño cuando su cuenta se bloquea por fallos de segundo factor: para llegar a ese punto
// hay que conocer su password.
export async function sendMfaLockedEmail(to: string): Promise<boolean> {
  const result = await sendMailViaMailer({
    to: [to],
    subject: "Alerta de seguridad: intentos fallidos en su cuenta",
    text:
      "Se bloqueo temporalmente el segundo factor de su cuenta por varios codigos incorrectos.\n\n" +
      "Para llegar a ese paso hace falta su contraseña. Si no fue usted, cambiela de inmediato y avise " +
      "a la Mesa de Servicios.\n\n--\nMensaje automático. No responda este correo.",
  });
  return result.ok;
}
