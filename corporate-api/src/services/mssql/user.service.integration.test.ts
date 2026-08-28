import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { getRoleByName } from "../postgres/role.service";
import { createPerson } from "./person.service";
import { createUser, getUserByPersonId, listAssignableUsers } from "./user.service";

let seq = 0;

const RESET_TABLES = {
  mssql: ["users", "persons"],
};

beforeEach(async () => {
  await resetTestData(RESET_TABLES);
});

afterEach(async () => {
  await resetTestData(RESET_TABLES);
});

async function createFixturePerson(overrides: Partial<{ firstName: string; lastName: string; documentId: string }> = {}) {
  const id = ++seq;
  return createPerson({
    firstName: overrides.firstName ?? "Test",
    lastName: overrides.lastName ?? `PersonaUser${id}`,
    documentId: overrides.documentId ?? `TESTDOC-USR${id}`,
    email: `test-user-persona-${id}@example.com`,
  });
}

async function createFixtureUser(overrides: Partial<{ firstName: string; lastName: string; documentId: string }> = {}) {
  const userRole = await getRoleByName("user");
  if (!userRole) throw new Error('Falta el rol "user" sembrado -revisar migratePostgres()');
  const person = await createFixturePerson(overrides);
  const user = await createUser({ personId: person.id, roleId: userRole.id, username: `testusr${++seq}` });
  return { user, person };
}

describe("user.service (integracion, MSSQL real)", () => {
  describe("listAssignableUsers", () => {
    it("filtra por documentId (match parcial)", async () => {
      const { person } = await createFixtureUser({ documentId: "11222333-4" });

      const found = await listAssignableUsers("11222333-4");

      expect(found.some((item) => item.personId === person.id)).toBe(true);
    });

    it("filtra por nombre o apellido (match parcial)", async () => {
      const { person } = await createFixtureUser({ firstName: "Rodrigo", lastName: "Salinas" });

      const byFirstName = await listAssignableUsers("Rodrigo");
      const byLastName = await listAssignableUsers("Salinas");

      expect(byFirstName.some((item) => item.personId === person.id)).toBe(true);
      expect(byLastName.some((item) => item.personId === person.id)).toBe(true);
    });

    it("no devuelve nada si el termino de busqueda esta vacio", async () => {
      await createFixtureUser();
      expect(await listAssignableUsers("")).toEqual([]);
      expect(await listAssignableUsers("   ")).toEqual([]);
    });

    it("no encuentra un RUT que no existe", async () => {
      await createFixtureUser({ documentId: "99888777-6" });
      expect(await listAssignableUsers("00000000-0")).toEqual([]);
    });
  });

  describe("getUserByPersonId", () => {
    it("retorna null cuando la persona no tiene cuenta", async () => {
      const person = await createFixturePerson();
      expect(await getUserByPersonId(person.id)).toBeNull();
    });

    it("retorna el usuario cuando la persona si tiene cuenta", async () => {
      const { user, person } = await createFixtureUser();
      const found = await getUserByPersonId(person.id);
      expect(found?.id).toBe(user.id);
    });
  });
});
