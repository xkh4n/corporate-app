import { env } from "./env";
import { readSecretFromEnv } from "./secrets";
import { logger } from "./logger";

const MAILER_TIMEOUT_MS = 5000;

export interface SendMailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SendMailRequest {
  to: string[];
  subject: string;
  text: string;
  // Mutuamente excluyentes: un caller manda UNO de los dos segun tenga un
  // adjunto o varios (ej. sendQuoteRequestEmail sigue usando "attachment",
  // sendPurchaseOrderToSupplier usa "attachments" con la OC + la cotizacion
  // ganadora, ver purchaseOrder.service.ts).
  attachment?: SendMailAttachment;
  attachments?: SendMailAttachment[];
}

export interface SendMailResult {
  ok: boolean;
  error?: string;
}

// Cliente hacia corporate-mailer (unico contenedor con salida a internet):
// timeout corto + try/catch, y NUNCA lanza -devuelve {ok:false, error} en
// vez de una excepcion, para que un fallo de red/SMTP no pueda tumbar el
// proceso de corporate-api sin que el caller tenga que acordarse de su
// propio try/catch. Ver library/pdf/quoteRequestPdf.ts para el mismo
// criterio "best-effort, nunca revierte la operacion principal".
export async function sendMailViaMailer(request: SendMailRequest): Promise<SendMailResult> {
  if (!env.mailer.url) {
    logger.error("MAILER_URL no configurado, no se puede enviar correo");
    return { ok: false, error: "MAILER_URL no configurado" };
  }

  try {
    const sharedSecret = readSecretFromEnv(env.mailer.sharedSecretFileVar);

    const attachmentList = request.attachments ?? (request.attachment ? [request.attachment] : []);
    const toWire = (attachment: SendMailAttachment) => ({
      filename: attachment.filename,
      contentBase64: attachment.content.toString("base64"),
      contentType: attachment.contentType,
    });

    const response = await fetch(env.mailer.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mailer-Token": sharedSecret,
      },
      body: JSON.stringify({
        to: request.to,
        subject: request.subject,
        text: request.text,
        // Forma dual a proposito: manda "attachments" (array) SIEMPRE que
        // haya adjuntos, y ademas el campo legado "attachment" (singular)
        // cuando hay exactamente uno -asi un corporate-mailer todavia no
        // redeployado (que solo entiende "attachment") sigue funcionando
        // para el caso de un solo adjunto, degradandose en vez de romperse
        // cuando hay mas de uno (ver corporate-mailer/src/controllers/send.controller.ts).
        attachment: attachmentList.length === 1 ? toWire(attachmentList[0]!) : undefined,
        attachments: attachmentList.length > 0 ? attachmentList.map(toWire) : undefined,
      }),
      signal: AbortSignal.timeout(MAILER_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error({ status: response.status, body }, "corporate-mailer respondio con error");
      return { ok: false, error: `corporate-mailer respondio ${response.status}` };
    }

    return { ok: true };
  } catch (err) {
    logger.error({ err }, "No se pudo contactar a corporate-mailer");
    return { ok: false, error: "No se pudo contactar al servicio de correo" };
  }
}
