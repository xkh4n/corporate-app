function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildMongoSearchFilter(search: string | undefined, fields: string[]): Record<string, unknown> {
  if (!search || fields.length === 0) return {};
  const regex = new RegExp(escapeRegex(search), "i");
  return { $or: fields.map((field) => ({ [field]: regex })) };
}

export function buildMongoSort(sortBy: string, sortOrder: "asc" | "desc"): Record<string, 1 | -1> {
  return { [sortBy]: sortOrder === "desc" ? -1 : 1 };
}
