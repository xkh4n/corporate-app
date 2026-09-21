import nodemailer from "nodemailer";
import { env } from "./env";
import { readSecretFromEnv } from "./secrets";
import { logger } from "./logger";

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SendMailInput {
  to: string[];
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

// Transporte SMTP generico (nodemailer): funciona igual sea cual sea el
// proveedor real (SendGrid, Gmail, Mailgun, SES...), solo cambian host/
// usuario/password -por eso no hubo que esperar a que el usuario decidiera
// el proveedor para construir este servicio. Se crea una sola vez a nivel
// de modulo, no por request.
// pool:true + maxConnections/maxMessages: sin esto, CADA request abria su
// propia conexion SMTP nueva sin tope -una rafaga de requests concurrentes
// (intencional o por un bug de reintento) saturaba las conexiones salientes
// del unico proveedor SMTP configurado (hallazgo de auditoria de seguridad
// 2026-09-17). Los limites son conservadores a proposito: este servicio
// corre con 256M/0.5 cpu en produccion (compose.prod.yml).
const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: false, // STARTTLS en el puerto 587, no TLS implicito (465)
  auth: {
    user: env.smtp.user,
    pass: readSecretFromEnv(env.smtp.passwordFileVar),
  },
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
});

export async function sendMail(input: SendMailInput): Promise<void> {
  await transporter.sendMail({
    from: env.smtp.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    // "attachments" es nativo de nodemailer (array) -antes este codigo solo
    // envolvia un elemento; ahora pasa la lista completa tal cual (ej. OC +
    // cotizacion ganadora, ver purchaseOrder.service.ts en corporate-api).
    attachments: input.attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
    })),
  });
  logger.info(
    { to: input.to, subject: input.subject, attachmentCount: input.attachments?.length ?? 0 },
    "Correo enviado",
  );
}
