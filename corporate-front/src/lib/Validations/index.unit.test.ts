import { describe, expect, it } from "vitest";
import { IsBoolean, IsDecimal, IsEmail, IsId, IsName, IsParagraph, IsPhone, IsRut, IsUsername } from "./index";

describe("IsRut", () => {
  it("acepta un RUT chileno valido", () => {
    expect(IsRut("12345678-5")).toBe(true);
  });

  it("rechaza un valor no-string o un RUT invalido", () => {
    expect(IsRut(12345678 as unknown as string)).toBe(false);
    expect(IsRut("no-es-un-rut")).toBe(false);
  });
});

describe("IsUsername", () => {
  it("acepta minusculas de hasta 20 caracteres", () => {
    expect(IsUsername("jperez")).toBe(true);
  });

  it("rechaza mayusculas, numeros o mas de 20 caracteres", () => {
    expect(IsUsername("JPerez")).toBe(false);
    expect(IsUsername("jperez1")).toBe(false);
    expect(IsUsername("a".repeat(21))).toBe(false);
  });
});

describe("IsEmail", () => {
  it("acepta un email valido", () => {
    expect(IsEmail("persona@dominio.com")).toBe(true);
  });

  it("rechaza formatos invalidos", () => {
    expect(IsEmail("no-es-un-email")).toBe(false);
    expect(IsEmail("@dominio.com")).toBe(false);
  });
});

describe("IsParagraph", () => {
  it("acepta texto libre con puntuacion/tildes", () => {
    expect(IsParagraph("Descripcion valida, con tildes: ñ, y numeros 123.")).toBe(true);
  });

  it("rechaza un valor no-string", () => {
    expect(IsParagraph(123 as unknown as string)).toBe(false);
  });
});

describe("IsDecimal", () => {
  it("acepta enteros y decimales con punto o coma", () => {
    expect(IsDecimal("10")).toBe(true);
    expect(IsDecimal("10.5")).toBe(true);
    expect(IsDecimal("-3,25")).toBe(true);
  });

  it("rechaza texto no numerico", () => {
    expect(IsDecimal("abc")).toBe(false);
  });
});

describe("IsPhone", () => {
  it("acepta un telefono chileno con codigo de pais", () => {
    expect(IsPhone("+56 9 1234 5678")).toBe(true);
  });

  it("rechaza un valor demasiado corto", () => {
    expect(IsPhone("123")).toBe(false);
  });
});

describe("IsBoolean", () => {
  it("acepta booleanos nativos, 0/1 y strings equivalentes", () => {
    expect(IsBoolean(true)).toBe(true);
    expect(IsBoolean(0)).toBe(true);
    expect(IsBoolean(1)).toBe(true);
    expect(IsBoolean("true")).toBe(true);
    expect(IsBoolean("false")).toBe(true);
  });

  it("rechaza cualquier otro valor", () => {
    expect(IsBoolean(2)).toBe(false);
    expect(IsBoolean("si")).toBe(false);
  });
});

describe("IsName", () => {
  it("acepta nombres con tildes y guiones", () => {
    expect(IsName("María José Peña-Ríos")).toBe(true);
  });

  it("rechaza caracteres no permitidos", () => {
    expect(IsName("Nombre@Invalido")).toBe(false);
  });
});

describe("IsId", () => {
  it("acepta un id alfanumerico en minusculas de 10 a 30 caracteres", () => {
    expect(IsId("abc123def456")).toBe(true);
  });

  it("rechaza mayusculas o largos fuera de rango", () => {
    expect(IsId("ABC123DEF456")).toBe(false);
    expect(IsId("corto")).toBe(false);
  });
});
