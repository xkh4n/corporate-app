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
        <div className="flex items-center justify-between gap-2 text-sm text-slate-600">
            <span>
                Página {page} de {totalPages} ({totalItems} {noun})
            </span>
            <div className="flex gap-2">
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
