import { CustomError } from './CustomError';
import { ApiError } from '../apiClient';
import { showErrorToast } from '../../components/Toast';

export type ErrorOrigin = 'front' | 'back' | 'other';

export type ErrorState = {
    origin: ErrorOrigin;
    code: number;
    message: string;
    detail?: string;
};

// Clasifica el origen del error para poder mostrar (y loguear) cada caso
// distinto: 'front' es una validacion que corto el submit antes de mandar
// cualquier request (CustomError, ver CustomError.ts); 'back' es un rechazo
// real del backend, con su status real (ApiError, ver lib/apiClient.ts);
// 'other' es cualquier cosa no anticipada (red caida, excepcion de JS) -no
// hay forma de mostrarle al usuario un mensaje especifico ahi, solo avisar
// que algo fallo y dejar rastro en consola para debug.
function classify(error: unknown): ErrorState {
    if (error instanceof CustomError) {
        const data = error.toJSON();
        return { origin: 'front', code: data.code, message: data.message, detail: data.type };
    }
    if (error instanceof ApiError) {
        return { origin: 'back', code: error.status, message: error.message, detail: String(error.details ?? '') };
    }
    return {
        origin: 'other',
        code: 500,
        message: error instanceof Error ? error.message : 'Error inesperado',
    };
}

// Uso: en el catch de un submit, "handleError(error, navigate)". Nunca hace
// falta pasarle currentPath -react-router ya sabe donde esta parado el
// Navigate/useNavigate que le pases.
export function handleError(error: unknown, navigate?: (path: string) => void): ErrorState {
    const state = classify(error);

    if (state.origin === 'other') {
        console.error('Error inesperado:', error);
    }

    showErrorToast(state.message || 'Ocurrio un error');

    // Un 403 real del backend si tiene a donde mandar al usuario -la misma
    // pagina que ya usa el menu podado para cualquier ruta sin permiso (ver
    // AppRoutes.tsx). Los demas casos (validacion del front, 400/404/500,
    // fallas de red) se quedan en la misma pantalla: el toast ya avisa, y
    // navegar los sacaria del formulario que estaban llenando.
    if (state.origin === 'back' && state.code === 403) {
        navigate?.('/403');
    }

    return state;
}
