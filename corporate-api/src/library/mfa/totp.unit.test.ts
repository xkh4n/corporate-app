import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, buildOtpauthUri, generateTotpSecret, hotp, totpStep, verifyTotp } from "./totp";

// Vectores del Apendice B de la RFC 6238 (SHA-1, secreto ASCII "12345678901234567890"). La RFC da 8
// digitos; con 6 se toman los ultimos 6 (mismo modulo 10^d sobre el mismo truncamiento).
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];

describe("totp", () => {
  it.each(RFC_VECTORS)("RFC 6238 en t=%i da %s", (seconds, expected) => {
    expect(hotp(RFC_SECRET, totpStep(seconds * 1000))).toBe(expected);
  });

  it("base32 ida y vuelta", () => {
    expect(base32Encode(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").equals(RFC_SECRET)).toBe(true);
    expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq").equals(RFC_SECRET)).toBe(true);
  });

  it("acepta un paso de desfase a cada lado y devuelve el paso que coincidio", () => {
    const secret = base32Encode(RFC_SECRET);
    const now = 1234567890 * 1000;
    const step = totpStep(now);
    expect(verifyTotp(secret, hotp(RFC_SECRET, step), now)).toBe(step);
    expect(verifyTotp(secret, hotp(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, hotp(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(secret, hotp(RFC_SECRET, step + 2), now)).toBeNull();
  });

  it("rechaza formatos invalidos sin evaluar", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "12345")).toBeNull();
    expect(verifyTotp(secret, "abcdef")).toBeNull();
    expect(verifyTotp(secret, "1234567")).toBeNull();
  });

  it("genera secretos de 160 bits distintos", () => {
    const a = generateTotpSecret();
    expect(base32Decode(a)).toHaveLength(20);
    expect(a).not.toBe(generateTotpSecret());
  });

  it("arma la URI otpauth con issuer y cuenta codificados", () => {
    const uri = buildOtpauthUri({ secret: "ABC", accountName: "juan perez", issuer: "Corp App" });
    expect(uri).toBe("otpauth://totp/Corp%20App:juan%20perez?secret=ABC&issuer=Corp+App&algorithm=SHA1&digits=6&period=30");
  });
});
