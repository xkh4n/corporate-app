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
  attachment?: SendMailAttachment;
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
        attachment: request.attachment
          ? {
              filename: request.attachment.filename,
              contentBase64: request.attachment.content.toString("base64"),
              contentType: request.attachment.contentType,
            }
          : undefined,
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
