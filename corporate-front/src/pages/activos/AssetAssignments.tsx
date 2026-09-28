import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Field, Button, Input, Select, EmptyState, Spinner } from "../../components/ui";
import { handleError } from "../../lib/Errors";
import { assetMovementService, costCenterService, productCategoryService } from "../../services";
import type { CostCenter } from "../../types/costCenter";
import type { ProductCategory } from "../../types/productCategory";
import type { AssignmentFilters, AssignmentRow } from "../../types/assetMovement";
import { Pager } from "../contabilidad/Pager";
import { AssignmentsTable } from "./AssignmentsTable";

// Visualizar Asignaciones (plan 011): todos los activos en uso con su usuario y
// centro de costo. Solo lectura.
const REQUIRED_PERMISSIONS = ["assets:read", "asset-movements:read"] as const;
const PAGE_SIZE = 20;

interface FilterDraft {
  costCenterId: string;
  categoryId: string;
  user: string;
  serial: string;
}

const EMPTY_FILTERS: FilterDraft = { costCenterId: "", categoryId: "", user: "", serial: "" };

function toFilters(draft: FilterDraft): AssignmentFilters {
  return {
    costCenterId: draft.costCenterId ? Number(draft.costCenterId) : undefined,
    categoryId: draft.categoryId || undefined,
    user: draft.user.trim() || undefined,
    serial: draft.serial.trim() || undefined,
  };
}

export default function AssetAssignments() {
  const navigate = useNavigate();

  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AssignmentFilters>({});
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  useEffect(() => {
    Promise.all([
      costCenterService.list({ limit: 1000, sortBy: "code" }),
      productCategoryService.list({ limit: 1000, sortBy: "name" }),
    ])
      .then(([centers, cats]) => {
        setCostCenters(centers.items);
        setCategories(cats.items);
      })
      .catch((error: unknown) => handleError(error, navigate));
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    assetMovementService
      .listAssignments({ ...applied, page, limit: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return;
        setRows(res.items);
        setTotalPages(res.pagination.totalPages);
        setTotalItems(res.pagination.totalItems);
      })
      .catch((error: unknown) => {
        if (!cancelled) handleError(error, navigate);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applied, page, navigate]);

  function applyFilters(next: FilterDraft): void {
    setApplied(toFilters(next));
    setPage(1);
  }

  const pager = <Pager page={page} totalPages={totalPages} totalItems={totalItems} noun="activos" onChange={setPage} />;

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col h-max bg-sky-100 p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Visualizar Asignaciones</h1>

        <form
          className="mb-4 rounded-lg border border-slate-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            applyFilters(draft);
          }}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Centro de costo" htmlFor="filterCostCenter">
              <Select
                id="filterCostCenter"
                value={draft.costCenterId}
                onChange={(e) => setDraft((prev) => ({ ...prev, costCenterId: e.target.value }))}
              >
                <option value="">Todos</option>
                {costCenters.map((costCenter) => (
                  <option key={costCenter.id} value={costCenter.id}>
                    {costCenter.code} - {costCenter.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Categoría" htmlFor="filterCategory">
              <Select
                id="filterCategory"
                value={draft.categoryId}
                onChange={(e) => setDraft((prev) => ({ ...prev, categoryId: e.target.value }))}
              >
                <option value="">Todas</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Usuario (nombre o RUT completo)" htmlFor="filterUser">
              <Input
                id="filterUser"
                value={draft.user}
                maxLength={100}
                onChange={(e) => setDraft((prev) => ({ ...prev, user: e.target.value }))}
                className="bg-zinc-100 focus:bg-indigo-100"
              />
            </Field>
            <Field label="Tag o N° de serie" htmlFor="filterSerial">
              <Input
                id="filterSerial"
                value={draft.serial}
                maxLength={100}
                onChange={(e) => setDraft((prev) => ({ ...prev, serial: e.target.value }))}
                className="bg-zinc-100 focus:bg-indigo-100"
              />
            </Field>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setDraft(EMPTY_FILTERS);
                applyFilters(EMPTY_FILTERS);
              }}
            >
              Limpiar
            </Button>
            <Button type="submit">Buscar</Button>
          </div>
        </form>

        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="Sin asignaciones" description="No hay activos asignados que coincidan con la búsqueda." />
        ) : (
          <div className="flex flex-col gap-3">
            {pager}
            <AssignmentsTable rows={rows} />
            {pager}
          </div>
        )}
      </div>
    </RequirePermissions>
  );
}
