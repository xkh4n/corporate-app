import { describe, expect, it } from "vitest";
import { classifyEquipment, handoverFieldApplies } from "./equipmentKind";

describe("classifyEquipment", () => {
  it("reconoce las categorias por nombre, sin importar mayusculas ni tildes", () => {
    expect(classifyEquipment("NOTEBOOKS")).toBe("NOTEBOOK");
    expect(classifyEquipment("Notebook")).toBe("NOTEBOOK");
    expect(classifyEquipment("DESKTOPS")).toBe("DESKTOP");
    expect(classifyEquipment("Monitores")).toBe("MONITOR");
    expect(classifyEquipment("Equipos de escritorio")).toBe("DESKTOP");
  });

  it("cualquier otra categoria o ninguna es OTHER", () => {
    expect(classifyEquipment("SMARTPHONE")).toBe("OTHER");
    expect(classifyEquipment("IMPRESORAS LASER")).toBe("OTHER");
    expect(classifyEquipment(null)).toBe("OTHER");
  });
});

describe("handoverFieldApplies", () => {
  it("bolso y candado solo en notebook", () => {
    expect(handoverFieldApplies("NOTEBOOK", "bag")).toBe(true);
    expect(handoverFieldApplies("DESKTOP", "bag")).toBe(false);
    expect(handoverFieldApplies("MONITOR", "lock")).toBe(false);
  });

  it("cargador en notebook o monitor", () => {
    expect(handoverFieldApplies("NOTEBOOK", "charger")).toBe(true);
    expect(handoverFieldApplies("MONITOR", "charger")).toBe(true);
    expect(handoverFieldApplies("DESKTOP", "charger")).toBe(false);
    expect(handoverFieldApplies("OTHER", "charger")).toBe(false);
  });

  it("MAC en notebook o desktop", () => {
    expect(handoverFieldApplies("NOTEBOOK", "mac")).toBe(true);
    expect(handoverFieldApplies("DESKTOP", "mac")).toBe(true);
    expect(handoverFieldApplies("MONITOR", "mac")).toBe(false);
  });
});
