import { describe, expect, it } from "vitest";
import { buildAssetReturnCode } from "./assetReturnCode";

describe("buildAssetReturnCode", () => {
  it("arma DEV + centro + aaaammddHHmmssSSS (ejemplo del pedido)", () => {
    // Constructor local: los getters de la funcion tambien son locales.
    expect(buildAssetReturnCode(5802, new Date(2026, 8, 21, 11, 32, 54, 862))).toBe("DEV580220260921113254862");
  });

  it("rellena con ceros mes, dia, hora, minutos, segundos y milisegundos, sin rellenar el centro", () => {
    expect(buildAssetReturnCode(7, new Date(2026, 0, 2, 3, 4, 5, 6))).toBe("DEV720260102030405006");
  });
});
