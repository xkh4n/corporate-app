import { useMemo, useState } from "react";
import * as Io from "react-icons/io5";
import type { IconType } from "react-icons";
import { Button, Input } from "./ui";

// Mismo set que resuelve MenuIcon.tsx (react-icons/io5, ~1.300 iconos): se
// guarda el nombre de export tal cual (ej. "IoWallet") en menu_items.icon.
const ICONS = Object.entries(Io as unknown as Record<string, IconType>)
    .filter(([name]) => name.startsWith("Io"))
    .sort(([a], [b]) => a.localeCompare(b));

// Iconos por pagina: dibujar los ~1.300 juntos hace pesado el recuadro, asi
// que se pagina (y la busqueda acota el total).
const PAGE_SIZE = 120;

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
    const [page, setPage] = useState(1);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return ICONS;
        return ICONS.filter(([name]) => searchableName(name).includes(term) || name.toLowerCase().includes(term));
    }, [search]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
    const SelectedIcon = value ? (Io as unknown as Record<string, IconType>)[value] : undefined;

    function handleSearchChange(term: string) {
        setSearch(term);
        setPage(1);
    }

    // Arriba y abajo de la grilla, igual que en los listados paginados.
    const pagination =
        totalPages > 1 ? (
            <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                <span>
                    Página {currentPage} de {totalPages} ({filtered.length} iconos)
                </span>
                <div className="flex gap-2">
                    <Button
                        type="button"
                        variant="secondary"
                        className="px-2! py-1! text-xs"
                        disabled={currentPage <= 1}
                        onClick={() => setPage(currentPage - 1)}
                    >
                        Anterior
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        className="px-2! py-1! text-xs"
                        disabled={currentPage >= totalPages}
                        onClick={() => setPage(currentPage + 1)}
                    >
                        Siguiente
                    </Button>
                </div>
            </div>
        ) : null;

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
                        onChange={(e) => handleSearchChange(e.target.value)}
                        className="bg-zinc-100 focus:bg-indigo-100"
                        aria-label="Buscar icono"
                    />
                </div>
            </div>

            {pagination && <div className="mt-3">{pagination}</div>}

            <div
                className="mt-3 grid grid-cols-6 gap-1 min-[500px]:grid-cols-8 min-[800px]:grid-cols-12"
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

            {pagination ? (
                <div className="mt-3">{pagination}</div>
            ) : (
                <p className="mt-2 text-xs text-slate-500">
                    {filtered.length === 0 ? "No hay iconos con ese nombre." : `${filtered.length} iconos.`}
                </p>
            )}
        </div>
    );
}
