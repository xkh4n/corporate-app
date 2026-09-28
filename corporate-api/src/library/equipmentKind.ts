// Tipo de equipo para el acta de entrega, derivado del NOMBRE de la categoria del
// producto (no hay un campo "tipo" en el catalogo): "NOTEBOOKS" -> NOTEBOOK,
// "DESKTOPS" -> DESKTOP, "MONITORES" -> MONITOR. Sin categoria o con otra, OTHER.
export type EquipmentKind = "NOTEBOOK" | "DESKTOP" | "MONITOR" | "OTHER";

const KIND_KEYWORDS: [EquipmentKind, string[]][] = [
  ["NOTEBOOK", ["NOTEBOOK", "LAPTOP"]],
  ["DESKTOP", ["DESKTOP", "ESCRITORIO"]],
  ["MONITOR", ["MONITOR"]],
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

export function classifyEquipment(categoryName: string | null | undefined): EquipmentKind {
  if (!categoryName) return "OTHER";
  const name = normalize(categoryName);
  for (const [kind, keywords] of KIND_KEYWORDS) {
    if (keywords.some((keyword) => name.includes(keyword))) return kind;
  }
  return "OTHER";
}

// Que campos del acta aplican a cada tipo de equipo (pedido del usuario):
// bolso y candado solo notebook; cargador notebook o monitor; MAC notebook o desktop.
export function handoverFieldApplies(kind: EquipmentKind, field: "bag" | "lock" | "charger" | "mac"): boolean {
  switch (field) {
    case "bag":
    case "lock":
      return kind === "NOTEBOOK";
    case "charger":
      return kind === "NOTEBOOK" || kind === "MONITOR";
    case "mac":
      return kind === "NOTEBOOK" || kind === "DESKTOP";
  }
}
