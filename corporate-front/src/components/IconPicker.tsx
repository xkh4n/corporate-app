import { useMemo, useState } from "react";
import * as Io from "react-icons/io5";
import type { IconType } from "react-icons";
import { Input } from "./ui";

// Mismo set que resuelve MenuIcon.tsx (react-icons/io5, ~1.300 iconos): se
// guarda el nombre de export tal cual (ej. "IoWallet") en menu_items.icon.
const ICONS = Object.entries(Io as unknown as Record<string, IconType>)
    .filter(([name]) => name.startsWith("Io"))
    .sort(([a], [b]) => a.localeCompare(b));

// Tope de iconos renderizados a la vez: dibujar los ~1.300 juntos hace
// pesado el recuadro, se pide afinar la busqueda en vez de paginar.
const MAX_VISIBLE = 120;

// "IoWalletOutline" -> "wallet outline", para buscar sin el prefijo ni el
// CamelCase ("wallet", "outline", "people").
function searchableName(name: string): string {
    return name
        .replace(/^Io/, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase();
}

export function IconPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
    const [search, setSearch] = useState("");

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return ICONS;
        return ICONS.filter(([name]) => searchableName(name).includes(term) || name.toLowerCase().includes(term));
    }, [search]);

    const visible = filtered.slice(0, MAX_VISIBLE);
    const SelectedIcon = value ? (Io as unknown as Record<string, IconType>)[value] : undefined;

    return (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-md border border-slate-200 bg-slate-50">
                    {SelectedIcon ? <SelectedIcon className="h-7 w-7 text-indigo-700" aria-hidden /> : null}
                </div>
                <div className="text-sm">
                    <p className="font-medium text-slate-700">{value ? "Icono seleccionado" : "Ningún icono seleccionado"}</p>
                    {value && <code className="text-xs text-slate-500">{value}</code>}
                </div>
                <div className="ml-auto w-full max-w-xs">
                    <Input
                        placeholder="Buscar icono (ej. people, wallet, cart)..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="bg-zinc-100 focus:bg-indigo-100"
                        aria-label="Buscar icono"
                    />
                </div>
            </div>

            <div
                className="mt-3 grid max-h-72 grid-cols-6 gap-1 overflow-y-auto min-[500px]:grid-cols-8 min-[800px]:grid-cols-12"
                role="listbox"
                aria-label="Iconos disponibles"
            >
                {visible.map(([name, Icon]) => {
                    const selected = name === value;
                    return (
                        <button
                            key={name}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            aria-label={name}
                            title={name}
                            onClick={() => onChange(name)}
                            className={`flex aspect-square items-center justify-center rounded-md border text-slate-700 transition-colors ${
                                selected
                                    ? "border-indigo-500 bg-indigo-100 text-indigo-700"
                                    : "border-transparent hover:border-slate-300 hover:bg-slate-100"
                            }`}
                        >
                            <Icon className="h-6 w-6" aria-hidden />
                        </button>
                    );
                })}
            </div>

            <p className="mt-2 text-xs text-slate-500">
                {filtered.length === 0
                    ? "No hay iconos con ese nombre."
                    : filtered.length > MAX_VISIBLE
                      ? `Mostrando ${MAX_VISIBLE} de ${filtered.length} iconos; escriba para afinar la búsqueda.`
                      : `${filtered.length} iconos.`}
            </p>
        </div>
    );
}
