import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, Response as ExpressResponse } from "express";
import { Op } from "sequelize";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../api";
import { resetTestData } from "../../test/setupIntegration";
import { env } from "../library/env";
import { readSecretFromEnv } from "../library/secrets";
import { RoleModel } from "../models/postgres/role.model";
import { createPerson } from "../services/mssql/person.service";
import { UserModel } from "../models/mssql/user.model";
import { createUser } from "../services/mssql/user.service";
import { createRole } from "../services/postgres/role.service";

// Plan 015: la API no acepta la password por defecto. Con la marca de cambio obligatorio solo pasan
// /auth/me, /auth/menu y /auth/change-password. Login real con issueTokens (tokens Bearer); la sesion
// es un doble minimo, cada request arranca sin usuario.
const PREFIX = "test-pcr-";
const NEW_PASSWORD = "Cambio.Obligatorio-2026";
let seq = 0;
let server: Server;
let baseUrl: string;

const RESET_TABLES = { mssql: ["password_history", "users", "persons"] };

beforeAll(async () => {
  const fakeSession = (req: Request, _res: ExpressResponse, next: NextFunction) => {
    (req as unknown as { session: object }).session = {
      regenerate: (cb: (err?: unknown) => void) => cb(),
      destroy: (cb: (err?: unknown) => void) => cb(),
    };
    next();
  };
  const app = await createApp(fakeSession);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  await resetTestData(RESET_TABLES);
});

afterEach(async () => {
  await resetTestData(RESET_TABLES);
  await RoleModel.destroy({ where: { name: { [Op.like]: `${PREFIX}%` } } });
});

async function newUser() {
  const id = ++seq;
  const role = await createRole({ name: `${PREFIX}${id}-${Date.now()}` });
  const person = await createPerson({
    firstName: "Test",
    lastName: `Pcr${id}`,
    documentId: `TESTDOC-PCR${id}`,
    email: `test-pcr-${id}-${Date.now()}@example.com`,
  });
  return createUser({ personId: person.id, roleId: role.id, username: `testpcr${id}${Date.now() % 100000}` });
}

async function api(path: string, token: string | null, method = "GET", body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function login(username: string, password: string): Promise<string> {
  const res = await api("/auth/login", null, "POST", { username, password, issueTokens: true });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { accessToken: string } };
  return body.data.accessToken;
}

const defaultPassword = () => readSecretFromEnv(env.users.defaultPasswordFileVar);

describe("contraseña por defecto (plan 015)", () => {
  it("con la password por defecto solo se puede ver la sesion y cambiarla; despues hay acceso normal", async () => {
    const user = await newUser();
    const token = await login(user.username, defaultPassword());

    const blocked = await api("/notifications/pending-summary", token);
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { details: { reason: string } }).details.reason).toBe("password_change_required");

    expect((await api("/auth/me", token)).status).toBe(200);
    expect((await api("/auth/menu", token)).status).toBe(200);

    const sameAsDefault = await api("/auth/change-password", token, "PATCH", {
      currentPassword: defaultPassword(),
      newPassword: defaultPassword(),
    });
    expect(sameAsDefault.status).toBe(400);

    const changed = await api("/auth/change-password", token, "PATCH", {
      currentPassword: defaultPassword(),
      newPassword: NEW_PASSWORD,
    });
    expect(changed.status).toBe(204);

    // El cambio invalida las sesiones con granularidad de 1 s (ver authenticate.ts).
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const fresh = await login(user.username, NEW_PASSWORD);
    expect((await api("/notifications/pending-summary", fresh)).status).toBe(200);
  });

  it("la password por defecto bloquea aunque la cuenta no tenga el cambio obligatorio marcado", async () => {
    const user = await newUser();
    // Cuenta que sigue con la password por defecto pero sin el flag (p. ej. anterior a este chequeo).
    await UserModel.update({ mustChangePassword: false }, { where: { id: user.id } });

    const token = await login(user.username, defaultPassword());
    expect((await api("/notifications/pending-summary", token)).status).toBe(403);
    const me = (await (await api("/auth/me", token)).json()) as { data: { user: { mustChangePassword: boolean } } };
    // /auth/me via Bearer solo lee el flag de la BD; el bloqueo lo hace la marca del token.
    expect(me.data.user.mustChangePassword).toBe(false);
  });
});
