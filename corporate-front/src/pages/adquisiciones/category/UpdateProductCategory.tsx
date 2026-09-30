import { useEffect, useState } from "react";
import type { SubmitEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../../components/RequirePermissions";
import { Spinner, Field, Select, Button, Input } from "../../../components/ui";
import { handleError } from "../../../lib/Errors";
import { createValidationError } from "../../../lib/Errors/CustomError";
import type { ProductCategory } from "../../../types";
import { productCategoryService } from "../../../services";
import { IsParagraph } from "../../../lib/Validations";
import { showSuccessToast } from "../../../components/Toast";

const REQUIRED_PERMISSIONS = ["product-categories:update"] as const;

export default function UpdateProductCategory() {
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);
    const [catalogsLoading, setCatalogsLoading] = useState(true);
    const [categories, setCategories] = useState<ProductCategory[]>([]);
    const [selectedCategoryId, setSelectedCategoryId] = useState("");
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");

    async function loadCategories(): Promise<ProductCategory[]> {
        const res = await productCategoryService.list({ limit: 1000 });
        setCategories(res.items);
        return res.items;
    }

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                await loadCategories();
            } catch (error) {
                handleError(error, navigate);
            } finally {
                if (!cancelled) setCatalogsLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [navigate]);

    function selectCategory(id: string, source: ProductCategory[]): void {
        setSelectedCategoryId(id);
        const category = source.find((item) => item.id === id);
        setName(category?.name ?? "");
        setDescription(category?.description ?? "");
    }

    function validate(): void {
        if (!selectedCategoryId) {
            throw createValidationError("Debe seleccionar una categoría");
        }
        if (!name.trim() || !IsParagraph(name.trim())) {
            throw createValidationError("El nombre de la Categoría no es válido");
        }
        if (!description.trim() || !IsParagraph(description.trim())) {
            throw createValidationError("La descripción no es valida");
        }
    }

    async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitting(true);
        try {
            validate();

            await productCategoryService.update(selectedCategoryId, {
                name: name.trim(),
                description: description.trim(),
            });
            showSuccessToast("Categoría actualizada exitosamente");

            const refreshed = await loadCategories();
            selectCategory(selectedCategoryId, refreshed);
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <div className="flex flex-col items-center justify-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
                <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Editar Categoría de Producto</h1>
                {catalogsLoading ? (
                    <div className="flex justify-center py-12">
                        <Spinner />
                    </div>
                ) : (
                    <div className="w-full sm:max-w-[95%] mx-auto sm:px-4 lg:px-8">
                        <form onSubmit={(event) => void handleSubmit(event)} className="w-full">
                            <div className="grid grid-cols-1 max-[799px]:grid-cols-1 min-[800px]:grid-cols-6 min-[1000px]:grid-cols-8 min-[1200px]:grid-cols-10 min-[1400px]:grid-cols-12 gap-4">
                                {/* CATEGORIA A EDITAR */}
                                <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-4">
                                    <Field label="Categoria Producto" htmlFor="categoryToEdit">
                                        <Select
                                            id="categoryToEdit"
                                            className="bg-zinc-100 focus:bg-indigo-100"
                                            value={selectedCategoryId}
                                            onChange={(e) => selectCategory(e.target.value, categories)}
                                            required
                                        >
                                            <option value="">Seleccione una Categoria</option>
                                            {categories.map((category) => (
                                                <option key={category.id} value={category.id}>
                                                    {category.name}
                                                </option>
                                            ))}
                                        </Select>
                                    </Field>
                                </div>
                                {/* NOMBRE */}
                                <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-4 min-[1400px]:col-span-4">
                                    <Field label="Nombre" htmlFor="nameCategory">
                                        <Input
                                            id="nameCategory"
                                            value={name}
                                            maxLength={100}
                                            disabled={!selectedCategoryId}
                                            onChange={(e) => setName(e.target.value.toUpperCase())}
                                            className="bg-zinc-100 focus:bg-indigo-100"
                                        />
                                    </Field>
                                </div>
                                {/* DESCRIPCION */}
                                <div className="w-full max-[799px]:w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-10 min-[1400px]:col-span-12">
                                    <Field label="Descripción" htmlFor="descriptionCategory">
                                        <Input
                                            id="descriptionCategory"
                                            value={description}
                                            maxLength={100}
                                            disabled={!selectedCategoryId}
                                            onChange={(e) => setDescription(e.target.value.toUpperCase())}
                                            className="bg-zinc-100 focus:bg-indigo-100"
                                        />
                                    </Field>
                                </div>
                            </div>
                            <div className="flex flex-1 row-auto justify-center mt-4">
                                <Button type="submit" loading={submitting} disabled={!selectedCategoryId} className="w-full sm:w-60">
                                    Guardar
                                </Button>
                            </div>
                        </form>
                    </div>
                )}
            </div>
        </RequirePermissions>
    );
}
