import { Op, type OrderItem, type WhereOptions } from "sequelize";

// Op.iLike (Postgres) vs Op.like (MSSQL): SQL Server no tiene ILIKE, pero sus
// collations por defecto ya son case-insensitive, asi que Op.like alcanza
// ahi. Cada service pasa el operador correcto para su motor.
export function buildSequelizeSearchWhere(
  search: string | undefined,
  fields: string[],
  operator: typeof Op.like | typeof Op.iLike,
): WhereOptions {
  if (!search || fields.length === 0) return {};
  return {
    [Op.or]: fields.map((field) => ({ [field]: { [operator]: `%${search}%` } })),
  } as WhereOptions;
}

export function buildSequelizeOrder(sortBy: string, sortOrder: "asc" | "desc"): OrderItem[] {
  return [[sortBy, sortOrder === "desc" ? "DESC" : "ASC"]];
}
