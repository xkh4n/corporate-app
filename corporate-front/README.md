# corporate-front — Frontend del ERP

Frontend React/TypeScript del ERP corporativo, responsable de la interfaz de usuario para gestión de personas, terceros, compras y activos. Parte del monorepo `corporate-app` — ver [`../README.md`](../README.md) para contexto general de arquitectura y orquestación.

## Stack real

- **React** 19.2 + **TypeScript** 5.9 + **Vite** 8.2 (bundler)
- **Tailwind CSS** v4 (estilos)
- **react-router-dom** 7.x (enrutamiento; menú/rutas dinámicas desde `GET /auth/menu`)
- **react-toastify** (notificaciones al usuario)
- **socket.io-client** (notificaciones en tiempo real vía WebSocket)
- **react-icons/io5** (iconografía)
- **@fdograph/rut-utilities** (validación de RUT chileno)
- **ESLint + TypeScript ESLint** (linting), **Vitest** (testing)

## Lugar en el monorepo

Dockerizado con `compose.dev.yml` / `compose.prod.yml` / `compose.test.yml` (solo `dev` validado en clean-install). Se levanta desde la raíz:

```powershell
.\run.ps1 frontend dev   # Vite + NGINX (dev)
.\run.ps1 frontend prod  # Bundle estático + NGINX (prod)
.\run.ps1 frontend test  # Bundle estático + NGINX (test)
```

No publica puertos directamente — siempre detrás de `nginx-frontdev/prod/test`, que termina TLS y proxea `/api/` hacia `corporate-api` (misma red dedicada `frontapi-net` usada por todas las conexiones a la API).

## Estructura de `src/`

```
src/
├── auth/           # Autenticación: contexto (AuthContext, useAuth hook)
├── components/     # Componentes reutilizables (ui/ para átomos, Toast/, SidebarMenu, etc.)
├── layouts/        # AppLayout (layout principal, con SidebarMenu)
├── lib/            # apiClient (cliente HTTP base), socket (singleton socket.io), menu (aplana
│                   #   el árbol de GET /auth/menu), labelary/zplPrinting (ver nota en "activos"
│                   #   más abajo), Errors/ (CustomError), Validations/, query helpers
├── notifications/  # Lógica de notificaciones en tiempo real (socket.io)
├── pages/          # Páginas por módulo funcional (ver abajo)
├── routes/         # AppRoutes (definición de árbol de rutas), ProtectedRoute (guard de sesión)
├── services/       # Servicios HTTP (uno por dominio de la API, ~32 servicios)
├── types/          # Un archivo por dominio, en espejo con services/ (auth, user, role, permission,
│                   #   businessPartner, purchaseRequest, asset, webusb.d.ts, etc.)
├── assets/         # Imágenes (logos, etc.)
├── index.css       # Estilos globales + Tailwind
└── main.tsx        # Punto de entrada
```

### `pages/` — módulos funcionales

- **`login/`** — LoginPage, ChangePasswordPage (autenticación)
- **`dashboard/`** — Vista de inicio (DashboardPage)
- **`adquisiciones/`** — Gestión de compras:
  - `proveedores/` → CreateBusinessPartner
  - `productos/` → ListProducts, CreateProducts
  - `category/` → CreateProductCategory, ViewProductCategory, UpdateProductCategory
  - `supplierProducts/` → LinkSupplierProducts
- **`solicitudes/`** — Flujo de compras end-to-end:
  - CreateRequest, RequestQuotation, AproveRequest (autorización)
  - SendPurchaseOrder, AttachPurchaseOrder, UploadQuotes, ApproveQuote
  - ReceiveGoods (recepción de bienes)
  - RequestAssetStatus
- **`personas/`** — Gestión de personas y roles:
  - ListarRole, CrearPersona, NuevoCargo
- **`permissions/`** — RBAC (gestión de permisos y roles):
  - NuevoRole, AsignarPermissionToRole
- **`pantallas/`** — Gestión de pantallas y permisos:
  - NuevaPantalla, AsignarPermisos
- **`activos/`** — Control de activos:
  - PrintAssetLabels (impresión de etiquetas ZPL) — imprime **desde el navegador vía WebUSB**
    (`lib/zplPrinting.ts`), no desde el backend: las 3 réplicas de `corporate-api` viven en redes
    `internal: true`, sin salida a la LAN donde está la impresora Zebra. El preview PNG del ZPL antes
    de imprimir usa la API pública de Labelary (`lib/labelary.ts`), también desde el navegador.
  - AssetKardex (kardex de valorización)
  - AssignAsset (asignación a colaboradores)
- **`forbidden/`** — Error 403 (acceso denegado)
- **`module-placeholder/`** — Componente reutilizable para módulos no implementados

### `services/` — API (agrupados por dominio)

- **RBAC** → roleService, permissionService, userService, menuItemService (login/sesión no pasa por
  `services/` — `auth/AuthContext.tsx` llama directo a `/auth/me`, `/auth/menu`, login/logout vía
  `lib/apiClient.ts`, no hay un `authService.ts` dedicado)
- **Terceros (Business Partners)** → businessPartnerService, supplierService, customerService, supplierContactService
- **Personas y Catálogos** → personService, employeeService, positionService, addressService, costCenterService
- **Geografía** → countryService, stateService, cityService
- **Productos** → productService, productCategoryService, supplierProductService
- **Proveedores (catálogos)** → supplierServiceTypeService, supplierDeliveryTermsService
- **Compras** → purchaseRequestService, purchaseRequestLineService, purchaseOrderService, quoteService, authorizationService, goodsReceiptService
- **Activos** → assetService, assetKardexService, assetMovementService, assetStatusService
- **Tiempo real** → notificationService (socket.io)

## Cómo levantarlo — dos formas reales

### 1. **Bare-metal (`pnpm dev`)** en el host

Requiere acceso a `corporate-secrets/` (carpeta hermana fuera de este repo, poblada con credenciales y certificados):

```powershell
# En corporate-front/
pnpm install
pnpm dev
```

Vite levanta:
- **HTTPS propio** via `@vitejs/plugin-basic-ssl` (certificado autofirmado en memoria)
- **Proxy propio de `/api`** hacia `corporate-api` (lee `ALLOCATED_IP` y `API_SSL_PORT` desde `../corporate-secrets/{Environment,Development}/.env`)
- **WebSocket proxy** para socket.io (`ws: true` — notificaciones en tiempo real)

Acceso: `https://localhost:5173` (el navegador reclama el certificado autofirmado — es normal en dev).

### 2. **Docker (`run.ps1 frontend dev`)** con hot-reload real

```powershell
# Desde corporate-app/ (raíz del monorepo)
.\run.ps1 frontend dev
```

Levanta dos contenedores:
- **`frontenddev`** — Vite dev server en HTTP plano (sin TLS propio, sin proxy)
- **`nginx-frontdev`** — NGINX que:
  - Termina TLS (certificado autofirmado)
  - Proxea `/` hacia Vite
  - Proxea `/api/` hacia `nginx-apidev` (stack `corporate-api`, vía red compartida `frontapi-net`)
  - Soporta WebSocket para HMR y socket.io

Vite detecta que corre con `DOCKER_DEV=true` (inyectado por compose.dev.yml) y se autoconfigura para:
- Bindear a `0.0.0.0:5173` (alcanzable por NGINX dentro de Docker)
- HMR apuntando a `wss://host:${FRONT_SSL_PORT}` (ve el puerto/protocolo que el navegador ve, no el interno)
- Watch con `usePolling: true` (workaround para inotify en Docker Desktop/Windows)

Acceso: `https://${ALLOCATED_IP}:${FRONT_SSL_PORT}` (resuelto desde `corporate-secrets/`).

**Ventaja:** Hot reload funciona — cambios en archivos se reflejan al instante sin rebuild. Una sola réplica de Vite a propósito (el HMR tiene estado por conexión).

## Cómo se conecta con el backend

### Menú dinámico — la autoridad de ruteo

No hay rutas/sidebar hardcodeadas. Al loguear, la API retorna `GET /auth/menu` con un árbol de navegación podado por permisos:

```typescript
// Estructura simplificada
const menu = [
  { id: "dashboard", label: "Dashboard", path: "/dashboard", ... },
  { id: "adquisiciones", label: "Adquisiciones", children: [...] },
  { id: "activos", label: "Activos", children: [...] },
  ...
]
```

El frontend consume este menú (`menuItemService.getMenuItems()`) y genera dinámicamente:
- Rutas en `AppRoutes.tsx`
- Sidebar (`SidebarMenu.tsx`)

Si el usuario no tiene permiso para un módulo, simplemente no aparece en el menú ni se puede acceder por URL directa (guard de sesión en `ProtectedRoute.tsx`).

### Proxy de `/api`

- **Bare-metal:** Vite proxea `/api` → `https://${ALLOCATED_IP}:${API_SSL_PORT}` (credenciales desde `corporate-secrets/`)
- **Docker dev:** NGINX proxea `/api` → `nginx-apidev:80` (red interna `frontapi-net`)
- **Prod/test:** NGINX proxea `/api` → bundle estático del backend o balanceador

Todas las llamadas pasan por `services/*Service.ts` (y por `AuthContext.tsx` para auth), que usan el
cliente HTTP base compartido `lib/apiClient.ts` (maneja errores vía `ApiError` y el handler de 401).

### Notificaciones en tiempo real

Socket.io (`socket.io-client` + `@socket.io/redis-adapter` en backend):
- Cambios de estado en documentos (compras, activos, etc.) se emiten desde la API
- Frontend escucha eventos y actualiza UI sin polling
- WebSocket atraviesa el proxy de Vite/NGINX (ambos soportan upgrade de conexión)

## Scripts de `package.json`

```bash
pnpm dev          # Inicia Vite dev server (bare-metal)
pnpm build        # Bundle para producción (en Dockerfile, genera dist/)
pnpm lint         # Ejecuta ESLint (typescript-eslint, react rules)
pnpm preview      # Sirve el bundle dist/ localmente (sin vite dev server)
pnpm test         # Ejecuta Vitest (test runner)
```

## Autenticación

Dos mecanismos aceptados por el backend indistintamente:

1. **Sesión (cookie + Redis store)**
   - Flujo web estándar: login → cookie de sesión → enviada automáticamente en cada request
   - Logout invalida sesión en Redis

2. **JWT (access + refresh)**
   - Para clientes stateless (mobile, integraciones)
   - El frontend siempre usa sesión (cookies) — JWT es para otros clientes

Cambio de contraseña obliga al usuario a volver a autenticarse (invalida sesión por "watermark"). Cambio de rol también invalida sesiones ya emitidas (sin esperar expiración).

## Composición en Docker (compósición simplificada)

```yaml
# compose.dev.yml
services:
  frontenddev:        # Vite dev server (1 réplica)
    build: Dockerfile.dev
    volumes:
      - ./src:/app/src    # Hot reload
      - /app/node_modules
    networks: [internal]  # Red interna con NGINX solo

  nginx-frontdev:     # NGINX (TLS + reverse proxy)
    build: nginx/
    ports:
      - "${ALLOCATED_IP}:${FRONT_SSL_PORT}:443"
    networks:
      - internal        # Llega a Vite dev server
      - frontend-net    # Publicado al host
      - frontapi-net    # Acceso a corporate-api

networks:
  internal:           # Privada (Vite ↔ NGINX)
    internal: true
  frontend-net:       # Externa (NGINX → host/users)
    external: true
  frontapi-net:       # Compartida (NGINX → corporate-api)
    external: true
```

## Notas de desarrollo

- **TypeScript:** para un type-check real usa `tsc -p tsconfig.app.json --noEmit` — el `tsconfig.json`
  de la raíz es solution-style; un `tsc --noEmit` a secas contra él es un no-op silencioso.
- **Tailwind v4 con `@tailwindcss/vite`** — no es la extensión de PostCSS antigua, es más moderna y se integra con Vite.
- **ESLint + react-hooks:** mantener `eslint-plugin-react-hooks` en `^7.x` — la v6 rompe `npm install`
  dentro de Docker en este proyecto.
- **Menú dinámico:** si la API cambia `menu_items` en BD, el frontend se entera en el próximo `GET /auth/menu` (no requiere redeploy del frontend).
- **Módulos en `pages/`:** algunos están completos (login, dashboard, adquisiciones, activos, solicitudes), otros pueden ser placeholders. No hay garantía de paridad entre lo que promete el menú y la implementación actual — verificar caso a caso.
- **`corporate-secrets/` no viene en el repo** — ver README raíz, sección "Cómo levantar el proyecto", para cómo prepararlo.
- **Ambientes `prod`/`test`:** existen Dockerfiles y Compose, pero solo `dev` ha sido validado en clean-install real. Ajustar configuración de redes/puertos según necesidad antes de usar en ambientes no dev.

## Integración con otros stacks

| Stack | Red | Propósito |
|---|---|---|
| `corporate-api` | `frontapi-net` (NGINX solo) | `/api`, `/auth/menu`, socket.io |
| `corporate-mailer` | Indirecta (vía API) | Notificaciones de correo (no consume directamente) |
| `corporate-monitoring` | Ninguna | El frontend no expone `/metrics` |

## Contribución

- PRs contra `develop` (rama por defecto)
- Lint antes de commit (`pnpm lint`)
- Servicios nuevos → carpeta `services/`, en función del dominio (no al azar)
- Nuevas páginas → carpeta `pages/` con subfolder del módulo
- Estilos → Tailwind classes (no CSS files nuevos, sino en casos excepcionales)
- Tipos → `types/` con *.ts (no inline en componentes)

Ver README raíz para política de versionamiento y ramificación.
