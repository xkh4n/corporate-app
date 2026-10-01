import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response as ExpressResponse } from "express";
import { Op } from "sequelize";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../api";
import { env } from "../library/env";
import { readSecretFromEnv } from "../library/secrets";
import * as mailerClient from "../library/mailerClient";
import { base32Decode, hotp, totpStep } from "../library/mfa/totp";
import { mssql } from "../databases/mssql/connection";
import { RoleModel } from "../models/postgres/role.model";
import { createPerson } from "../services/mssql/person.service";
import { changePassword, createUser } from "../services/mssql/user.service";
import { resetMfa } from "../services/mssql/mfa.service";
import { createRole } from "../services/postgres/role.service";

// Plan 017: segundo factor de punta a punta contra las bases de Testing. Igual que la prueba del plan
// 015, con tokens Bearer y una sesion de mentira (cada request arranca sin cookie): el login a medio
// camino viaja como mfaToken. El correo se intercepta para leer el codigo. Solo se borran las filas
// que crea este archivo (la base de Testing tiene datos sembrados que referencian users).
const PREFIX = "test-mfa-";
const NEW_PASSWORD = "Segundo.Factor-2026";
let seq = 0;
let server: Server;
let baseUrl: string;
const createdUserIds: number[] = [];
const createdPersonIds: number[] = [];
const mutableMfa = env.mfa as { required: boolean };
const originalRequired = mutableMfa.required;

beforeAll(async () => {
  const fakeSession = (req: Request, _res: ExpressResponse, next: NextFunction) => {
    (req as unknown as { session: object }).session = {
      regenerate: (cb: (err?: unknown) => void) => cb(),
      destroy: (cb: (err?: unknown) => void) => cb(),
    };
    next();
  };
  mutableMfa.required = true;
  const app = await createApp(fakeSession);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  mutableMfa.required = originalRequired;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (createdUserIds.length > 0) {
    const ids = createdUserIds.splice(0).join(",");
    for (const table of ["user_mfa_recovery_codes", "user_webauthn_credentials", "password_history"]) {
      await mssql.query(`DELETE FROM ${table} WHERE user_id IN (${ids})`);
    }
    await mssql.query(`DELETE FROM users WHERE id IN (${ids})`);
  }
  if (createdPersonIds.length > 0) {
    await mssql.query(`DELETE FROM persons WHERE id IN (${createdPersonIds.splice(0).join(",")})`);
  }
  await RoleModel.destroy({ where: { name: { [Op.like]: `${PREFIX}%` } } });
});

async function newUser() {
  const id = ++seq;
  const stamp = Date.now();
  const role = await createRole({ name: `${PREFIX}${id}-${stamp}` });
  const person = await createPerson({
    firstName: "Test",
    lastName: `Mfa${id}`,
    documentId: `TESTDOC-MFA${id}-${stamp % 100000}`,
    email: `test-mfa-${id}-${stamp}@example.com`,
  });
  createdPersonIds.push(person.id);
  const user = await createUser({ personId: person.id, roleId: role.id, username: `testmfa${id}${stamp % 100000}` });
  createdUserIds.push(user.id);
  return user;
}

type Json = { data?: Record<string, unknown>; details?: { reason?: string }; error?: string; message?: string };

async function api(path: string, token: string | null, method = "GET", body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json };
}

const login = (username: string, password: string) =>
  api("/auth/login", null, "POST", { username, password, issueTokens: true });

// Intercepta el correo y devuelve el ultimo codigo enviado.
function captureMail() {
  const sent: string[] = [];
  vi.spyOn(mailerClient, "sendMailViaMailer").mockImplementation(async (request) => {
    sent.push(/\b(\d{6})\b/.exec(request.text)![1]!);
    return { ok: true };
  });
  return () => sent[sent.length - 1]!;
}

const defaultPassword = () => readSecretFromEnv(env.users.defaultPasswordFileVar);
const businessRoute = "/notifications/pending-summary";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Cuenta sin factores y MFA obligatorio: el login pide el codigo al correo antes de dar sesion.
async function loginThroughEmail(username: string, password: string, lastCode: () => string) {
  const pending = await login(username, password);
  expect(pending.json.data).toMatchObject({ next: "EMAIL_VERIFY", methods: ["email"] });
  expect(pending.json.data!.accessToken).toBeUndefined();
  const mfaToken = pending.json.data!.mfaToken as string;
  expect((await api("/auth/mfa/email/send", null, "POST", { mfaToken })).status).toBe(200);
  const verified = await api("/auth/mfa/verify", null, "POST", { method: "email", code: lastCode(), mfaToken });
  expect(verified.status).toBe(200);
  return verified.json.data!;
}

// Cuenta lista con TOTP enrolado: devuelve el secreto y el paso usado al confirmar.
async function enrolledUser() {
  const lastCode = captureMail();
  const user = await newUser();
  await changePassword(user.id, NEW_PASSWORD, { mustChangePassword: false });
  const first = await loginThroughEmail(user.username, NEW_PASSWORD, lastCode);
  const token = first.accessToken as string;
  const start = await api("/auth/mfa/enroll/totp/start", token, "POST");
  const secret = start.json.data!.secret as string;
  const step = totpStep();
  const confirm = await api("/auth/mfa/enroll/totp/confirm", token, "POST", { code: hotp(base32Decode(secret), step) });
  expect(confirm.status).toBe(200);
  return { user, secret, step, recoveryCodes: confirm.json.data!.recoveryCodes as string[] };
}

describe("MFA (plan 017)", () => {
  it("primer ingreso: correo -> cambio de password -> enrolar TOTP -> login con TOTP", async () => {
    const lastCode = captureMail();
    const user = await newUser();

    // 1) Password temporal: no hay sesion ni tokens, solo el login a medio camino.
    const first = await login(user.username, defaultPassword());
    expect(first.status).toBe(200);
    expect(first.json.data).toMatchObject({ next: "EMAIL_VERIFY", methods: ["email"] });
    expect(first.json.data!.accessToken).toBeUndefined();
    const mfaToken = first.json.data!.mfaToken as string;

    expect((await api("/auth/mfa/verify", null, "POST", { method: "totp", code: "123456", mfaToken })).status).toBe(400);
    const sent = await api("/auth/mfa/email/send", null, "POST", { mfaToken });
    expect(sent.status).toBe(200);
    expect(sent.json.data!.sentTo).toMatch(/^t\*{6}\d@example\.com$/);
    // La espera entre envios corta un reenvio inmediato.
    expect((await api("/auth/mfa/email/send", null, "POST", { mfaToken })).status).toBe(429);

    const wrong = await api("/auth/mfa/verify", null, "POST", { method: "email", code: "000000", mfaToken });
    expect(wrong.status).toBe(401);
    expect(wrong.json.details?.reason).toBe("mfa_invalid_code");

    const verified = await api("/auth/mfa/verify", null, "POST", { method: "email", code: lastCode(), mfaToken });
    expect(verified.status).toBe(200);
    expect(verified.json.data!.next).toBe("CHANGE_PASSWORD");
    const tempToken = verified.json.data!.accessToken as string;
    expect((await api(businessRoute, tempToken)).json.details?.reason).toBe("password_change_required");
    // Con la password por cambiar todavia no se enrola.
    expect((await api("/auth/mfa/enroll/totp/start", tempToken, "POST")).status).toBe(403);

    // 2) Cambio de password (plan 015 intacto).
    const changed = await api("/auth/change-password", tempToken, "PATCH", {
      currentPassword: defaultPassword(),
      newPassword: NEW_PASSWORD,
    });
    expect(changed.status).toBe(204);
    await sleep(1100);

    // 3) Sin factores y MFA obligatorio: la password sola no da sesion (ni deja enrolar); despues del
    //    correo, sesion completa pero bloqueada hasta enrolar.
    const second = await loginThroughEmail(user.username, NEW_PASSWORD, lastCode);
    expect(second.next).toBe("MFA_ENROLL");
    const enrollToken = second.accessToken as string;
    const blocked = await api(businessRoute, enrollToken);
    expect(blocked.status).toBe(403);
    expect(blocked.json.details?.reason).toBe("mfa_enrollment_required");
    const me = await api("/auth/me", enrollToken);
    expect((me.json.data!.user as { mfaEnrollmentRequired: boolean }).mfaEnrollmentRequired).toBe(true);

    // Passkeys apagadas en Testing (sin WEBAUTHN_RP_ID): 404.
    expect((await api("/auth/mfa/enroll/webauthn/options", enrollToken, "POST")).status).toBe(404);

    const start = await api("/auth/mfa/enroll/totp/start", enrollToken, "POST");
    expect(start.status).toBe(200);
    const secret = start.json.data!.secret as string;
    expect(start.json.data!.otpauthUri).toContain(`secret=${secret}`);
    expect((await api("/auth/mfa/enroll/totp/confirm", enrollToken, "POST", { code: "000000" })).status).toBe(400);
    const step = totpStep();
    const confirm = await api("/auth/mfa/enroll/totp/confirm", enrollToken, "POST", {
      code: hotp(base32Decode(secret), step),
    });
    expect(confirm.status).toBe(200);
    expect(confirm.json.data!.recoveryCodes).toHaveLength(10);
    // Cliente solo-token: el par nuevo ya no trae la marca de enrolamiento.
    expect((await api(businessRoute, confirm.json.data!.accessToken as string)).status).toBe(200);

    // 4) Login normal: la password sola ya no alcanza.
    const third = await login(user.username, NEW_PASSWORD);
    expect(third.json.data).toMatchObject({ next: "MFA", methods: ["totp", "recovery"] });
    const pending = third.json.data!.mfaToken as string;
    // Anti-replay: el codigo usado al enrolar no sirve de nuevo.
    const replay = await api("/auth/mfa/verify", null, "POST", {
      method: "totp",
      code: hotp(base32Decode(secret), step),
      mfaToken: pending,
    });
    expect(replay.status).toBe(401);
    const ok = await api("/auth/mfa/verify", null, "POST", {
      method: "totp",
      code: hotp(base32Decode(secret), step + 1),
      mfaToken: pending,
    });
    expect(ok.status).toBe(200);
    expect(ok.json.data!.next).toBeNull();
    expect((await api(businessRoute, ok.json.data!.accessToken as string)).status).toBe(200);
    // El login a medio camino se consumio.
    const reused = await api("/auth/mfa/verify", null, "POST", { method: "totp", code: "123456", mfaToken: pending });
    expect(reused.json.details?.reason).toBe("mfa_pending_expired");
  });

  it("codigo de recuperacion de un solo uso; 5 fallos descartan el login a medio camino", async () => {
    const { user, recoveryCodes } = await enrolledUser();

    const a = await login(user.username, NEW_PASSWORD);
    const useCode = await api("/auth/mfa/verify", null, "POST", {
      method: "recovery",
      code: recoveryCodes[0]!.toUpperCase().replace("-", " "),
      mfaToken: a.json.data!.mfaToken,
    });
    expect(useCode.status).toBe(200);

    const b = await login(user.username, NEW_PASSWORD);
    const mfaToken = b.json.data!.mfaToken as string;
    const again = await api("/auth/mfa/verify", null, "POST", { method: "recovery", code: recoveryCodes[0], mfaToken });
    expect(again.status).toBe(401);

    for (let i = 0; i < 4; i++) {
      const wrong = await api("/auth/mfa/verify", null, "POST", { method: "totp", code: "000000", mfaToken });
      expect(wrong.json.details?.reason).toBe("mfa_invalid_code");
    }
    const sixth = await api("/auth/mfa/verify", null, "POST", { method: "totp", code: "000000", mfaToken });
    expect(sixth.json.details?.reason).toBe("mfa_attempts_exceeded");
    // Ni con un codigo bueno: hay que volver a poner la password.
    const after = await api("/auth/mfa/verify", null, "POST", { method: "recovery", code: recoveryCodes[1], mfaToken });
    expect(after.json.details?.reason).toBe("mfa_pending_expired");
  });

  it("no se puede quitar el ultimo factor; el reset administrativo vuelve a exigir enrolamiento", async () => {
    const { user, secret, step } = await enrolledUser();
    const pending = await login(user.username, NEW_PASSWORD);
    const done = await api("/auth/mfa/verify", null, "POST", {
      method: "totp",
      code: hotp(base32Decode(secret), step + 1),
      mfaToken: pending.json.data!.mfaToken,
    });
    const token = done.json.data!.accessToken as string;

    const factors = await api("/auth/mfa/factors", token);
    expect(factors.json.data).toMatchObject({ totp: true, email: false, recoveryCodesRemaining: 10, webauthnEnabled: false });
    // Recien verificado: hay step-up, pero sigue siendo el unico factor.
    expect((await api("/auth/mfa/totp", token, "DELETE")).status).toBe(409);
    // Codigos de recuperacion nuevos invalidan los anteriores.
    const regenerated = await api("/auth/mfa/recovery-codes", token, "POST");
    expect(regenerated.json.data!.recoveryCodes).toHaveLength(10);

    await resetMfa(user.id);
    // Sin factores la password sola no alcanza para enrolar otro: primero el correo de la persona.
    const relogin = await login(user.username, NEW_PASSWORD);
    expect(relogin.json.data!.next).toBe("EMAIL_VERIFY");
  });

  it("los fallos se acumulan por cuenta aunque se abran logins nuevos", async () => {
    const { user } = await enrolledUser();
    let locked = false;
    for (let round = 0; round < 3 && !locked; round++) {
      const pending = await login(user.username, NEW_PASSWORD);
      if (pending.status === 429) {
        locked = true;
        break;
      }
      const mfaToken = pending.json.data!.mfaToken as string;
      for (let i = 0; i < 5; i++) {
        const res = await api("/auth/mfa/verify", null, "POST", { method: "totp", code: "000000", mfaToken });
        if (res.status === 429) {
          expect(res.json.details?.reason).toBe("mfa_locked");
          locked = true;
          break;
        }
      }
    }
    expect(locked).toBe(true);
    // Bloqueada: ni siquiera abre otro login a medio camino.
    const again = await login(user.username, NEW_PASSWORD);
    expect(again.status).toBe(429);
    expect(again.json.details?.reason).toBe("mfa_locked");
  });

  it("con el enrolamiento pendiente, un step-up por correo renueva la verificacion vencida", async () => {
    const lastCode = captureMail();
    const user = await newUser();
    await changePassword(user.id, NEW_PASSWORD, { mustChangePassword: false });
    const first = await loginThroughEmail(user.username, NEW_PASSWORD, lastCode);
    expect(first.next).toBe("MFA_ENROLL");
    // Un token renovado no hereda la verificacion del login: enrolar pide step-up.
    const refreshed = await api("/auth/refresh", null, "POST", { refreshToken: first.refreshToken });
    const token = refreshed.json.data!.accessToken as string;
    const denied = await api("/auth/mfa/enroll/totp/start", token, "POST");
    expect(denied.json.details?.reason).toBe("mfa_step_up_required");

    // Solo el correo sirve con el enrolamiento pendiente.
    expect((await api("/auth/mfa/step-up", token, "POST", { method: "totp", code: "123456" })).status).toBe(400);
    expect((await api("/auth/mfa/step-up/email/send", token, "POST")).status).toBe(200);
    expect((await api("/auth/mfa/step-up", token, "POST", { method: "email", code: lastCode() })).status).toBe(204);

    const start = await api("/auth/mfa/enroll/totp/start", token, "POST");
    expect(start.status).toBe(200);
    const secret = start.json.data!.secret as string;
    const confirm = await api("/auth/mfa/enroll/totp/confirm", token, "POST", {
      code: hotp(base32Decode(secret), totpStep()),
    });
    expect(confirm.status).toBe(200);
    expect(confirm.json.data!.recoveryCodes).toHaveLength(10);
  });

  it("el step-up es de la sesion: un token renovado no hereda el del login", async () => {
    const { user, secret, step } = await enrolledUser();
    const pending = await login(user.username, NEW_PASSWORD);
    const done = await api("/auth/mfa/verify", null, "POST", {
      method: "totp",
      code: hotp(base32Decode(secret), step + 1),
      mfaToken: pending.json.data!.mfaToken,
    });
    const loginToken = done.json.data!.accessToken as string;
    const refreshed = await api("/auth/refresh", null, "POST", { refreshToken: done.json.data!.refreshToken });
    const otherToken = refreshed.json.data!.accessToken as string;
    expect(otherToken).not.toBe(loginToken);

    expect((await api("/auth/mfa/factors", otherToken)).json.data!.stepUpActive).toBe(false);
    const denied = await api("/auth/mfa/recovery-codes", otherToken, "POST");
    expect(denied.status).toBe(403);
    expect(denied.json.details?.reason).toBe("mfa_step_up_required");
    expect((await api("/auth/mfa/enroll/email/send", otherToken, "POST")).status).toBe(403);

    expect((await api("/auth/mfa/factors", loginToken)).json.data!.stepUpActive).toBe(true);
    expect((await api("/auth/mfa/recovery-codes", loginToken, "POST")).status).toBe(200);
  });

  it("sin login a medio camino no hay verificacion", async () => {
    const res = await api("/auth/mfa/verify", null, "POST", { method: "totp", code: "123456" });
    expect(res.status).toBe(401);
    expect(res.json.details?.reason).toBe("mfa_pending_missing");
  });
});
