import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetTestData } from "../../../test/setupIntegration";
import { createProduct } from "../mongo/product.service";
import { createAssetsFromReceipt, listAssets } from "./asset.service";

let seq = 0;

const RESET_TABLES = {
  postgres: ["assets"],
  mongo: ["Product"],
};

beforeEach(async () => {
  await resetTestData(RESET_TABLES);
});

afterEach(async () => {
  await resetTestData(RESET_TABLES);
});

async function createFixtureProduct() {
  return createProduct({ name: `Producto de prueba Asset${++seq}`, productType: "COMPRA" });
}

// Prueba de aceptacion central de la decision B del plan: un Asset POR
// UNIDAD recibida, no un Asset con campo cantidad.
describe("asset.service (integracion, Postgres real)", () => {
  describe("createAssetsFromReceipt", () => {
    it("crea 5 filas con tags distintos y consecutivos, todas en AVAILABLE cuando finalStatusCode viene", async () => {
      const product = await createFixtureProduct();

      const assets = await createAssetsFromReceipt({
        goodsReceiptId: 999_001,
        productId: String(product._id),
        quantity: 5,
        serialNumbers: ["SN-1", null, "SN-3", null, "SN-5"],
        finalStatusCode: "AVAILABLE",
      });

      expect(assets).toHaveLength(5);
      expect(new Set(assets.map((asset) => asset.tag)).size).toBe(5);
      expect(assets.every((asset) => asset.tag.startsWith("ACT"))).toBe(true);
      expect(assets.every((asset) => asset.status?.code === "AVAILABLE")).toBe(true);
      expect(assets.every((asset) => asset.goodsReceiptId === 999_001)).toBe(true);

      const numbers = assets.map((asset) => Number(asset.tag.slice(3))).sort((a, b) => a - b);
      for (let i = 1; i < numbers.length; i++) {
        expect(numbers[i]).toBe((numbers[i - 1] ?? 0) + 1);
      }

      expect(assets.map((asset) => asset.serialNumber).sort()).toEqual([null, null, "SN-1", "SN-3", "SN-5"].sort());
    });

    it("quantity:1 sigue funcionando igual que antes (regresion) -nace RECEIVED sin finalStatusCode", async () => {
      const product = await createFixtureProduct();

      const assets = await createAssetsFromReceipt({
        goodsReceiptId: 999_002,
        productId: String(product._id),
        quantity: 1,
      });

      expect(assets).toHaveLength(1);
      expect(assets[0]?.status?.code).toBe("RECEIVED");
    });

    it("cada asset queda encontrable via listAssets filtrando por goodsReceiptId", async () => {
      const product = await createFixtureProduct();
      await createAssetsFromReceipt({
        goodsReceiptId: 999_003,
        productId: String(product._id),
        quantity: 3,
        finalStatusCode: "AVAILABLE",
      });

      const { items, total } = await listAssets(
        { page: 1, limit: 10, sortBy: "id", sortOrder: "asc" },
        999_003,
      );

      expect(total).toBe(3);
      expect(items.every((asset) => asset.goodsReceiptId === 999_003)).toBe(true);
    });
  });
});
