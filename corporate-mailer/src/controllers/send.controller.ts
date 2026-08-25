import type { Request, Response } from "express";
import { z } from "zod";
import { sendMail } from "../library/mailer";

const attachmentSchema = z.object({
  filename: z.string().min(1),
  contentBase64: z.string().min(1),
  contentType: z.string().min(1),
});

export const sendMailSchema = z.object({
  to: z.array(z.string().email()).min(1),
  subject: z.string().min(1).max(200),
  text: z.string().min(1),
  // "attachment" (singular) es el shape legado, que corporate-api sigue
  // mandando ademas de "attachments" cuando hay exactamente un adjunto -asi
  // este servicio sigue funcionando aunque el caller no se haya redeployado
  // todavia con la version que solo manda el array (ver mailerClient.ts).
  attachment: attachmentSchema.optional(),
  attachments: z.array(attachmentSchema).max(10).optional(),
});

// Sin try/catch: Express 5 reenvia automaticamente el rechazo de un handler
// async al error middleware (errorHandler.ts, unico lugar donde se loguea
// un fallo de envio -antes se logueaba tambien aca, duplicando el log de
// cada incidente real).
export async function send(req: Request, res: Response): Promise<void> {
  const parsed = sendMailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ codigo: 400, message: "Solicitud invalida", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;

  // "attachments" manda si vino (shape nuevo); si no, cae al legado
  // "attachment" singular envuelto en un array de 1; si no vino ninguno,
  // sin adjuntos.
  const attachments = body.attachments ?? (body.attachment ? [body.attachment] : []);

  await sendMail({
    to: body.to,
    subject: body.subject,
    text: body.text,
    attachments: attachments.map((attachment) => ({
      filename: attachment.filename,
      content: Buffer.from(attachment.contentBase64, "base64"),
      contentType: attachment.contentType,
    })),
  });

  res.status(200).json({ codigo: 200, message: "Correo enviado exitosamente" });
}
