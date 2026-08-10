import type { Request, Response } from "express";
import { z } from "zod";
import { sendMail } from "../library/mailer";

export const sendMailSchema = z.object({
  to: z.array(z.string().email()).min(1),
  subject: z.string().min(1).max(200),
  text: z.string().min(1),
  attachment: z
    .object({
      filename: z.string().min(1),
      contentBase64: z.string().min(1),
      contentType: z.string().min(1),
    })
    .optional(),
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

  await sendMail({
    to: body.to,
    subject: body.subject,
    text: body.text,
    attachment: body.attachment
      ? {
          filename: body.attachment.filename,
          content: Buffer.from(body.attachment.contentBase64, "base64"),
          contentType: body.attachment.contentType,
        }
      : undefined,
  });

  res.status(200).json({ codigo: 200, message: "Correo enviado exitosamente" });
}
