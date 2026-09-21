# corporate-app

ERP corporativo en desarrollo: gestión de personas/usuarios/roles (RBAC granular), terceros
(clientes y proveedores), flujo completo de compras (solicitud → cotización → autorización →
orden de compra → recepción) y control de activos. Arquitectura de microservicios con Docker
Compose, motor de base de datos elegido según la sensibilidad del dato (no por conveniencia), y
observabilidad (métricas + logs) desde el día uno.

> El motor elegido por dominio no es antojadizo: PII y flujo de compras van en MSSQL con
> Availability Group (consistencia fuerte), RBAC y activos en PostgreSQL (relacional, con
> replicación por streaming), catálogo de productos en MongoDB (esquema flexible, replica set) y
> sesiones/tokens en Redis (volátil, replicado).

## Estado actual

| Módulo | Estado |
|---|---|
| `corporate-infra` (bases de datos) | ✅ Construido, hardenizado y validado con instalación limpia real |
| `corporate-api` (backend) | ✅ Construido: auth, RBAC, ERP core, flujo de compras, activos (Kardex, ZPL, handover, toma de inventario), tiempo real, remuneraciones y previsión |
| `corporate-mailer` (servicio de correo) | ✅ Construido: adjuntos de OC, notificaciones, SMTP |
| `corporate-monitoring` (observabilidad) | ✅ Construido: métricas, logs, dashboards, todo detrás de TLS |
| `corporate-front` (frontend) | ✅ Construido: React 19/TypeScript/Tailwind v4, menú dinámico desde BD, activos (incl. toma de inventario), adquisiciones, solicitudes, personas, remuneraciones, previsión, permissions |
| Ambientes `prod`/`test` | ✅ Compose/Dockerfiles existen; `dev` es el único validado en clean-install real |

## Arquitectura general

Cinco proyectos Docker Compose independientes, cada uno con su propia red interna, orquestados
desde la raíz del repo. Solo `corporate-api`, `corporate-front` y `corporate-monitoring` (los tres
vía su propio NGINX) exponen puertos hacia la red corporativa; `corporate-mailer` solo tiene egreso
saliente hacia el proveedor SMTP; ningún motor de base de datos publica puertos directamente al host.

```mermaid
%%{init: {'themeVariables': {'edgeLabelBackground': '#003049'}}}%%
flowchart TB
    subgraph Cliente["Red corporativa"]
        USR[Usuario / Frontend / Insomnia]
    end

    subgraph INFRA["corporate-infra (Compose: bases de datos)"]
        direction TB
        PG[("PostgreSQL\nprimario + réplica\n(RBAC, activos)")]
        MSSQL[["MSSQL Availability Group\nprimario + secundario\n(PII, flujo de compras)"]]
        MONGO{{"MongoDB replica set (PSA)\n(catálogo de productos)"}}
        REDIS(["Redis primario + réplica\n(sesiones, refresh tokens)"])
        EXP["Exporters de cada motor\n(Postgres/Mongo/MSSQL/Redis)"]
        NGINXDB["NGINX (proxy L4/stream)"]
    end

    subgraph API["corporate-api (Compose: backend)"]
        direction TB
        NGINXAPI["NGINX (proxy L7, TLS)"]
        API1["Réplica API 1"]
        API2["Réplica API 2"]
        API3["Réplica API 3"]
    end

    subgraph MAILER["corporate-mailer (Compose: correo)"]
        direction TB
        MAILERAPI["Express API"]
        SMTPGW["Gateway SMTP (salida a internet)"]
    end

    subgraph FRONT["corporate-front (Compose: frontend)"]
        direction TB
        NGINXFRONT["NGINX (proxy L7)"]
        REACT["React 19 + TypeScript + Vite"]
    end

    subgraph MON["corporate-monitoring (Compose: observabilidad)"]
        direction TB
        NGINXMON["NGINX (proxy L7, TLS)"]
        GRAFANA["Grafana"]
        PROM["Prometheus"]
        LOKI["Loki"]
        ALLOY["Alloy (colector de logs)"]
    end

    USR -->|HTTPS| NGINXFRONT
    NGINXFRONT --> REACT
    REACT -->|HTTPS| NGINXAPI

    USR -->|HTTPS| NGINXAPI
    NGINXAPI --> API1 & API2 & API3
    API1 & API2 & API3 -->|driver nativo, credenciales via secreto| PG
    API1 & API2 & API3 --> MSSQL
    API1 & API2 & API3 --> MONGO
    API1 & API2 & API3 --> REDIS

    API1 & API2 & API3 -->|mailer-net, red interna| MAILERAPI
    MAILERAPI --> SMTPGW
    SMTPGW -->|salida internet| Internet["Internet\n(proveedor SMTP)"]

    USR -->|HTTPS| NGINXMON
    NGINXMON --> GRAFANA
    GRAFANA --> PROM
    GRAFANA --> LOKI
    PROM -.->|scrape /metrics| API1 & API2 & API3
    PROM -.->|scrape, red dedicada\nsolo llega a exporters,\nno a los motores| EXP
    ALLOY -.->|logs de contenedores| LOKI

    NGINXDB -.->|solo trafico interno,\nsin publicar al host| PG & MSSQL & MONGO & REDIS

    %% Paleta de marca (4 tonos) aplicada por CAPA/profundidad, no por
    %% servicio — con 4 colores no alcanza para "un color por tecnología"
    %% sin repetir tonos sin criterio (eso fue el efecto "arcoíris" de la
    %% iteración anterior). Cliente/Internet = afuera de la infra (claro),
    %% proxies = borde, cómputo/observabilidad = aplicación, motores de BD
    %% = el dato en reposo, el más protegido → el tono más oscuro.
    %% Los subgrafos comparten un mismo fill claro (el "contenedor Compose"
    %% como convención propia), independiente del color de sus nodos.
    classDef exterior fill:#7BF1A8,stroke:#1591DC,color:#0C0950
    classDef borde fill:#6FCF97,stroke:#161179,color:#FBE4D6
    classDef aplicacion fill:#2C5EAD,stroke:#1591DC,color:#FBE4D6
    classDef datos fill:#1591DC,stroke:#261FB3,stroke-width:2px,color:#FBE4D6

    class USR,Internet exterior
    class NGINXFRONT,NGINXAPI,NGINXMON,NGINXDB borde
    class REACT,API1,API2,API3,MAILERAPI,SMTPGW,GRAFANA,PROM,LOKI,ALLOY,EXP aplicacion
    class PG,MSSQL,MONGO,REDIS datos

    %% Los 4 motores comparten capa/color (misma criticidad) — se
    %% distinguen por FORMA de nodo (cilindro/doble-borde/hexágono/stadium,
    %% ya asignada arriba en el subgrafo INFRA) y por stroke, no por color.
    style PG stroke:#261FB3,stroke-width:2px
    style MSSQL stroke:#1B4EF5,stroke-width:2px
    style MONGO stroke:#FBE4D6,stroke-width:2px
    style REDIS stroke:#261FB3,stroke-width:2px,stroke-dasharray:4 3

    %% Todos los subgrafos con el mismo fill claro (#FBE4D6) — son el
    %% "contenedor Compose", una sola convención visual, con el color ya
    %% resuelto por los nodos que agrupan adentro.
    style Cliente fill:#D9EFBD,stroke:#7BF1A8,color:#1447E6
    style FRONT fill:#D9EFBD,stroke:#161179,color:#1447E6
    style API fill:#D9EFBD,stroke:#161179,color:#1447E6
    style MAILER fill:#D9EFBD,stroke:#161179,color:#1447E6
    style MON fill:#D9EFBD,stroke:#161179,color:#1447E6
    style INFRA fill:#D9EFBD,stroke:#161179,color:#1447E6

    %% Conectores en índigo oscuro — un rojo vivo se lee como alarma/error
    %% sobre una paleta fría, y son las aristas el elemento más repetido
    %% del diagrama (no conviene que compitan visualmente con los nodos).
    linkStyle default stroke:#07F04D,stroke-width:1.25px
```

**Cómo se levanta** (orquestador `run.ps1` en la raíz, dispatch a `corporate-scripts/*.ps1`):

```
run.ps1 bdd dev          # 1. corporate-infra: bases de datos + replicación
run.ps1 backend dev      # 2. corporate-api: migra, siembra datos base y levanta las 3 réplicas
run.ps1 mailer dev       # 3. corporate-mailer: servicio de envío de correo
run.ps1 frontend dev     # 4. corporate-front: React, sidebar dinámico desde /auth/menu
run.ps1 monitoring dev   # 5. corporate-monitoring: métricas/logs/dashboards
```

`monitoring` depende de una red externa que crea `backend` (para que Prometheus alcance a las 3
réplicas de la API por nombre) — por eso `backend` va antes. Los 3 ambientes (`dev`, `prod`, `test`)
usan el mismo comando con el sufijo ambiente: `run.ps1 backend prod`, `run.ps1 backend test`, etc.
También está `run.ps1 mongokey <ambiente>` para generar el keyfile de MongoDB, y `run.ps1 fixendline`
(sin ambiente) para corregir terminaciones de línea en Windows. El mismo `run.ps1` maneja la
promoción entre ramas (`gitpush` / `gitpr` / `pre`, requiere `gh` — ver "Promoción entre ramas" más
abajo).

Cada script de `corporate-scripts/` genera certificados TLS autofirmados y resuelve credenciales
desde `corporate-secrets/` (carpeta **excluida de git**, un archivo por credencial, montados como
Docker secrets) antes de levantar su stack — ningún valor sensible vive en el código ni en este
README, solo se referencia el mecanismo.

## Estructura del repositorio

```
corporate-app/
├── corporate-infra/       # Compose: PostgreSQL, MSSQL (AG), MongoDB (replica set), Redis, NGINX
├── corporate-api/         # Backend Express/TypeScript (DDD, tiempo real, adjuntos) — ver detalle abajo
├── corporate-mailer/      # Microservicio de correo: adjuntos OC, notificaciones, SMTP
├── corporate-monitoring/  # Compose: Prometheus, Loki, Alloy, Grafana, NGINX (TLS)
├── corporate-front/       # Frontend React 19/TypeScript/Tailwind v4 (Vite) — menú dinámico desde BD
├── corporate-scripts/     # Scripts PowerShell de orquestación (certs, secretos, arranque, promoción de ramas)
├── corporate-secrets/     # Credenciales/certificados por ambiente — excluido de git
└── run.ps1                # Punto de entrada único: stacks (<bdd|backend|mailer|monitoring|frontend> <dev|prod|test>) y git (gitpush/gitpr/pre)
```

> Este árbol muestra lo que trae el repositorio (`git clone`). Además, quien trabaje con Claude Code
> en este proyecto tiene localmente una carpeta `.claude/` (contexto, specs, roles, agentes) que
> **no se versiona** (`.gitignore`) — es configuración de esa herramienta, no parte del repo en sí.

### `corporate-api/src/` (DDD por capas)

```
src/
├── routes/         # Un router por recurso, monta permisos con authorize(resource, action)
├── controllers/     # Validación de entrada (Zod) + orquestación de la respuesta
├── services/         # Reglas de negocio, separadas por motor: mssql/ postgres/ mongo/ redis/
├── models/           # Definiciones Sequelize (mssql/, postgres/) y Mongoose (mongo/)
├── middlewares/       # authenticate, authorize, rateLimit, validate, errorHandler
├── library/           # jwt, password, pagination, búsqueda genérica, numeración de documentos, etc.
└── databases/         # Conexión + migración idempotente por motor, catálogo de permisos, seed
```

## Tecnologías

**Backend (`corporate-api`)**
- Node.js + TypeScript, Express 5
- Sequelize (PostgreSQL vía `pg`, MSSQL vía `tedious`) + Mongoose (MongoDB)
- Redis (cliente oficial `redis`) para sesiones (`express-session` + `connect-redis`) y refresh tokens
- `jsonwebtoken` (access/refresh JWT), `bcryptjs` (hash de contraseñas), `zod` (validación de esquemas)
- `helmet`, `cors`, `express-rate-limit` (seguridad HTTP)
- `pino`/`pino-http` (logging estructurado), `prom-client` (métricas Prometheus)
- `socket.io` + `@socket.io/redis-adapter` (notificaciones en tiempo real, escalado entre 3 réplicas)
- `multer` (gestión de adjuntos: órdenes de compra, recibos), `pdfkit` (generación de PDF: handover de activos)

**Frontend (`corporate-front`)**
- React 19 + TypeScript, Vite, Tailwind CSS v4
- `react-router-dom` (enrutamiento), `react-toastify` (notificaciones), `socket.io-client` (tiempo real)
- `react-icons/io5` (iconografía), `@fdograph/rut-utilities` (validación de RUT chileno)
- Menú y rutas dinámicas desde BD (`GET /auth/menu` — el menú es la autoridad de ruteo)

**Servicio de Correo (`corporate-mailer`)**
- Node.js + TypeScript, Express 5
- `nodemailer` (envío SMTP); recibe los adjuntos ya codificados (PDF en base64, dentro del body JSON)
  desde `corporate-api` — no maneja `multipart/form-data` ni tiene `multer` propio
- Red interna dedicada (`mailer-net`) con corporate-api; único contenedor del proyecto con egreso a
  internet, en una red aislada
- Redacción de credenciales en logs (`pino-http`, header `x-mailer-token` censurado — hallazgo de la
  auditoría de seguridad del 2026-08-17, mismo fix aplicado antes en `corporate-api`)

**Infraestructura (`corporate-infra`)**
- PostgreSQL (streaming replication primario/réplica)
- Microsoft SQL Server (Availability Group, read-scale, sin WSFC)
- MongoDB (replica set, topología PSA: primary-secondary-arbiter)
- Redis (replicación primario/réplica)
- NGINX como único proxy hacia las bases de datos (sin publicar puertos de los motores)

**Observabilidad (`corporate-monitoring`)**
- Prometheus (scraping de exporters de cada motor + `/metrics` de cada réplica API)
- Grafana (dashboards, servido por TLS)
- Loki + Alloy (agregación de logs de contenedores)
- NGINX como proxy TLS hacia Grafana

**Orquestación**
- Docker Compose (un stack por servicio: infra, api, mailer, monitoring, front)
- PowerShell (`corporate-scripts/`) para generación de certificados, resolución de secretos y arranque
- Redes Docker por ambiente: dev (`172.16.x.0/24`), test (`10.10.x.0/24`), prod (`10.200.x.0/24`)

## Funcionalidades implementadas

- **Autenticación híbrida**: sesión (cookie, Redis store) para clientes web y JWT access/refresh
  para clientes stateless (mobile/integraciones), aceptados indistintamente por el mismo guard.
  Rotación de refresh tokens, revocación en logout, rate limiting en login.
- **Cambio de contraseña**: auto-servicio (`/auth/change-password`, valida contraseña actual) y
  administrativo (`/users/:id/password`, requiere permiso). Historial de contraseñas (no se puede
  reutilizar ninguna de las últimas N) y política de complejidad mínima.
- **Invalidación de sesión por "watermark"**: cambiar de rol, cambiar contraseña o desactivar un
  usuario invalida de inmediato cualquier sesión/token ya emitido, sin esperar a que expire.
- **RBAC granular**: catálogo de permisos (`resource` + `action`) versionado en código, asignable
  por rol vía API; cada endpoint declara explícitamente qué permiso requiere. Menú de navegación
  dinámico (`GET /auth/menu`) que el frontend consulta para determinar rutas/sidebar en función del usuario.
- **Personas, usuarios y roles**: alta/baja/modificación con separación persona ↔ cuenta de acceso.
- **Terceros (Business Partners)**: entidad base compartida entre clientes y proveedores (sin
  duplicar razón social/RUT), con extensiones `Supplier` y `Customer` 1:1.
- **Geografía y catálogos**: países, ciudades, estados/regiones, centros de costo — datos de
  referencia sembrados automáticamente al arrancar.
- **Catálogo de productos**: en MongoDB, pensado para esquema flexible (variantes, atributos).
- **Flujo de compras end-to-end**: `PurchaseRequest → Quote → Authorization → PurchaseOrder → GoodsReceipt`,
  con máquina de estados, pasos de cotización, autorización restringida al aprobador asignado,
  numeración de documentos secuencial (folios que nunca se reutilizan), adjuntos de orden de compra,
  envío automático a proveedor vía `corporate-mailer` y tracking por orden.
- **Gestión de activos completa**: alta de activos vinculados a compra, **Kardex de valorización**
  (entrada/salida, costo promedio móvil), **impresión de etiquetas ZPL**, asignación a colaboradores,
  **flujo de entrega (handover) con PDF** generado dinámicamente, trazabilidad de movimientos
  incluyendo responsables.
- **Toma de inventario física**: un auditor abre una toma («Inicio de Inventario»), ingresa equipos
  identificándolos por **TAG** (lector USB/Bluetooth o escrito) o por **serie**, y la cierra («Fin Inventario»).
  El servidor valida si el activo existe: si existe, la toma lo **actualiza** (queda asignado al usuario
  ingresado, o el estado que indique el auditor, y en el centro de costo donde se encontró; un activo en
  devolución queda en mantención con la instrucción de enviarlo a Soporte TI / Adquisiciones TI; una baja
  encontrada en uso queda `DEVALUATED`, valor 0, sin afectar el Kardex); si no existe, se crea con una
  etiqueta nueva. Al cerrar se listan los activos del sistema no encontrados, se descarga el informe en PDF
  con los cambios aplicados y se imprimen las etiquetas nuevas (`etiquetas.txt` ZPL o WebUSB). Permiso
  `inventory-counts`, sin acceso por defecto (lo asigna el admin al rol del auditor).
- **Valorización de activos**: pantalla para Adquisiciones TI que asigna valor por primera vez a los
  activos sin valor (p. ej. los dados de alta por una toma) y registra su asiento de alta en el Kardex.
  Permiso `asset-valuation`, sin acceso por defecto.
- **Devolución de activos**: el solicitante arma una devolución de UN centro de costo, adjunta la guía de
  despacho (PDF, guardada como `DEV<centro><aaaammddHHmmssSSS>.pdf`), la imprime y la envía a Adquisiciones TI
  (los activos pasan a `MOVE_TO_RETURNED`); Adquisiciones recibe cada activo (parcial o total) y pasan a
  `RETURNED`. Permiso `asset-returns`, sin acceso por defecto; solo el solicitante o un administrador modifica una
  devolución y quien la solicitó o envió no puede recibirla. La guía es un PDF de hasta 5 MB que se sanea con qpdf al subir (sin contenido activo) y solo se descarga; se devuelven «mis equipos» (centro de costo fijado por el equipo) o equipos de otro usuario (centro de costo elegido).
  Los adjuntos (`uploads`/`downloads`) persisten en volúmenes nombrados compartidos por las 3 réplicas.
- **Notificaciones en tiempo real**: eventos de cambio de estado (`socket.io` + `@socket.io/redis-adapter`,
  escalado entre 3 réplicas) sin polling.
- **Envío de correos**: `corporate-mailer` gestiona adjuntos (PDF, facturas), notificaciones
  a proveedores y usuarios, salida SMTP aislada en su propia red Docker.
- **Multi-réplica real**: 3 instancias de la API detrás de NGINX, migraciones y seeds escritos para
  ser idempotentes y seguros frente a arranque concurrente de las 3 réplicas contra una base recién creada.
- **Remuneraciones y previsión (base)**: catálogo de instituciones previsionales (AFP, Isapres, CCAF,
  mutualidades), tasas versionadas por vigencia, afiliación de colaboradores (régimen, AFP, salud y plan
  Isapre; el modelo también contempla cargas familiares y jornada, aún sin captura en pantalla), contrato con sueldo base y gratificación legal (tipos ART47/ART50/CONVENCIONAL,
  método, porcentaje, tope, forma de pago). Configuración a nivel empresa (CCAF, mutualidad, tasa de
  accidentes, sistema de gratificación, % de anticipo mensual). El IMM se registra como parámetro
  monetario con vigencia (lo ingresa el usuario, no se precarga). **Nota:** el archivo de Previred (formato de 105 campos) y la liquidación de sueldos con
  cálculo de cotizaciones obligatorias aún no se generan; las tablas `previred_payrolls`, `previred_payroll_lines`
  y `gratification_movements` existen pero aún no se usan.

## Seguridad

- Ningún motor de base de datos publica puertos directamente; todo el tráfico externo pasa por
  NGINX (backend y monitoreo), con TLS.
- Credenciales gestionadas como Docker secrets (un archivo por credencial, fuera de git) — nunca
  hardcodeadas ni versionadas.
- Puertos publicados bindeados a la interfaz de red corporativa, no a todas las interfaces del host.
- Prometheus solo alcanza a los *exporters* de cada motor por una red dedicada, sin ruta de red
  hacia los motores de base de datos en sí.
- Auditoría de seguridad aplicada (hallazgos corregidos): exposición de puertos, cookies de sesión
  sin TLS, y una condición de carrera real en la migración de MSSQL al arrancar 3 réplicas contra
  una base vacía por primera vez.
- Todo push a `master` está bloqueado por un git hook hasta que exista una revisión de seguridad
  vigente para el commit exacto — ver [`SECURITY-GATE.md`](SECURITY-GATE.md).

## Cómo levantar el proyecto

Requiere Docker Desktop y PowerShell 7+ (y [GitHub CLI `gh`](https://cli.github.com/) solo para los
comandos de promoción entre ramas). Los 5 stacks se levantan en orden desde la raíz del repo.
Ejemplo para ambiente `dev`:

```powershell
# 1. Bases de datos (PostgreSQL, MSSQL, MongoDB, Redis)
.\run.ps1 bdd dev

# 2. Backend (3 réplicas de API + NGINX)
.\run.ps1 backend dev

# 3. Servicio de correo (SMTP, notificaciones, adjuntos)
.\run.ps1 mailer dev

# 4. Frontend (React, menú dinámico desde /auth/menu)
.\run.ps1 frontend dev

# 5. Monitoreo (Prometheus, Grafana, Loki)
.\run.ps1 monitoring dev
```

El mismo flujo funciona para `prod` y `test`:
```powershell
.\run.ps1 bdd prod
.\run.ps1 backend prod
.\run.ps1 mailer prod
.\run.ps1 frontend prod
.\run.ps1 monitoring prod
```

Comandos adicionales:
```powershell
.\run.ps1 mongokey <ambiente>   # Generar keyfile de MongoDB para el ambiente
.\run.ps1 fixendline            # Corregir terminaciones de línea (Windows)
```

### Promoción entre ramas (`gitpush` / `gitpr` / `pre`)

El mismo `run.ps1` centraliza el flujo `develop → testing → master` para no olvidar pasos
(actualizar la rama, pushear, poner etiquetas, no duplicar PRs).

```mermaid
flowchart TD
    feat["feature/*"]

    subgraph DEV ["desarrollo"]
        dev(["rama develop"])
    end
    subgraph TST ["pre-productivo"]
        test(["rama testing"])
    end
    subgraph PRD ["produccion"]
        rel(["rama release/master<br/>intermedia, ya limpia"])
        prod(["rama master"])
    end

    feat -->|PR normal| dev
    dev -->|"run.ps1 gitpush dev  (commit + push)"| dev
    dev -->|"run.ps1 gitpr testing dev  /  run.ps1 pre testing"| pr1{{"PR develop &rarr; testing"}}
    pr1 -->|review + merge| test

    test -->|"run.ps1 pre prod  &rarr;  promote-to-master.ps1<br/>merge testing sobre master +<br/>saca rutas de master-excluded-paths.txt"| rel
    rel --> pr2{{"PR release/master &rarr; master"}}
    pr2 --> ci{"CI Guardia de master:<br/>toca alguna ruta excluida?"}
    ci -->|si| block["check falla<br/>no se puede mergear"]
    ci -->|no| approve["review + approval<br/>de quien opera prod"]
    approve -->|merge| prod

    block -.->|"sacar el archivo del PR o ajustar el patron"| pr2
```

**Requiere [GitHub CLI (`gh`)](https://cli.github.com/) con sesión iniciada.** `gh` ya está instalado
en este equipo (`winget install --id GitHub.cli`); si lo instalás en otro, abrí una terminal nueva
para que tome el PATH. Iniciá sesión una sola vez:

```powershell
gh auth login          # GitHub.com → SSH (o HTTPS) → login con el navegador
```

```powershell
.\run.ps1 gitpush dev "fix: valida el RUT en el alta de proveedor"
#   commit de lo pendiente (si hay) + git push origin develop. Sin mensaje solo pushea.
.\run.ps1 gitpush testing "hotfix aprobado por QA"     # idem sobre la rama testing

.\run.ps1 gitpr testing dev
#   PR develop → testing (etiquetas release,testing + checklist). Reusa el PR si ya hay uno abierto.

.\run.ps1 pre testing
#   Atajo: git checkout develop + pull + push + PR develop → testing.

.\run.ps1 pre prod "sprint 12"
#   Corre promote-to-master.ps1 (arma release/master ya sin rutas de solo-testing) y abre el
#   PR release/master → master. master NUNCA recibe push ni PR directo desde testing.
```

Detalle del modelo de ramas, exclusiones de `master` y branch protection: **[`CONTRIBUTING.md`](CONTRIBUTING.md)**.

Cada script resuelve por su cuenta las credenciales/certificados que necesita (ver
`corporate-scripts/`); no requieren configuración manual adicional más allá de tener
`corporate-secrets/` poblado para el ambiente elegido.

## Validación por ambiente

Los tres ambientes (`dev`/`test`/`prod`) están levantados y verificados **simultáneamente, en vivo,
sin colisión entre ellos** (redes/puertos/volúmenes/secrets aislados por ambiente) — última
verificación end-to-end: 2026-08-28. Para cada uno se confirmó, con `curl` real contra el puerto TLS
publicado (no solo `docker compose ps`):

| Chequeo | dev | test | prod |
|---|---|---|---|
| `GET /health` vía NGINX → 3 réplicas de API | ✅ 200 | ✅ 200 | ✅ 200 |
| Frontend (SPA compilada) sirve `index.html` | ✅ 200 | ✅ 200 | ✅ 200 |
| Proxy `front → api` sin sesión (`/api/auth/me`) | ✅ 401 | ✅ 401 | ✅ 401 |
| Grafana alcanzable a través de su NGINX | ✅ 302 | ✅ 302 | ✅ 302 |
| Headers de seguridad (CSP/X-Frame-Options) en la SPA | ✅ | ✅ | ✅ |
| HSTS en la SPA (solo aplica a `test`/`prod`, `dev` no lo envía a propósito) | n/a | ✅ | ✅ |

`test` se levantó por primera vez de punta a punta en esta pasada (antes solo estaba validado con
`docker compose config`/`docker build`, nunca un `up` real); `prod` ya se había levantado una vez el
2026-08-18, pero el stack de `monitoring` había quedado bloqueado ese día por agotamiento del pool de
redes de Docker Desktop — hoy, con menos redes activas en el host, `monitoring prod` subió sin ese
problema, así que los 5 stacks de `prod` están confirmados completos por primera vez.

**Hallazgo real encontrado y corregido durante esta verificación**: el header `Strict-Transport-Security`
no llegaba a la SPA (`location /` en `nginx.conf.prod.template`) aunque sí estaba declarado en el
`server {}` — `add_header` en NGINX no hereda de un bloque superior cuando el bloque interno define
sus propios `add_header` (que es el caso de `location /`), así que el HSTS solo llegaba a `/api/`
(que no declara los suyos propios) y nunca a la página que carga cualquier navegador. Este tipo de bug
no lo detecta `nginx -t` ni la validación de sintaxis — solo se ve pegándole con `curl -D` a la
respuesta real. Corregido repitiendo el `add_header` de HSTS dentro de `location /`; reconstruido y
reverificado en vivo en `test` y `prod`.

**Nota operativa**: el primer `run.ps1 backend test`/`run.ps1 backend prod` contra una base de datos
recién creada puede devolver código de salida 1 por agotar el presupuesto de `--wait-timeout 300`
mientras las 3 réplicas de la API compiten por el lock de migración de MSSQL (la misma condición de
carrera ya documentada, mitigada por `restart: always`) — un segundo `docker compose up --wait`
inmediatamente después converge limpio, sin intervención adicional. No es un fallo del stack, es el
timeout de espera siendo corto para un arranque en frío.

## Ramas y flujo de contribución

Cada ambiente tiene su rama: `develop` (desarrollo) → `testing` (pre-productivo) → `master`
(producción). `master` nunca recibe tests unitarios/integración ni configuración propia de `test`/`dev`
— la promoción `testing → master` pasa por un script que arma una rama intermedia ya limpia, y un
chequeo de CI que bloquea el Pull Request si algo prohibido igual se cuela. Detalle completo,
incluyendo cómo configurar accesos por rama en GitHub: **[`CONTRIBUTING.md`](CONTRIBUTING.md)**.

El día a día se maneja con `run.ps1` (necesita `gh` con sesión, ver "Promoción entre ramas"):
`gitpush dev "msg"` (commit + push), `gitpr testing dev` (PR `develop → testing`), `pre prod`
(promoción + PR `release/master → master`).

**Pipeline corrido de punta a punta por primera vez el 2026-08-28** (PR #7 `develop → testing`, PR #8
`release/master → master`): `master` estaba desde antes de esta política casi como un espejo de
`develop` (arrastraba los 10 `compose.dev.yml`/`compose.test.yml` de los 5 stacks y los 20 archivos de
test/`vitest.config.ts`) — se hizo una limpieza retroactiva de esos 30 archivos como parte de esta
primera promoción. Verificado en vivo con `git ls-tree` sobre `origin/master`: **cero** rutas de la
lista de exclusión presentes. De ahora en más cada promoción pasa por el mismo script y el mismo
chequeo de CI, así que `master` no debería volver a acumular esto sin que el PR falle primero.

## Limitaciones conocidas y notas de desarrollo

- **Ambientes `prod`/`test`**: `compose.prod.yml`/`compose.test.yml` existen en los 5 stacks y ya se
  verificaron en vivo (ver "Validación por ambiente" arriba) — ya no es solo `dev` el validado. Sigue
  siendo cierto que el uso continuo/prolongado (no solo un boot puntual) está mejor probado en `dev`.
- **Frontend**: `corporate-front` está en desarrollo activo; el layout y páginas cubren activos,
  adquisiciones, solicitudes, personas, remuneraciones, previsión y permissions. Pueden existir placeholders o páginas no
  totalmente implementadas en módulos específicos.
- **Scripts de arranque y `--build`**: algunos scripts de `corporate-scripts/` no pasan `--build` al
  levantar un Compose, lo que significa que cambios en Dockerfiles/templating no se reconstruyen
  automáticamente. Ejecutar `docker compose down -v` y relanzar si hay cambios de imagen no detectados.
- **pnpm en Docker Windows**: pnpm dentro de Dockerfiles en este host (Windows + WSL2) genera symlinks
  rotos. Los Dockerfiles usan `npm` en lugar de `pnpm` para evitarlo — `pnpm` sigue siendo el gestor
  del lado del host (`pnpm-lock.yaml`).
- **Permisos nuevos para crear colaboradores**: el alta de colaboradores ahora requiere tres permisos
  nuevos (`employee-contracts:create`, `previsional-institutions:read`, `previsional-profiles:update`)
  además de los anteriores. Solo el rol `admin` los tiene por defecto; otros roles deben recibirlos
  explícitamente vía `PUT /roles/:id/permissions`. Los usuarios que ya tenían sesión iniciada deben
  re-loguearse para que el backend actualice sus permisos y el menú refleje las nuevas opciones.
- **Desarrollo con hot-reload de la API**: guardar cambios en `corporate-api/src/databases/mssql/migrate.ts`
  dispara automáticamente la migración contra la BD de desarrollo compartida entre las 3 réplicas.
  Conviene probar el DDL antes en un SQL Server desechable (por ejemplo, un contenedor local) y recién después guardar el archivo.
- **Fechas DATEONLY en zonas horarias no UTC**: fuera de contenedores (ej. máquina con zona horaria -03),
  Sequelize puede desplazar un día las fechas de columnas `DATEONLY`; dentro de Docker (UTC) no ocurre.
- **Gestión de contratos existentes**: no existe pantalla para listar o editar contratos ya creados;
  tampoco se pueden actualizar apellido materno, sexo y nacionalidad de personas ya existentes. Un
  colaborador creado con tipo de gratificación `ANTICIPO_MENSUAL_RELIQUIDACION` antes de que existiera
  la columna `gratification_monthly_advance` quedará sin monto asignado y hoy no hay cómo completarlo desde la interfaz.
