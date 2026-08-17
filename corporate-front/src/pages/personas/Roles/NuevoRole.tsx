import { useState, useEffect } from "react";
import type { SubmitEvent } from "react";
import { RequirePermissions } from "../../../components/RequirePermissions";
import { useNavigate } from "react-router-dom";
import { handleError } from "../../../lib/Errors";
import { Spinner, Button } from "../../../components/ui";
import { showSuccessToast } from "../../../components/Toast";


const REQUIRED_PERMISSIONS = ["roles:create", "permissions:read"] as const;
export default function NuevoRole() {
    const [catalogsLoading, setCatalogsLoading] = useState(true);
    const navigate = useNavigate();
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                if (cancelled) return;
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

    async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        try {
            setSubmitting(true);
            showSuccessToast(`Solicitud creada exitosamente con`);
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setSubmitting(false);
        }
    }


    return (
        <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
            <div className="flex flex-col items-center justify-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
                <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Nuevo Rol / Función</h1>
                {catalogsLoading ? (
                    <div className="flex justify-center py-12">
                        <Spinner />
                    </div>
                ) : (
                    <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
                        <form onSubmit={(event) => void handleSubmit(event)} className="w-full">
                            <div className="flex flex-1 row-auto justify-center mt-6">
                                <Button type="submit" loading={submitting} className="w-60">
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
