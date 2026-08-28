import * as Io from "react-icons/io5";
import { IoEllipseOutline } from "react-icons/io5";
import type { IconType } from "react-icons";

// "icon" en menu_items es texto libre (ver corporate-api/src/models/postgres/
// menuItem.model.ts): acepta las dos convenciones con las que se viene
// cargando el catalogo -el nombre de export tal cual del paquete
// ("IoEaselSharp", como aparece copiado de la galeria de react-icons) o el
// nombre "pelado" de Ionicons sin el prefijo "Io" ("peopleOutline", las
// primeras filas cargadas). Se resuelve en runtime para que cualquier icono
// del set funcione sin tocar este archivo -el costo es que el barrel de
// "react-icons/io5" no es tree-shakeable con acceso dinamico (ver plan de
// esta feature).
const iconExports = Io as unknown as Record<string, IconType>;

function resolveIcon(name: string): IconType | undefined {
  if (iconExports[name]) return iconExports[name];
  const withPrefix = `Io${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  return iconExports[withPrefix];
}

// Fallback neutro: un typo en el catalogo (o un nombre que no existe en
// Ionicons 5) no debe romper el render del sidebar, solo mostrar un icono
// generico.
export function MenuIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && resolveIcon(name)) || IoEllipseOutline;
  return <Icon className={className} aria-hidden />;
}
