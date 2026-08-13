import { useEffect, useRef, useState } from "react";
import type { SubmitEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../../components/RequirePermissions";
import { Spinner, Field, Select, Button, Input } from "../../../components/ui";
import { handleError } from "../../../lib/Errors";
import { createValidationError } from "../../../lib/Errors/CustomError";
import type { ProductCategory, ProductCreateInput, ProductType } from "../../../types";
import { productCategoryService, productService } from "../../../services";
import { IsParagraph, IsId } from "../../../lib/Validations";
import { showSuccessToast } from "../../../components/Toast";

const REQUIRED_PERMISSIONS = [
  "products:create",
] as const;

export default function CreateProducts() {
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);
    const [catalogsLoading, setCatalogsLoading] = useState(true);
    const [categoy, setCategory] = useState<ProductCategory[]>([]);
    const [selectedCategory, setSelectedCategory] = useState("");
    const [productName, setProductName] = useState("");
    const [descriptionProduct, setDescriptionProduct] = useState("");
    const [selectedTypeProduct, setSelectedTypeProduct] = useState("");
    const [imageFile, setImageFile] = useState<File | null>(null);
    // <input type="file"> mantiene su propio valor en el DOM, no controlado
    // por React: limpiar el state no borra el nombre de archivo mostrado.
    const imageInputRef = useRef<HTMLInputElement>(null);

    // Id ya creado en un intento previo que fallo a mitad de camino (mismo
    // criterio que createBusinessPartner.tsx/CrearPersona.tsx): sin esto, un
    // segundo submit despues de que fallara SOLO la subida de imagen
    // recrearia el producto entero (name es unique en Mongo, chocaria).
    const [productId, setProductId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const cat = await productCategoryService.list({ limit: 1000 });
                setCategory(cat.items);
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


    function resetForm() {
        setSubmitting(false);
        setSelectedCategory("");
        setProductName("");
        setDescriptionProduct("");
        setSelectedTypeProduct("");
        setImageFile(null);
        setProductId(null);
        if (imageInputRef.current) imageInputRef.current.value = "";
    }

    // Solo formato/tamano basico: el backend es la autoridad real (magic
    // bytes + whitelist de mimetype, ver middlewares/upload.ts) -esto es
    // nada mas para no gastar el POST /products si el archivo obviamente no
    // sirve.
    function validateImage(file: File): void {
        if (!["image/jpeg", "image/png"].includes(file.type)) {
            throw createValidationError("La imagen debe ser JPG o PNG");
        }
        if (file.size > 1 * 1024 * 1024) {
            throw createValidationError("La imagen no puede superar los 15MB");
        }
    }

    function validate(): void {
        if (!selectedCategory.trim() || !IsId(selectedCategory.trim())) {
            throw createValidationError("La Categoría no es valida");
        }
        if (!productName.trim() || !IsParagraph(productName.trim())) {
            throw createValidationError("El nombre del Producto no es váido");
        }
        if (!descriptionProduct.trim() || !IsParagraph(descriptionProduct.trim())) {
            throw createValidationError("La descripción no es valida");
        }
        if (!selectedTypeProduct.trim() || !IsParagraph(selectedTypeProduct.trim())) {
            throw createValidationError("El tipo de producto no es válido");
        }
        if (imageFile) validateImage(imageFile);
    }

    async function handleSubmit(event: SubmitEvent<HTMLFormElement>){
        event.preventDefault();
        setSubmitting(true);
        try {
            validate();

            // Id ya creado en un intento previo (ver comentario junto al
            // useState): si solo fallo la subida de la imagen, no se vuelve
            // a crear el producto.
            let pId = productId;
            if (!pId) {
                const newProd: ProductCreateInput = {
                    categoryId: selectedCategory.trim(),
                    name: productName.trim(),
                    description: descriptionProduct.trim(),
                    productType: selectedTypeProduct.trim() as ProductType,
                };
                const product = await productService.create(newProd);
                pId = product.id;
                setProductId(pId);
            }

            // La imagen es opcional: el producto queda creado igual sin
            // ella, se puede subir despues desde el listado.
            if (imageFile) {
                await productService.uploadImage(pId, imageFile);
            }

            showSuccessToast("Producto creado exitosamente");
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
                <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Crear Producto</h1>
                {catalogsLoading ? (
                    <div className="flex justify-center py-12">
                        <Spinner />
                    </div>
                ) : (
                    <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
                        <form onSubmit={(event) => void handleSubmit(event)} className="w-full">
                            <div className="grid grid-cols-1 max-[799px]:grid-cols-1 min-[800px]:grid-cols-6 min-[1000px]:grid-cols-8 min-[1200px]:grid-cols-10 min-[1400px]:grid-cols-12 gap-4">
                                {/* CATEGORIAS */}
                                <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-2">
                                    <Field label="Categoria Producto" htmlFor="categoryProduct">
                                        <Select
                                            id="categoryProduct"
                                            className="bg-zinc-100 focus:bg-indigo-100"
                                            value={selectedCategory}
                                            onChange={(e) => setSelectedCategory(e.target.value)}
                                            required
                                        >
                                            <option value="">Seleccione una Categoria</option>
                                            {categoy.map((cat) => (
                                            <option key={cat.id} value={cat.id}>
                                                {cat.name}
                                            </option>
                                            ))}
                                        </Select>
                                    </Field>
                                </div>
                                {/* TIPO PRODUCTO */}
                                <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-2">
                                    <Field label="Tipo Producto" htmlFor="typeProduct">
                                        <Select
                                            id="typeProduct"
                                            className="bg-zinc-100 focus:bg-indigo-100"
                                            value={selectedTypeProduct}
                                            onChange={(e) => setSelectedTypeProduct(e.target.value)}
                                            required
                                        >
                                            <option value="">Seleccione el Tipo</option>
                                            <option value="ARRIENDO">ARRIENDOS</option>
                                            <option value="COMPRA">COMPRAS</option>
                                            <option value="SERVICIO">SERVICIOS</option>
                                        </Select>
                                    </Field>
                                </div>
                                {/* NOMBRE */}
                                <div className="w-full max-[799px]:w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-4 min-[1400px]:col-span-8">
                                    <Field label="Nombre" htmlFor="nameProduct">
                                    <Input
                                        id="nameProduct"
                                        value={productName}
                                        maxLength={100}
                                        onChange={(e) => setProductName(e.target.value.toUpperCase())}
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                    </Field>
                                </div>
                                {/* DESCRIPCION */}
                                <div className="w-full max-[799px]:w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-10 min-[1400px]:col-span-12">
                                    <Field label="Descripción" htmlFor="nameDescription">
                                    <Input
                                        id="nameDescription"
                                        value={descriptionProduct}
                                        maxLength={100}
                                        onChange={(e) => setDescriptionProduct(e.target.value.toUpperCase())}
                                        className="bg-zinc-100 focus:bg-indigo-100"
                                    />
                                    </Field>
                                </div>
                                {/* IMAGEN */}
                                <div className="w-full max-[799px]:w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-10 min-[1400px]:col-span-12">
                                    <Field label="Imagen (JPG o PNG, opcional)" htmlFor="productImage">
                                    <Input
                                        ref={imageInputRef}
                                        id="productImage"
                                        type="file"
                                        accept="image/jpeg,image/png"
                                        onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
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
                )}
            </div>
        </RequirePermissions>
    )
}
