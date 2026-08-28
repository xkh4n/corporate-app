import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { ConflictError, NotFoundError } from "../../library/errors";
import {
  createCostCenter,
  getCostCenterByCode,
  getCostCenterByIdOrThrow,
  listCostCenters,
} from "./costCenter.service";

// Plantilla de test de integracion (Fase 0): costCenter.service es el
// servicio Postgres mas simple del proyecto -CRUD llano, un solo UNIQUE
// (code), sin joins/asociaciones-, sirve de referencia para el resto de las
// fases al escribir sus propios *.service.integration.test.ts.
describe("costCenter.service (integracion, Postgres real)", () => {
  // beforeEach ademas de afterEach: si un test anterior fallo antes de
  // llegar a su propio afterEach (ej. una asercion que lanza a mitad del
  // test), el siguiente test igual arranca sobre una tabla limpia en vez de
  // heredar filas huerfanas.
  beforeEach(async () => {
    await resetTestData({ postgres: ["cost_centers"] });
  });

  afterEach(async () => {
    await resetTestData({ postgres: ["cost_centers"] });
  });

  describe("createCostCenter", () => {
    it("crea un centro de costo y lo deja disponible por id y por code", async () => {
      const created = await createCostCenter({ code: 9001, name: "Centro de prueba" });

      expect(created.id).toBeGreaterThan(0);
      expect(created.code).toBe(9001);
      expect(created.name).toBe("Centro de prueba");

      const byId = await getCostCenterByIdOrThrow(created.id);
      expect(byId.code).toBe(9001);

      const byCode = await getCostCenterByCode(9001);
      expect(byCode?.id).toBe(created.id);
    });

    it("rechaza un code duplicado con ConflictError", async () => {
      await createCostCenter({ code: 9002, name: "Primero" });

      await expect(createCostCenter({ code: 9002, name: "Segundo" })).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("listCostCenters", () => {
    it("lista solo lo creado en este test (la tabla queda limpia entre tests)", async () => {
      await createCostCenter({ code: 9003, name: "Uno" });
      await createCostCenter({ code: 9004, name: "Dos" });

      const { items, total } = await listCostCenters({ page: 1, limit: 10, sortBy: "code", sortOrder: "asc" });

      expect(total).toBe(2);
      expect(items.map((item) => item.code).sort()).toEqual([9003, 9004]);
    });
  });

  describe("getCostCenterByIdOrThrow", () => {
    it("lanza NotFoundError si el id no existe", async () => {
      await expect(getCostCenterByIdOrThrow(999_999)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
