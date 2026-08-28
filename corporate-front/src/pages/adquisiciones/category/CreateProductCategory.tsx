import { useState } from "react";
import type { SubmitEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../../components/RequirePermissions";
import { Field, Button, Input } from "../../../components/ui";
import { handleError } from "../../../lib/Errors";
import { createValidationError } from "../../../lib/Errors/CustomError";
import type { ProductCategoryCreateInput } from "../../../types";
import { productCategoryService } from "../../../services";
import { IsParagraph } from "../../../lib/Validations";
import { showSuccessToast } from "../../../components/Toast";

const REQUIRED_PERMISSIONS = [
  "product-categories:create",
] as const;

export default function CreateProductCategory() {
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);
    const [categoy, setCategory] = useState("");
    const [descriptionCategory, setDescriptionCategory] = useState("");
    function resetForm() {
        setSubmitting(false);
        setCategory("");
        setDescriptionCategory("");
    }


    function validate(): void {
        if (!categoy.trim() || !IsParagraph(categoy.trim())) {
            throw createValidationError("El nombre de la Categoría no es válido");
        }
        if (!descriptionCategory.trim() || !IsParagraph(descriptionCategory.trim())) {
            throw createValidationError("La descripción no es valida");
        }
    }

    async function handleSubmit(event: SubmitEvent<HTMLFormElement>){
        event.preventDefault();
        setSubmitting(true);
        try {
            validate();

            const newCategory: ProductCategoryCreateInput = {
                name: categoy.trim(),
                description: descriptionCategory.trim(),
            };
            await productCategoryService.create(newCategory);
            showSuccessToast("Categoría creada exitosamente");
            resetForm();
        } catch (error) {
            handleError(error, navigate);
        } finally{
            setSubmitting(false);
        }
    }
    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <div className="flex flex-col items-center justify-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
                <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Crear Categoría de Producto</h1>
                <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
                    <form onSubmit={(event) => void handleSubmit(event)} className="w-full">
                        <div className="grid grid-cols-1 max-[799px]:grid-cols-1 min-[800px]:grid-cols-6 min-[1000px]:grid-cols-8 min-[1200px]:grid-cols-10 min-[1400px]:grid-cols-12 gap-4">
                            {/* CATEGORIA */}
                            <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-3 min-[1200px]:col-span-3 min-[1400px]:col-span-4">
                                <Field label="Categoria Producto" htmlFor="nameCategory">
                                    <Input
                                        id="nameCategory"
                                        value={categoy}
                                        maxLength={100}
                                        onChange={(e) => setCategory(e.target.value.toUpperCase())}
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                </Field>
                            </div>
                            {/* DESCRIPCION */}
                            <div className="w-full max-[799px]:w-full min-[800px]:col-span-4 min-[1000px]:col-span-5 min-[1200px]:col-span-7 min-[1400px]:col-span-8">
                                <Field label="Descripción" htmlFor="nameDescription">
                                <Input
                                    id="nameDescription"
                                    value={descriptionCategory}
                                    maxLength={100}
                                    onChange={(e) => setDescriptionCategory(e.target.value.toUpperCase())}
                                    className="bg-zinc-100 focus:bg-indigo-100"
                                />
                                </Field>
                            </div>
                        </div>
                        <div className="flex flex-1 row-auto justify-center mt-4">
                            <Button type="submit" loading={submitting} className="w-60">
                                Guardar
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </RequirePermissions>
    )
}
