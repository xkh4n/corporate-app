// Tope de operaciones simultaneas, en memoria del PROCESO: total y por clave (p. ej.
// un usuario). Sirve para acotar la memoria de las subidas de archivos (multer con
// memoryStorage guarda hasta N MB por request): el limitador por ventana de tiempo
// (rateLimit.ts) cuenta requests, no cuantas estan EN CURSO a la vez, asi que una
// rafaga paralela lo esquivaba. Al ser por proceso, el tope real del cluster es
// (replicas x maxTotal); no necesita Redis porque lo que protege es la RAM local.
export interface ConcurrencyGate {
  // Devuelve la funcion que libera el cupo, o null si se alcanzo algun tope.
  // La funcion de liberar es idempotente.
  tryAcquire(key: string): (() => void) | null;
  inFlight(): number;
}

export function createConcurrencyGate(limits: { maxTotal: number; maxPerKey: number }): ConcurrencyGate {
  const perKey = new Map<string, number>();
  let total = 0;

  return {
    tryAcquire(key) {
      const current = perKey.get(key) ?? 0;
      if (total >= limits.maxTotal || current >= limits.maxPerKey) return null;
      total += 1;
      perKey.set(key, current + 1);

      let released = false;
      return () => {
        if (released) return;
        released = true;
        total -= 1;
        const left = (perKey.get(key) ?? 1) - 1;
        if (left <= 0) perKey.delete(key);
        else perKey.set(key, left);
      };
    },
    inFlight: () => total,
  };
}
