# Flujo para crear un proveedor (Supplier)

Crear un proveedor **requiere 2 llamadas**, no una sola. La razón es que `BusinessPartner`
(razón social + RUT/nationalId + giro) es una entidad base **compartida** entre proveedores y
clientes: la misma empresa puede ser cliente y proveedor sin duplicar sus datos. Por eso
`POST /suppliers` nunca crea el `BusinessPartner` por dentro — debe existir primero (mismo
criterio que `employees`/`users`, que exigen un `personId` ya existente).

**Implicancia para el formulario del frontend**: no se puede armar un solo formulario que mande
todos los campos en un solo submit. Hay 2 opciones:

1. **2 formularios/pasos** (recomendado): paso 1 crea o busca el `BusinessPartner`, paso 2 crea el
   `Supplier` con el `id` obtenido. Permite además reutilizar un `BusinessPartner` que ya existe
   (por ejemplo, uno que ya es cliente) sin duplicarlo.
2. **1 formulario, 2 llamadas encadenadas**: el formulario junta todos los campos, pero el
   frontend primero hace `POST /business-partners` y, con el `id` de la respuesta, encadena
   `POST /suppliers`. Si el paso 2 falla (ej. RUT ya asociado a otro proveedor), el
   `BusinessPartner` creado en el paso 1 queda existente y reutilizable — no hace falta revertirlo.

En ambos casos, antes de crear un `BusinessPartner` nuevo conviene primero buscar por
`nationalId` (`GET /business-partners?search=<rut>`) para evitar duplicar una empresa que ya
existe como cliente.

## Paso 1 — Crear (o reutilizar) el Business Partner

`POST /api/business-partners`
Permiso requerido: `business-partners:create`

### Body

| Campo | Obligatorio | Tipo / validación |
|---|---|---|
| `legalName` | Sí | string, 1–200 caracteres |
| `nationalId` | Sí | string, 1–20 caracteres |
| `businessLine` | No | string, máx. 150 caracteres |

```json
{
  "legalName": "Distribuidora Los Andes SpA",
  "nationalId": "76543210-1",
  "businessLine": "Distribución de insumos"
}
```

### Respuesta (201)

```json
{
  "codigo": 201,
  "message": "Tercero creado exitosamente",
  "data": {
    "id": 1,
    "legalName": "Distribuidora Los Andes SpA",
    "nationalId": "76543210-1",
    "businessLine": "Distribución de insumos",
    "createdBy": 3,
    "createdAt": "2026-08-06T15:00:00.000Z",
    "updatedAt": "2026-08-06T15:00:00.000Z"
  }
}
```

Guardar `data.id` — es el `businessPartnerId` que se usa en el paso 2.

## Paso 2 — Crear el Supplier

`POST /api/suppliers`
Permiso requerido: `suppliers:create`

### Body

| Campo | Obligatorio | Tipo / validación |
|---|---|---|
| `businessPartnerId` | **Sí** | number, entero positivo. Debe existir y no estar ya asociado a otro proveedor (relación 1:1) |
| `serviceType` | **Sí** | enum: `"LEASE"` \| `"SERVICE"` \| `"SALE"` |
| `deliveryTerms` | **Sí** | enum: `"ON_PURCHASE_ORDER"` \| `"ON_INVOICE"` |
| `paymentTermDays` | No | number, entero ≥ 0 |

```json
{
  "businessPartnerId": 1,
  "serviceType": "SALE",
  "deliveryTerms": "ON_PURCHASE_ORDER",
  "paymentTermDays": 30
}
```

Body mínimo (sin `paymentTermDays`):

```json
{ "businessPartnerId": 1, "serviceType": "SERVICE", "deliveryTerms": "ON_INVOICE" }
```

### Respuesta (201)

```json
{
  "codigo": 201,
  "message": "Proveedor creado exitosamente",
  "data": {
    "id": 1,
    "businessPartnerId": 1,
    "serviceType": "SALE",
    "deliveryTerms": "ON_PURCHASE_ORDER",
    "paymentTermDays": 30,
    "businessPartner": { "id": 1, "legalName": "Distribuidora Los Andes SpA", "nationalId": "76543210-1", "businessLine": "Distribución de insumos" }
  }
}
```

### Errores esperables en el paso 2

Todas las respuestas de error usan la misma forma `{ codigo, message, details? }`.

| Caso | `codigo` | `message` |
|---|---|---|
| `businessPartnerId` no existe | 404 | `El tercero <id> no existe` |
| El business partner ya es proveedor | 409 | `El tercero <id> ya es proveedor` |
| Body no cumple el schema (falta campo, enum inválido) | 400 | detalle de validación en `details` |

## Actualizar un proveedor existente

`PUT /api/suppliers/:id` (permiso `suppliers:update`) acepta los mismos campos **excepto**
`businessPartnerId` (no se puede reasignar el business partner de un proveedor ya creado), todos
opcionales.

## Nota de diseño

Se evaluó exponer un único endpoint `POST /suppliers` que reciba también los campos del business
partner y cree ambos por dentro en una transacción. Se descartó a propósito: forzaría crear un
`BusinessPartner` nuevo en cada alta, rompiendo la reutilización entre clientes y proveedores, e
introduciría el riesgo de duplicar una empresa que ya existe. Se mantiene el flujo en 2 pasos.
