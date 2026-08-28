import { afterEach, describe, expect, it, vi } from "vitest";

// Mockeados en el nivel de modulo (hoisted por Vitest antes de los imports de
// abajo): env.ts exige variables de entorno de las 4 bases de datos y
// secrets.ts lee un archivo real -ninguno de los dos hace falta para probar
// la normalizacion attachment/attachments, y mockearlos mantiene este archivo
// corriendo "en cualquier lado" (contrato de *.unit.test.ts, ver TESTING.md).
vi.mock("./env", () => ({
  env: { mailer: { url: "http://mailer.local/send", sharedSecretFileVar: "FAKE_SECRET_FILE" } },
}));
vi.mock("./secrets", () => ({ readSecretFromEnv: () => "fake-shared-secret" }));
vi.mock("./logger", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

import { sendMailViaMailer } from "./mailerClient";

function parseLastRequestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("sendMailViaMailer (normalizacion del shape dual attachment/attachments)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("con UN adjunto: manda tanto 'attachment' (legado) como 'attachments' (array de 1)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    await sendMailViaMailer({
      to: ["a@example.com"],
      subject: "Asunto",
      text: "Cuerpo",
      attachment: { filename: "a.pdf", content: Buffer.from("hola"), contentType: "application/pdf" },
    });

    const body = parseLastRequestBody(fetchMock);
    const expectedWire = { filename: "a.pdf", contentBase64: Buffer.from("hola").toString("base64"), contentType: "application/pdf" };
    expect(body.attachment).toEqual(expectedWire);
    expect(body.attachments).toEqual([expectedWire]);
  });

  it("con 2+ adjuntos (via 'attachments'): manda SOLO 'attachments', sin 'attachment'", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    await sendMailViaMailer({
      to: ["a@example.com"],
      subject: "Asunto",
      text: "Cuerpo",
      attachments: [
        { filename: "oc.pdf", content: Buffer.from("oc"), contentType: "application/pdf" },
        { filename: "cot.pdf", content: Buffer.from("cot"), contentType: "application/pdf" },
      ],
    });

    const body = parseLastRequestBody(fetchMock);
    expect(body.attachment).toBeUndefined();
    expect(body.attachments).toHaveLength(2);
    expect((body.attachments as Array<{ filename: string }>).map((a) => a.filename)).toEqual(["oc.pdf", "cot.pdf"]);
  });

  it("sin adjuntos: ni 'attachment' ni 'attachments' van en el body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    await sendMailViaMailer({ to: ["a@example.com"], subject: "Asunto", text: "Cuerpo" });

    const body = parseLastRequestBody(fetchMock);
    expect(body.attachment).toBeUndefined();
    expect(body.attachments).toBeUndefined();
  });

  it("nunca lanza: devuelve {ok:false} si fetch rechaza (mailer inalcanzable)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await sendMailViaMailer({ to: ["a@example.com"], subject: "x", text: "y" });
    expect(result.ok).toBe(false);
  });

  it("nunca lanza: devuelve {ok:false} si el mailer responde con status de error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => "bad gateway" }));
    const result = await sendMailViaMailer({ to: ["a@example.com"], subject: "x", text: "y" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("502");
  });
});
