import { describe, expect, it } from "vitest";
import { costCenterCodeOfRole, isSystemsRole } from "./roleCostCenter";

describe("roleCostCenter", () => {
  it("toma el centro de costo del prefijo del rol", () => {
    expect(costCenterCodeOfRole("1110-analista-adquisiciones")).toBe("1110");
    expect(costCenterCodeOfRole("5802-gerente-tienda")).toBe("5802");
    expect(costCenterCodeOfRole("admin")).toBeNull();
    expect(costCenterCodeOfRole(undefined)).toBeNull();
  });

  it("solo los roles 1110 son de Sistemas", () => {
    expect(isSystemsRole("1110-tecnico-soporte")).toBe(true);
    expect(isSystemsRole("11100-otro")).toBe(false);
    expect(isSystemsRole("5802-vendedor-tienda")).toBe(false);
    expect(isSystemsRole("user")).toBe(false);
    expect(isSystemsRole("x1110-falso")).toBe(false);
    expect(isSystemsRole("01110-ceros")).toBe(false);
  });
});
