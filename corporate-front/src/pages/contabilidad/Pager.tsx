import { Button } from "../../components/ui";

// Paginador de los listados de Contabilidad > Gestion de Activos. Se usa
// arriba y abajo de cada tabla; no se muestra con una sola pagina.
export function Pager({
    page,
    totalPages,
    totalItems,
    noun,
    onChange,
}: {
    page: number;
    totalPages: number;
    totalItems: number;
    noun: string;
    onChange: (page: number) => void;
}) {
    if (totalPages <= 1) return null;
    return (
        <div className="flex flex-col gap-2 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-center sm:text-left">
                Página {page} de {totalPages} ({totalItems} {noun})
            </span>
            <div className="grid grid-cols-2 gap-2 sm:flex">
                <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
                    Anterior
                </Button>
                <Button type="button" variant="secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
                    Siguiente
                </Button>
            </div>
        </div>
    );
}
