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
  attachment?: MailAttachment;
}

// Transporte SMTP generico (nodemailer): funciona igual sea cual sea el
// proveedor real (SendGrid, Gmail, Mailgun, SES...), solo cambian host/
// usuario/password -por eso no hubo que esperar a que el usuario decidiera
// el proveedor para construir este servicio. Se crea una sola vez a nivel
// de modulo, no por request.
const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: false, // STARTTLS en el puerto 587, no TLS implicito (465)
  auth: {
    user: env.smtp.user,
    pass: readSecretFromEnv(env.smtp.passwordFileVar),
  },
});

export async function sendMail(input: SendMailInput): Promise<void> {
  await transporter.sendMail({
    from: env.smtp.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    attachments: input.attachment
      ? [
          {
            filename: input.attachment.filename,
            content: input.attachment.content,
            contentType: input.attachment.contentType,
          },
        ]
      : undefined,
  });
  logger.info({ to: input.to, subject: input.subject }, "Correo enviado");
}
