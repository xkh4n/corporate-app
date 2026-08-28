import { describe, expect, it } from "vitest";
import { toQuery } from "./query";

describe("toQuery", () => {
  it("devuelve string vacio sin params", () => {
    expect(toQuery()).toBe("");
    expect(toQuery(null)).toBe("");
  });

  it("devuelve string vacio con un objeto vacio", () => {
    expect(toQuery({})).toBe("");
  });

  it("arma un query-string con multiples entradas", () => {
    const result = toQuery({ search: "abc", limit: 10, active: true });
    const params = new URLSearchParams(result.slice(1));
    expect(result.startsWith("?")).toBe(true);
    expect(params.get("search")).toBe("abc");
    expect(params.get("limit")).toBe("10");
    expect(params.get("active")).toBe("true");
  });

  it("descarta entradas undefined/null pero conserva 0/false/string vacio", () => {
    const result = toQuery({ a: undefined, b: null, c: 0, d: false, e: "" });
    const params = new URLSearchParams(result.slice(1));
    expect(params.has("a")).toBe(false);
    expect(params.has("b")).toBe(false);
    expect(params.get("c")).toBe("0");
    expect(params.get("d")).toBe("false");
    expect(params.get("e")).toBe("");
  });
});
