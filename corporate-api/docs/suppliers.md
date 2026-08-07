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

Guardar `data.id` — es el `businessPartnerId` que se usa en el paso 3.

## Paso 2 — Obtener los `id` de tipo de servicio y condición de entrega

`serviceType`/`deliveryTerms` **no son strings libres ni un enum fijo**: son catálogos abiertos
(tablas lookup, ver "Nota de diseño" al final), pensados para poder agregar valores nuevos sin
tocar código ni redeployar. El frontend debe poblar sus combos/selects consultando estos 2
endpoints — ambos de solo lectura para cualquier autenticado, sin permiso especial:

`GET /api/supplier-service-types`
```json
{
  "codigo": 200,
  "message": "Tipos de servicio de proveedor obtenidos exitosamente",
  "data": { "items": [
    { "id": 1, "code": "ARRIENDO", "name": "Arriendo" },
    { "id": 2, "code": "SERVICIOS", "name": "Servicios" },
    { "id": 3, "code": "COMPRAS", "name": "Compras" }
  ], "pagination": { "totalItems": 3 } }
}
```

`GET /api/supplier-delivery-terms`
```json
{
  "codigo": 200,
  "message": "Condiciones de entrega de proveedor obtenidas exitosamente",
  "data": { "items": [
    { "id": 1, "code": "ORDEN COMPRA", "name": "Orden de compra" },
    { "id": 2, "code": "CONTRA FACTURA", "name": "Contra factura" },
    { "id": 3, "code": "CREDITO", "name": "Crédito" }
  ], "pagination": { "totalItems": 3 } }
}
```

Estos son los valores sembrados por defecto (ids reales de tu ambiente, no asumir que son
siempre 1/2/3). Si necesitas un valor nuevo (ej. un tipo de servicio distinto), créalo con
`POST /api/supplier-service-types` (permiso `supplier-service-types:create`, body
`{ "code": "...", "name": "...", "description"?: "..." }`) o su equivalente
`POST /api/supplier-delivery-terms` — no requiere tocar el backend.

## Paso 3 — Crear el Supplier

`POST /api/suppliers`
Permiso requerido: `suppliers:create`

### Body

| Campo | Obligatorio | Tipo / validación |
|---|---|---|
| `businessPartnerId` | **Sí** | number, entero positivo. Debe existir y no estar ya asociado a otro proveedor (relación 1:1) |
| `serviceTypeId` | **Sí** | number, entero positivo. Debe existir en `supplier_service_types` (paso 2) |
| `deliveryTermsId` | **Sí** | number, entero positivo. Debe existir en `supplier_delivery_terms` (paso 2) |
| `paymentTermDays` | No | number, entero ≥ 0 |

```json
{
  "businessPartnerId": 1,
  "serviceTypeId": 3,
  "deliveryTermsId": 1,
  "paymentTermDays": 30
}
```

Body mínimo (sin `paymentTermDays`):

```json
{ "businessPartnerId": 1, "serviceTypeId": 2, "deliveryTermsId": 2 }
```

### Respuesta (201)

```json
{
  "codigo": 201,
  "message": "Proveedor creado exitosamente",
  "data": {
    "id": 1,
    "businessPartnerId": 1,
    "serviceTypeId": 3,
    "deliveryTermsId": 1,
    "paymentTermDays": 30,
    "businessPartner": { "id": 1, "legalName": "Distribuidora Los Andes SpA", "nationalId": "76543210-1", "businessLine": "Distribución de insumos" },
    "serviceType": { "id": 3, "code": "COMPRAS", "name": "Compras" },
    "deliveryTerms": { "id": 1, "code": "ORDEN COMPRA", "name": "Orden de compra" }
  }
}
```

`GET /api/suppliers` y `GET /api/suppliers/:id` devuelven la misma forma embebida (
`businessPartner`, `serviceType`, `deliveryTerms` como objeto completo, no solo el id) — el
frontend no necesita una segunda consulta para mostrar el nombre en español.

### Errores esperables en el paso 3

Todas las respuestas de error usan la misma forma `{ codigo, message, details? }`.

| Caso | `codigo` | `message` |
|---|---|---|
| `businessPartnerId` no existe | 404 | `El tercero <id> no existe` |
| El business partner ya es proveedor | 409 | `El tercero <id> ya es proveedor` |
| `serviceTypeId` no existe | 404 | `El tipo de servicio de proveedor <id> no existe` |
| `deliveryTermsId` no existe | 404 | `La condicion de entrega de proveedor <id> no existe` |
| Body no cumple el schema (falta campo, id no numérico) | 400 | detalle de validación en `details` |

## Actualizar un proveedor existente

`PUT /api/suppliers/:id` (permiso `suppliers:update`) acepta los mismos campos **excepto**
`businessPartnerId` (no se puede reasignar el business partner de un proveedor ya creado), todos
opcionales.

## Nota de diseño

**Combinar business partner + supplier en un solo endpoint**: se evaluó y se descartó a
propósito — forzaría crear un `BusinessPartner` nuevo en cada alta, rompiendo la reutilización
entre clientes y proveedores, e introduciría el riesgo de duplicar una empresa que ya existe. Se
mantiene el flujo en pasos separados.

**`serviceType`/`deliveryTerms` como tablas lookup, no como enum fijo**: los valores originales
(`LEASE`/`SERVICE`/`SALE`, `ON_PURCHASE_ORDER`/`ON_INVOICE`) vivían como un `CHECK` constraint en
la base de datos + un enum de validación en el backend — agregar un valor nuevo requería editar
código en 3 lugares y correr una migración de esquema. Se migró al mismo patrón que ya usan los
estados de activo (`asset_statuses`): una tabla de catálogo con `code`/`name`, con su propio
CRUD (`/supplier-service-types`, `/supplier-delivery-terms`), sin `ENUM`/`CHECK` hardcodeado. El
`code`/`name` de los valores sembrados por defecto está en español a propósito, para que el
frontend no tenga que traducir nada.
