import { Op, type OrderItem, type WhereOptions } from "sequelize";

// Op.iLike (Postgres) vs Op.like (MSSQL): SQL Server no tiene ILIKE, pero sus
// collations por defecto ya son case-insensitive, asi que Op.like alcanza
// ahi. Cada service pasa el operador correcto para su motor.
// Postgres usa la barra invertida como escape por defecto: sin esto, un search con % o _
// actuaria como comodin ("%" listaria todo). En MSSQL (Op.like) no hay escape por
// defecto, ahi se deja tal cual.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export function buildSequelizeSearchWhere(
  search: string | undefined,
  fields: string[],
  operator: typeof Op.like | typeof Op.iLike,
): WhereOptions {
  if (!search || fields.length === 0) return {};
  const term = operator === Op.iLike ? escapeLikePattern(search) : search;
  return {
    [Op.or]: fields.map((field) => ({ [field]: { [operator]: `%${term}%` } })),
  } as WhereOptions;
}

export function buildSequelizeOrder(sortBy: string, sortOrder: "asc" | "desc"): OrderItem[] {
  return [[sortBy, sortOrder === "desc" ? "DESC" : "ASC"]];
}
