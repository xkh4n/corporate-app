import { describe, expect, it } from "vitest";
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  isDuplicateMssqlObjectError,
  isDuplicateObjectError,
  isUniqueConstraintError,
  NotFoundError,
  UnauthorizedError,
} from "./errors";

describe("clases de AppError", () => {
  it("BadRequestError expone statusCode 400 y el nombre de su clase", () => {
    const err = new BadRequestError("mensaje");
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("BadRequestError");
    expect(err.message).toBe("mensaje");
  });

  it("UnauthorizedError expone statusCode 401", () => {
    expect(new UnauthorizedError().statusCode).toBe(401);
  });

  it("ForbiddenError expone statusCode 403", () => {
    expect(new ForbiddenError().statusCode).toBe(403);
  });

  it("NotFoundError expone statusCode 404", () => {
    expect(new NotFoundError().statusCode).toBe(404);
  });

  it("ConflictError expone statusCode 409 y conserva los details", () => {
    const err = new ConflictError("ya existe", { field: "code" });
    expect(err.statusCode).toBe(409);
    expect(err.details).toEqual({ field: "code" });
  });
});

describe("isUniqueConstraintError", () => {
  it("reconoce SequelizeUniqueConstraintError por su .name", () => {
    const err = new Error("dup");
    err.name = "SequelizeUniqueConstraintError";
    expect(isUniqueConstraintError(err)).toBe(true);
  });

  it("rechaza cualquier otro error", () => {
    expect(isUniqueConstraintError(new Error("otra cosa"))).toBe(false);
    expect(isUniqueConstraintError("no es un Error")).toBe(false);
  });
});

describe("isDuplicateObjectError (Postgres)", () => {
  it("reconoce 42710 (duplicate_object) y 42P07 (duplicate_table) via err.parent.code", () => {
    const err42710 = Object.assign(new Error("dup"), { parent: { code: "42710" } });
    const err42P07 = Object.assign(new Error("dup"), { parent: { code: "42P07" } });
    expect(isDuplicateObjectError(err42710)).toBe(true);
    expect(isDuplicateObjectError(err42P07)).toBe(true);
  });

  it("tambien lee err.original.code cuando no hay .parent", () => {
    const err = Object.assign(new Error("dup"), { original: { code: "42710" } });
    expect(isDuplicateObjectError(err)).toBe(true);
  });

  it("rechaza otros codigos y no-Error", () => {
    const otherCode = Object.assign(new Error("otro"), { parent: { code: "23505" } });
    expect(isDuplicateObjectError(otherCode)).toBe(false);
    expect(isDuplicateObjectError("no es un Error")).toBe(false);
  });
});

describe("isDuplicateMssqlObjectError", () => {
  it("reconoce 2714/2627 desde err.parent.number (statement simple)", () => {
    const err2714 = Object.assign(new Error("dup"), { parent: { number: 2714 } });
    const err2627 = Object.assign(new Error("dup"), { parent: { number: 2627 } });
    expect(isDuplicateMssqlObjectError(err2714)).toBe(true);
    expect(isDuplicateMssqlObjectError(err2627)).toBe(true);
  });

  it("busca el numero dentro de parent.errors[] (AggregateError de un bulkCreate)", () => {
    const err = Object.assign(new Error("dup"), {
      parent: { errors: [{ number: 2627 }] },
    });
    expect(isDuplicateMssqlObjectError(err)).toBe(true);
  });

  it("rechaza otros numeros y errores sin parent", () => {
    const otherNumber = Object.assign(new Error("otro"), { parent: { number: 1205 } });
    expect(isDuplicateMssqlObjectError(otherNumber)).toBe(false);
    expect(isDuplicateMssqlObjectError(new Error("sin parent"))).toBe(false);
  });
});
