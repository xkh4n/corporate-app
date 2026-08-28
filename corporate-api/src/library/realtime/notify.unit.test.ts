import { describe, expect, it, vi } from "vitest";
import {
  notifyPendingPurchaseOrder,
  notifyPendingQuoteApproval,
  notifyPendingRequestApproval,
  notifyUser,
} from "./notify";
import { getIo } from "./socketServer";

// Mockeado en el nivel de modulo (hoisted por Vitest antes de los imports de
// arriba): evita que este test toque Redis/Socket.IO reales -notify.ts es
// best-effort por contrato (mismo criterio que sendMailViaMailer en
// library/mailerClient.ts), esta suite prueba exactamente ese contrato.
vi.mock("./socketServer", () => ({ getIo: vi.fn() }));

const request = { id: 7, requestNumber: "SOL0000000007" };

describe("notifyUser", () => {
  it("no lanza cuando getIo() devuelve null -socket server todavia no arranco", () => {
    vi.mocked(getIo).mockReturnValue(null);
    expect(() =>
      notifyUser(1, { reason: "purchase-request-pending-approval", requestId: 1, requestNumber: "X", at: "" }),
    ).not.toThrow();
  });

  it("emite io.to(`user:<id>`).emit('notifications:invalidate', payload) cuando el socket server esta arriba", () => {
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    vi.mocked(getIo).mockReturnValue({ to } as never);

    const payload = { reason: "quote-pending-approval" as const, requestId: 7, requestNumber: "SOL0000000007", at: "2026-01-01T00:00:00.000Z" };
    notifyUser(42, payload);

    expect(to).toHaveBeenCalledWith("user:42");
    expect(emit).toHaveBeenCalledWith("notifications:invalidate", payload);
  });

  it("no lanza aunque io.to(...) tire una excepcion", () => {
    vi.mocked(getIo).mockReturnValue({
      to: () => {
        throw new Error("boom");
      },
    } as never);
    expect(() =>
      notifyUser(1, { reason: "purchase-order-pending", requestId: 1, requestNumber: "X", at: "" }),
    ).not.toThrow();
  });
});

describe("wrappers semanticos", () => {
  it("cada wrapper arma el reason correcto con requestId/requestNumber de la solicitud", () => {
    const emit = vi.fn();
    vi.mocked(getIo).mockReturnValue({ to: () => ({ emit }) } as never);

    notifyPendingRequestApproval(10, request);
    notifyPendingQuoteApproval(11, request);
    notifyPendingPurchaseOrder(12, request);

    expect(emit).toHaveBeenNthCalledWith(
      1,
      "notifications:invalidate",
      expect.objectContaining({ reason: "purchase-request-pending-approval", requestId: 7, requestNumber: "SOL0000000007" }),
    );
    expect(emit).toHaveBeenNthCalledWith(
      2,
      "notifications:invalidate",
      expect.objectContaining({ reason: "quote-pending-approval", requestId: 7 }),
    );
    expect(emit).toHaveBeenNthCalledWith(
      3,
      "notifications:invalidate",
      expect.objectContaining({ reason: "purchase-order-pending", requestId: 7 }),
    );
  });
});
