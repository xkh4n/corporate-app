# Historial de avances (`.claude/README.md`)

Bitácora de lo que se va construyendo, en orden cronológico inverso (lo más nuevo arriba). Sirve de
insumo para actualizar el `README.md` raíz: el agente de documentación lee esta bitácora, **verifica
cada dato contra el código** y recién entonces lo lleva al README público.

Flujo de cada bloque de trabajo: (1) memoria de Claude al día → (2) nueva entrada acá → (3) contexto de
agentes al día en [`context/README.md`](context/README.md) → (4) agente `documentation-engineer` actualiza el
`README.md` raíz → (5) commits en `develop`.

Convenciones de esta bitácora: una entrada por bloque de trabajo, fechada; no se reescriben entradas
viejas (si algo cambia, se agrega una entrada nueva que lo diga); cada entrada separa *hecho*,
*decisiones*, *verificación* y *pendiente*. Nombres de backend en inglés, UI en español.

> Estado del repositorio: lo descrito de la entrada 2026-09-20 quedó commiteado en `develop` como
> `a2d572f` (API), `fd57450` (front) y `36442e0` (README raíz). De `.claude/` solo este README
> está versionado; el resto (orquestador, roles, skills, specs) sigue sin versionar hasta que el usuario lo revise.

---

## 2026-09-24 (3) — Correcciones de seguridad detectadas en el plan 000 (despliegue actual)

### Hecho
- **IP real del cliente en el rate-limit:** antes, todo el que entraba por el front compartía un solo contador.
  - En nginx-api: `set_real_ip_from ${FRONTAPI_SUBNET}` + `real_ip_header X-Forwarded-For` + `real_ip_recursive on`.
  - Nueva variable `FRONTAPI_SUBNET` en el `.env` de cada ambiente (`172.16`, `10.10` y `10.200` `.13.0/24`). Coincide con la subred que crea `run.ps1`/`run.sh`, y ambos lados llevan un comentario de sincronía.
  - El acceso directo a nginx-api (Insomnia) sigue ignorando el `X-Forwarded-For`.
- **SMTP:** `corporate-mailer/src/library/mailer.ts` pasa a `secure` solo en el puerto 465 y `requireTLS` en los demás, con `minVersion TLSv1.2`, `servername` y `rejectUnauthorized`.
- **Redis:** usuario ACL propio para la API.
  - En Redis: `REDIS_APP_USER`+SUFFIX (dev `rachaeldev`, test `pristest`, prod `roybattyprod`), con `~* &* +@all -@admin -@dangerous`, y un secreto nuevo `redis_app_password.txt` por ambiente.
  - En la API: `REDIS_USER` en `env.ts` y `connection.ts`. Los compose de la API ya no montan `redis_password` (el de administrador).
  - Se agregó el secreto nuevo a `ensure-infra-secrets.{ps1,sh}` y el usuario a `.env.test` y `.env.test.example`.

### Verificación (dev)
- **Redis del usuario de la API:**
  - Funcionan `PING`, `SELECT`, `CLIENT SETINFO`, `EVAL`, `SCAN` y `PUBSUB`.
  - `CONFIG`, `FLUSHALL`, `INFO`, `ACL` y `SHUTDOWN` responden NOPERM.
  - La API corre con 9 conexiones `user=rachaeldev`, y el ACL LOG quedó vacío después de reiniciarla.
- **Login con `X-Forwarded-For: 203.0.113.x` falsificado:**
  - Por el front, la clave del contador fue `rl:172.16.14.1`: ni la IP falsificada ni la de nginx-front (`172.16.13.3`).
  - Directo a nginx-api, fue `rl:172.16.11.1`.
  - Las claves de prueba se borraron.
- **SMTP:** `transporter.verify()` contra Gmail con TLS obligatorio respondió OK, sin enviar correo.
- **Chequeos:** `tsc` de la API y del mailer OK; unit tests de la API: 111 correctos.

### Pendiente
- **Docker Desktop no conserva la IP de origen:** nginx-front ve a cualquier cliente externo como el gateway de `frontend-net` (`172.16.14.1`). En este host todos los navegadores siguen compartiendo un contador, ahora por limitación de Docker Desktop y no de nginx. En Linux con `userland-proxy: false` se ve la IP real (plan 000, §9.4).
- **Testing:** el Redis de Testing tiene que recrearse (`run.ps1 bdd test`) para que exista `pristest` antes de correr los tests de integración.
- **Producción:** hay que recrear Redis y la API con `run.ps1 bdd prod` y `run.ps1 backend prod`.

---

## 2026-09-24 (2) — Plan de distribución en varios servidores (plan 000, solo análisis)

### Contexto
El usuario pidió evaluar cómo separar infra, api, front y mailer en servidores anfitriones distintos: compose,
redes, volúmenes, proxies y variables de entorno. Es para presentarlo a evaluación y estudiarlo antes de
implementarlo. Plan: `.claude/planes/000-Distribución de Corp en varios servidores.html`.

### Hecho
- Análisis en paralelo de tres agentes (`devops-engineer`, `security-engineer`, `infrastructure-maintainer`),
  integrado en un solo plan. No se modificó código.
- Donde los agentes discrepaban, se decidió así:
  - Monitoreo por agente Alloy en cada host, que empuja a MON. Se descartó publicar los exporters, porque no tienen autenticación.
  - Dominio `corp.internal` en vez de `.local`, que choca con mDNS.
  - El mailer va en su propio host, como se pidió, y la co-ubicación con la API queda como alternativa.
- Corrección al análisis previo en el chat: en producción la API **sí** descubre el replica set de Mongo
  (`MONGO_DIRECT_CONNECTION` no está definida y vale `false`). Distribuido, necesita `directConnection=true` o miembros por FQDN.
- Corrección a la propuesta de DevOps: las anclas YAML (`x-api-common`) no cruzan archivos compose, así que el
  override tiene que sobrescribir cada servicio `api0Nprod`.

### Hallazgos que el plan deja registrados (existen hoy, no los crea la distribución)
- No hay respaldos ni Alertmanager.
- MSSQL corre en edición Developer.
- El tráfico a las bases de datos va en texto plano (Postgres `ssl:false`, MSSQL `trustServerCertificate:true`).
- STARTTLS del SMTP es oportunista.
- La API usa el usuario `default` de Redis.
- `certs/` se monta completo y en modo lectura-escritura en los contenedores MSSQL.
- `db_gui_password` no tiene uso.
- Detrás del front, todos los usuarios comparten un solo contador de rate-limit en el login.

### Pendiente
- Decisiones D1 a D9 del plan: dominio interno, licencia de MSSQL, ubicación del mailer, registro de imágenes, DB02,
  uploads en S3, retención legal, acceso directo tipo Insomnia, rotación de JWT.
- Piloto de latencia api→bases de datos antes de comprometer la topología.

---

## 2026-09-24 — Auditoría de seguridad del delta desde el 17/09 (ping-pong) y mitigaciones

### Contexto
Desde la auditoría completa del 2026-09-17 (commit `9675f6b`) entraron 212 archivos, más el plan 008 sin commitear.
`cybersecurity-orchestrator` y `security-engineer` auditaron el mismo alcance cada uno por su lado; los hallazgos
en que no coincidieron se verificaron a mano. Informes en
`C:\Users\Equipamiento\security-audit-skill\corporate-app\run-2\` (`REPORT.md` es el consolidado).

### Hallazgos confirmados y mitigados
El orquestador no reportó ningún hallazgo; `security-engineer` encontró tres, y los tres se confirmaron en el código.

- **F1 (High) — escalada a admin desde «Nuevo Ingreso»:** `users:create` aceptaba cualquier `roleId`.
  - Ahora un no-admin solo asigna roles cuyos permisos efectivos ya tiene, y nunca admin
    (`assertActorCanAssignRole`).
  - Aplica al crear y editar usuarios y cargos.
- **F2 (Medium) — anular un cierre revivía activos dados de baja:** eso permitía una segunda baja contable.
  - `voidRun` bloquea los activos del cierre y responde 409 si alguno ya está dado de baja o en `WRITTEN_OFF`.
  - Costo, capitalización y parámetros rechazan los activos dados de baja.
- **F3 (Medium) — `permissions:update` equivalía a admin:** ahora un no-admin solo otorga o incluye lo que ya tiene,
  no toca su propio rol ni el de admin, y no edita las pantallas que su rol tiene.
- **R1 (Medium, venía de antes; lo halló la re-verificación):** con `users:update` se podía resetear la password de
  un admin. Editar, resetear o desactivar una cuenta ahora exige poder asignar su rol.
- **R3 (nota):** `DEVALUATED` también queda fuera del ciclo contable.

### Decisiones
- **Regla general:** el usuario eligió "un no-admin solo otorga lo que ya tiene" (F3 recomendado, no el estricto).
- **Baja contable:** la separación de funciones queda como nota.
- **Consecuencia funcional:** RR.HH. no-admin solo puede crear cuentas con roles cuyos permisos ya tiene.

### Verificación
- **Re-verificación:** `security-engineer` revisó las mitigaciones y confirmó F1, F2 y F3 cerrados, sin regresión
  para admin.
- **Tests nuevos:** `permissionEscalation.routes.integration.test.ts` (5 ataques, ahora 403) y el caso F2 en el test
  de la baja contable.
- **Suite completa contra Testing:** 39 archivos, 330 tests OK.

### Pendiente
- **Commits y promoción a `master`,** que también llevan el plan 008.
- **Notas abiertas:** separación de funciones en la baja, un activo dado de baja que pasa a SUPPORT, y el
  intercambio de permisos entre dos gestores.

---

## 2026-09-23 (6) — Baja contable de activos con fotos y certificado notarial (plan 008)

### Contexto
Al ciclo contable del plan 007 le faltaba el cierre: la baja contable de 1 activo o de un listado, respaldada
con fotos (al menos una por activo) y un solo certificado notarial.
Plan: `.claude/planes/008-baja-contable-activos.html`.

### Decisiones del usuario
- **Baja operativa previa:** es obligatoria. Solo entran activos `DECOMMISSIONED`, cuyo Kardex ya quedó en cero.
- **Activos que entran:** cualquier activo clasificado, con cualquier clasificación y etapa.
- **Respaldo:** al menos 1 foto por activo y 1 certificado por lote.
- **Anulación:** no hay. Una baja confirmada es definitiva.

### Hecho
- **Modelo (`migrateAssetWriteOffs`):**
  - tablas `asset_write_offs` (`DRAFT`|`CONFIRMED`, con un CHECK que exige fecha, motivo, certificado y auditoría
    al confirmar), `asset_write_off_lines` y `asset_write_off_photos`, esta última con FK compuesta a la línea y
    borrado en cascada;
  - etapa nueva `WRITTEN_OFF`: el CHECK de `asset_accounting.stage` pasó a tener nombre
    (`asset_accounting_stage_allowed`);
  - columna `write_off_id` en `asset_accounting`.
- **Servicio (`assetWriteOff.service.ts`):**
  - elegibles, y borrador con creación, edición de datos y activos, y descarte (borra la carpeta);
  - certificado único, que se reemplaza al volver a subirlo;
  - fotos por activo, hasta 10 por activo y 200 activos por baja;
  - **confirmar**:
    - bloquea con `FOR UPDATE` en orden y revalida elegibilidad, fotos y certificado;
    - guarda por línea la etapa anterior y el valor libro, que es la pérdida por baja: capitalizado − depreciación
      acumulada, el costo fijado, 0 si es gasto o el valor del activo;
    - deja los activos en `WRITTEN_OFF`.
  - **Kardex:** no se escribe, porque la baja operativa ya lo dejó en cero.
- **Archivos:**
  - tipo de subida nuevo `image` (solo JPEG y PNG, con verificación de magic bytes);
  - el certificado se limpia con qpdf y solo se acepta PDF;
  - hay un chequeo de estado antes de recibir cada archivo;
  - todo se guarda en `uploads/bajas/<id>/` (volumen `api_uploads`), con nombres generados por el servidor;
  - las fotos se sirven inline con `nosniff` y el certificado como adjunto, ambos con `no-store` y verificación
    de la ruta.
- **API `/asset-write-offs`:** `read`, `create` (borrador y archivos) y `approve` (confirmar), todos solo para
  admin por defecto.
- **Front:** pantalla «Baja Contable» (`/accounting/write-off`, `accounting-write-off:access`):
  - pestañas Nueva baja, Borradores e Historial;
  - panel con los datos, el certificado, las fotos por activo con miniaturas, y confirmar o descartar con un
    aviso previo.
- **Menú:** Baja Contable queda con orden 50 y Política pasa a 60.
- **Resto del ciclo:** `WRITTEN_OFF` queda fuera. Valor libro 0 en «Clasificación» y en los listados.

### Verificación
- **Compilación y lint:** `tsc` de la API y el front, y ESLint del front.
- **`assetWriteOff.service.integration.test.ts`** (4 tests):
  - quién es elegible;
  - qué exige la confirmación;
  - `WRITTEN_OFF` con el valor libro correcto (666.67 tras un cierre);
  - dos borradores con el mismo activo, confirmados en paralelo: uno solo gana;
  - fecha futura;
  - quitar un activo y descartar el borrador borran los archivos.
- **`assetWriteOff.routes.integration.test.ts`:**
  - 401/403 en cada operación;
  - validación del body;
  - archivos cruzados (un PDF como foto, un PNG falso, un PNG como certificado);
  - encabezados de la foto.
  - El flujo HTTP completo con qpdf se salta en este host, que no tiene qpdf.
- **Suite completa contra Testing:** 38 archivos, 324 tests OK. Front: 68 OK.

### Pendiente
- **Revisión de seguridad** antes de commitear.
- **Prueba en navegador.**
- **Límite conocido:** un activo dado de baja operativamente sin clasificar no puede darse de baja
  contablemente, porque la clasificación excluye `DECOMMISSIONED`.
- **Fotos:** se guardan con su EXIF.

---

## 2026-09-23 (5) — La siembra garantiza el mínimo de cada pantalla

### Contexto
Lo que se ajustaba a mano en «Permisos de Pantalla» se perdía al levantar con volúmenes limpios o en otro host.
Y al revés: una pantalla creada antes desde la UI (Capitalizacion en Development) nunca recibía los includes del
catálogo, porque la siembra solo completaba agrupadores sin includes.

### Hecho
- **Mínimo de cada pantalla:** los `includes` de `SCREEN_ACCESS_CATALOG` pasan a ser el mínimo de la pantalla.
  `seedScreenAccessIncludes` agrega en **cada arranque** los que falten y nunca quita nada: lo agregado desde la
  UI se conserva. El otorgamiento a roles existentes sigue siendo solo la primera vez.
- **No se pueden quitar:** `removePermissionInclude` responde 409 si se intenta quitar un include del mínimo del
  catálogo (`isCatalogScreenInclude`). Antes la siembra lo habría devuelto en silencio en el siguiente arranque.
- **Consecuencia:** Capitalizacion recibe `asset-accounting:read`, `asset-capitalization:create` y `assets:read`
  al reiniciar la API de Development, sin pasos manuales. Sus otros 7 includes siguen ahí.
- **Tests:** el de siembra ahora exige todos los includes del catálogo. Uno nuevo reproduce el caso de
  Development: completa sin quitar lo de la UI, lo de la UI se puede quitar y el mínimo responde 409. Suite
  completa: 36 archivos, 318 tests OK.

### Límite
Sacar un include del catálogo **no** lo borra de las bases ya sembradas (la siembra solo agrega). Eso sigue
siendo manual desde «Permisos de Pantalla».

---

## 2026-09-23 (4) — Gestión contable de activos: clasificación, costo, capitalización y depreciación (plan 007)

### Contexto
El usuario creó desde «Nueva Pantalla» la rama **Contabilidad › Gestión de Activos › Capitalizacion** para cumplir el
ciclo ITIL contable de un activo: clasificación, costo, capitalización y depreciación.
Plan: `.claude/planes/007-gestion-contable-activos.html`.

### Hecho
- **Modelo (Postgres, `migrateAssetAccounting`):**
  - `asset_accounting_classes`: se siembran 4 clases con la vida útil SII;
  - `asset_accounting_policy`: umbral de capitalización;
  - `asset_accounting` (1:1 con `assets`, con la etapa `CLASSIFIED → COSTED → CAPITALIZED → DEPRECIATING →
    FULLY_DEPRECIATED`);
  - `asset_attributable_costs`;
  - `asset_depreciation_runs`, con un índice único parcial: un solo cierre `CLOSED` por mes;
  - `asset_depreciation_entries`.
- **Kardex:** tipos nuevos `CAPITALIZATION`, `DEPRECIATION` y `DEPRECIATION_REVERSAL`. El CHECK pasó a tener
  nombre y `entry_type` se amplió a `VARCHAR(30)` (solo si hace falta, para no tomar el lock en cada arranque).
- **Cálculo:** `library/depreciation.ts` (lineal y acelerada SII = vida útil / 3), en centavos, con ajuste de la
  última cuota. Tiene tests unitarios.
- **API:**
  - `/asset-accounting`: pendientes, clasificar, costos atribuibles, fijar costo, capitalizar, parámetros y
    tabla proyectada;
  - `/asset-depreciation-runs`: vista previa, cerrar y anular el último;
  - `/asset-accounting-policy`: umbral y clases.
- **Reglas del cierre:**
  - los cierres van en orden y nunca a futuro;
  - advisory lock global y una sola transacción;
  - solo se anula el último cierre, con reversas en el Kardex.
- **Permisos base:**
  - `asset-accounting:read|update`;
  - `asset-capitalization:create`;
  - `asset-depreciation:read|create|delete`;
  - `asset-accounting-policy:read|update`.
  - Los 5 permisos de pantalla y el menú van en el catálogo, con los mismos labels que creó el usuario, así la
    siembra adopta esas filas.
- **Front (`pages/contabilidad/`):** Clasificación Contable, Determinar Costo, Capitalización, Depreciación
  (cierre mensual, historial y tabla proyectada) y Política Contable de Activos. Las etiquetas de los tipos
  nuevos se agregaron al Kardex.

### Verificación
- **Compilación y lint:** `tsc` de API y front, y ESLint completo del front.
- **Suite completa contra Testing:** 36 archivos, 317 tests OK. Front: 68 OK.
- **`assetAccounting.service.integration.test.ts`** cubre:
  - umbral;
  - costo sin valor;
  - capitalización y saldo del Kardex;
  - cierre en orden hasta el residual;
  - anulación solo del último;
  - período futuro;
  - dos cierres simultáneos que dejan uno solo.

### Pendiente
- **Prueba en navegador.**

### Revisión de seguridad
`security-review` sobre los cambios sin commitear: **sin hallazgos**.
- Cada ruta nueva usa `authenticate` y el `authorize()` que corresponde a su acción. Capitalizar, cerrar y anular
  tienen permisos propios, y ninguno se otorga al rol `user` por defecto.
- Todo el SQL usa `replacements`. Los ORDER BY son fijos, y los filtros de etapa y clasificación pasan por una
  lista blanca.
- zod descarta las claves que no conoce, así que ningún body puede fijar la etapa, los costos, los `*_by` ni el
  tipo de asiento. El endpoint manual del Kardex sigue aceptando solo `ADJUSTMENT` y `WRITE_OFF`.
- Nota menor (no es vulnerabilidad): los `:id` de cierres y clases no se validan como enteros. Un id inválido
  termina en un 500, sin inyección.

Se commitea junto con el arreglo de paginación del selector de íconos (`IconPicker`).

---

## 2026-09-23 (3) — Revisión de seguridad de las entradas de hoy y mitigación

### Contexto
Revisión de seguridad (`security-review`) sobre los cambios sin commitear de las entradas de hoy (plan 006 y
«Nueva Pantalla»): **1 Medium, ninguno High**.

### Hallazgo
- **Medium, revocación sin efecto:**
  - **Origen:** la siembra le otorgó a cada rol existente el permiso de pantalla cuyos permisos base ya tenía,
    así que esos permisos quedaron por dos vías: directa y por el agrupador.
  - **Síntoma:** quitar un permiso base en «Modificar Permisos» borraba solo la fila directa y respondía 204,
    pero `hasPermission` lo seguía concediendo vía el agrupador.
  - **Riesgo:** el admin creía haber revocado un acceso que seguía abierto.

### Hecho (las tres mitigaciones recomendadas)
- **Siembra:**
  - Al otorgar un agrupador en su primera siembra, en la misma transacción se borran las asignaciones directas
    que ese agrupador cubre. El acceso efectivo no cambia.
  - El bloque `grantToUser` ya no vuelve a asignar directo a `user` lo que ese rol obtiene por un agrupador
    (`getPermissionIdsCoveredByBundles`). Sin eso, el duplicado reaparecería en cada arranque.
- **API:**
  - `DELETE` y `PUT /roles/:id/permissions` responden **409**, sin borrar nada, si el rol seguiría teniendo el
    permiso por una pantalla asignada (`assertRevocationIsEffective`).
  - El mensaje nombra esas pantallas, y `details.stillGranted` las lista.
- **Front («Modificar Permisos»):**
  - Muestra lo que incluye cada pantalla asignada y marca los permisos base que «También lo otorga …».
  - Al pedir quitar uno cubierto, explica qué pantalla quitar o editar, en vez de ofrecer confirmar.

### Verificación
- **Compilación y lint:** `tsc` de API y front, y ESLint completo del front.
- **Suite completa contra Testing:** 34 archivos, 305 tests OK.
- **`permission.service.integration.test.ts`** (8 tests) cubre además:
  - los 409 de `DELETE` y `PUT`, sin borrado;
  - la revocación que sí aplica después de quitar la pantalla;
  - la siembra real de una pantalla del catálogo: la otorga y deja una sola fuente de acceso.

### Pendiente
- **Marca de revisión:** hay que crearla para el commit que se promueva a `master`
  (`security-gate-mark`, `SECURITY-GATE.md`).
- **Base de Testing:** sigue con los duplicados directos que dejó la siembra anterior, porque esa base ya
  estaba sembrada. En esos roles, quitar un permiso cubierto ahora responde 409 y explica qué pantalla lo
  otorga, así que no queda una revocación silenciosa.

---

## 2026-09-23 (2) — Vista «Nueva Pantalla» (`/menu-items/create`)

### Hecho
- **Formulario:** crea un ítem de menú de tipo **Pantalla** (con ruta) o **Carpeta** (sin ruta). Pide:
  - nombre;
  - «Depende de», con las carpetas activas mostradas con su ruta completa;
  - orden;
  - icono, desde un **recuadro con los ~1.300 iconos de Ionicons 5**, con búsqueda y hasta 120 visibles.
- **Ruta:** sugiere las que tienen vista en `MODULE_PAGES` y todavía no están en el menú. Avisa si la ruta no
  tiene vista (página en construcción) o si ya la usa otro ítem.
- **Permiso de pantalla:** se crea en la misma vista, con nombre sugerido desde la ruta, descripción
  «Pantalla: <nombre>» y la lista de permisos base, o se elige uno existente viendo lo que incluye.
  Si el permiso se crea pero el ítem falla, queda seleccionado como existente para no duplicarlo.
- **Refresco:** tras guardar se recargan `/auth/me` y `/auth/menu` (nuevo `refreshSession` en el AuthContext),
  sin recargar la página.
- **Componentes nuevos:** `IconPicker` y `PermissionChecklist`. «Nuevo Permiso» ahora usa este último.
- **API:**
  - `POST`/`PUT /menu-items` responden **409** si el nombre ya existe (antes daba 500 por la UNIQUE) o si
    la ruta la usa otro ítem activo.
  - `link` se valida con el formato `/segmento/segmento`.
  - `GET /menu-items` acepta `read` **o** `create`.

### Decisiones
- **Por qué `GET /menu-items` acepta `create`:** los includes de un agrupador se siembran una sola vez, así
  que agregar `menu-items:read` a «Nueva Pantalla» no habría llegado a las bases ya sembradas. La vista solo
  exige `menu-items:create`, y `permissions:create` es opcional (sin él, solo «usar uno existente»).

### Verificación
- `tsc` de API y front y ESLint completo del front.
- Suite de integración contra Testing: 303 OK, con el nuevo `menuItem.service.integration.test.ts`.
- **1 fallo intermitente preexistente:** `purchaseOrder.service.integration.test.ts` › «no flipea hasta que
  TODAS las OC…» falla 1 de cada 3 veces incluso corrido solo. No toca menú ni permisos. Queda pendiente.

---

## 2026-09-23 — Administración de permisos en caliente, roles y permisos de pantalla (plan 006)

### Contexto
Crear un permiso exigía editar `permission-catalog.ts` y recrear los contenedores. Además, cada pantalla exige varios
permisos base (hasta 8) que el admin tenía que conocer y asignar uno por uno: esa lista solo vivía en el
`REQUIRED_PERMISSIONS` de cada vista. Plan: `.claude/planes/006-permisos-de-pantalla.html`.

### Hecho
- **Permisos en caliente:**
  - `POST /permissions` (`permissions:create`) con las pantallas «Nuevo Permiso» y «Ver Permisos».
  - El seed sigue siendo aditivo y no borra lo creado por API.
  - Menú Gerencia de TI > Serv. Productivos > Permisos, con rutas `/permissions/*`.
- **Modificar Permisos:**
  - La pantalla que antes era «Asignar Autorización» salió de Personas > Roles. El seed la desactiva con `RETIRED_MENU_LABELS`.
  - Asignar o quitar permisos a un rol exige `permissions:update`. Leer los permisos de un rol exige `roles:read`.
- **Roles:**
  - «Ver Rol» ahora es real: lista los roles y sus permisos por descripción.
  - «Deshabilitar Roles» exige `roles:delete`.
  - «Habilitar Roles» usa `PATCH /roles/:id/activate`, que exige **`roles:update` y `roles:activate`**, esta última una acción nueva.
  - `PUT /roles/:id` ya no acepta `isActive` (400): con eso se esquivaban ambos permisos.
  - `admin` no se puede desactivar, habilitar ni renombrar por la API (409). Solo por query directa en el motor.
- **Permisos de pantalla (acción `access`):**
  - Tabla `permission_includes`. Un agrupador `<slug>:access` incluye los permisos base de su vista, en un solo nivel.
  - `hasPermission` (una consulta con EXISTS), `getRoleIdsWithPermission`, `/auth/me`, el menú y `/users/:id/access` lo expanden.
  - `GET /roles/:id/permissions` devuelve solo lo asignado directamente.
  - `SCREEN_ACCESS_CATALOG` siembra 40 pantallas. Los includes se transcribieron del `REQUIRED_PERMISSIONS` de cada vista.
  - Las hojas del menú pasan a `<slug>:access`.
  - La primera vez, cada rol que ya tenía todos los permisos base recibe el agrupador, en una transacción.
- **Pantallas nuevas:**
  - «Permisos de Pantalla» (`/permissions/access`): agregar o quitar lo que incluye un agrupador.
  - «Ver Pantallas» (`/menu-items/read`): cada pantalla con su permiso y lo que incluye.
  - «Nuevo Permiso» permite elegir los includes al crear un `access`.

### Decisiones
- **Agrupador expandido en el backend**, en lugar de una lista en `menu_items` o un permiso exclusivo por pantalla que cada endpoint tuviera que aceptar.
- **Nombres de acción:** se eligió `access` y no `activate`, que ya significa «habilitar algo desactivado». Los slugs van en inglés y no repiten un resource base.
- **Qué se siembra una sola vez:** los includes se siembran solo si el agrupador no tiene ninguno; después manda lo que edite el admin.

### Verificación
- `tsc` de API y front (`-p tsconfig.app.json`) y ESLint completo del front.
- Suite completa contra el stack de Testing: **33 archivos, 301 tests OK**. Incluye el nuevo
  `permission.service.integration.test.ts`, que cubre:
  - expansión;
  - rol inactivo;
  - aprobadores vía agrupador;
  - rechazo de anidar;
  - siembra de las 40 pantallas.

### Pendiente
- **Pruebas en navegador:** ninguna pantalla se probó en un navegador real. Falta reconstruir API y front en Development.
- **Efecto aceptado:** un rol que veía un ítem con un solo permiso, pero no tenía el resto (la vista le daba 403), deja de verlo.
- **Stubs:** «Nueva Pantalla» y «Asignar Permisos» siguen siendo stubs sin llamadas a la API.
- **Sin commit:** todo lo anterior está sin commitear.

---

## 2026-09-21 (10) — Ronda de `cybersecurity-orchestrator` sobre la carga masiva de activos y su endurecimiento

### Contexto
Revisión de solo lectura de la entrada (9) (plan 005). Veredicto **PASS con observaciones**: 0 Critical/High, 1 Medium,
9 Low y 8 Info; por la regla del propietario (cerrar incluso lo menor) se corrigieron todos.

### Hecho
- **F-01 (Medium) enumeración de colaboradores**: validar un CSV con `assigned_rut`/`assigned_username` era un oráculo sobre el
  directorio (hasta 5.000 RUT por archivo, ~220 veces lo que permite el buscador de la toma). Ahora el mensaje es único
  («no existe o no está activo», sin repetir el valor) y hay un **presupuesto de 300 identidades no resueltas por usuario y hora**
  (429 al agotarlo); un archivo real casi no falla en eso, un enumerador falla casi todas.
- **Carreras** (F-02, F-03, F-05): el inicio de la carga es un **script Lua atómico** (estado `VALIDATED`, cupo por usuario,
  quitar vencimientos y `RUNNING` en un paso; antes un doble `start` podía dejar el trabajo con TTL de 1 h o iniciar dos cargas del
  mismo usuario) y el resultado de cada fila se escribe con **fencing** (solo si el worker sigue siendo dueño del lease; un worker
  pausado ya no reescribe el cursor hacia atrás). Además `res` recibe su vencimiento si la carga se cancela mientras se crea una fila.
- **Redis** (F-04): un **borrador por usuario** (validar otro archivo descarta el anterior sin iniciar) y, en
  `corporate-infra/Redis/entrypoint-wrapper.sh`, `--maxmemory 400mb --maxmemory-policy noeviction` (el contenedor tiene 512M): al
  llenarse fallan las escrituras con un error en vez de que el cgroup mate Redis y caigan sesiones y límites. Verificado con la
  imagen base; **surte efecto al reconstruir el servicio de Redis** de cada ambiente.
- **Autorización viva** (F-07): cada 100 filas el worker revalida que el dueño siga activo y con `asset-imports:create` (si no, cancela
  la carga) y, por fila, que el usuario asignado y el producto sigan activos (la revisión va fuera de la transacción de la fila).
- **Adopción más estricta** (F-06): además de autor, momento, producto y centro, exige la misma garantía y el mismo estado, con 60 s de
  tolerancia por desfase de reloj entre réplicas.
- **Lecturas** (F-09, F-13, F-15): los GET tienen limitador (120/min por usuario); una carga ajena responde 404 igual que una inexistente;
  los GET aceptan `read` **o** `create` (un rol con solo `create` ya no inicia cargas que no puede ver) y la descripción del permiso
  avisa que `create` implica crear y asignar activos.
- **Parser y salida** (F-10, F-14, F-17): tope de 32 columnas por registro (2 MB de comas gastaban ~48 MB), neutralización de fórmulas en
  el CSV de salida también con espacios o saltos de línea previos, mensaje claro para un CSV en ANSI («guardar como CSV UTF-8») y más
  códigos de error transitorios (`ETIMEOUT`, `ECONNCLOSED`, cortes de Mongo).
- **Front** (F-08, F-17): `?job=` solo acepta un UUID (con `?job=../users` la pantalla hacía un GET a otra ruta de la API con la sesión
  de la víctima) y el servicio codifica el id.
- **Operación** (F-11, F-12, F-16, F-18): el barrido no se solapa consigo mismo y `resume` avisa si el servidor está ocupado; el error de
  una consulta de validación ya no lleva su SQL (con RUT/usuarios) a los logs; el cierre ordenado hace `server.close()`, sale con
  128+señal como antes y los compose de la API llevan `stop_grace_period: 20s`; el log de inicio registra al dueño además de quien inició.

### Verificación
- API: **295 tests** (unitarios + integración contra el stack de Testing), 12 omitidos (los que necesitan `qpdf` local); `tsc` limpio.
  Front: `tsc`, ESLint y build limpios y 68 tests. Tests nuevos: doble `start` concurrente, dos cargas del mismo usuario a la vez, borrador
  único, presupuesto de identidades, dueño desactivado o sin permiso a mitad de carga, usuario o producto desactivado tras validar,
  adopción estricta y desfase de reloj, tope de columnas, fórmulas en la salida, 404 de cargas ajenas y roles solo `create`/solo `read`.
- **Prueba de caída real repetida en Testing** con el código corregido: ver el resultado en la entrada (9).

### Riesgos que siguen
- Sin `maxmemory` aplicado hasta reconstruir Redis; los `imp:*` de un trabajo terminado viven 7 días.
- `createAssetMovement` consulta MSSQL (usuario) dentro de la transacción de la fila cuando hay estado `ASSIGNED`: un MSSQL lento retiene el
  contador de tags de Postgres (la toma de inventario ya tenía el mismo comportamiento). Aceptado y documentado.
- El barrido usa `SCAN` sobre todo el keyspace de Redis cada 30 s por réplica (sin solapes); aceptable con el tamaño actual.
- La UI no se probó en un navegador real; los logs de SQL en nivel debug (fuera de producción) siguen registrando las consultas normales.

---

## 2026-09-21 (9) — Carga masiva de activos por CSV, reanudable con Redis

### Contexto
Se pidió un endpoint independiente (usable desde Insomnia o el front) para cargar un inventario desde un CSV **sin modificar tablas ni
schemas**. Decisiones del usuario: reanudable con Redis (retomar desde la última fila si se cae la conexión o el proceso), **solo altas**
(una serie que ya existe se rechaza con su TAG; modificar activos sigue siendo solo por toma de inventario) y **sin valor** en el CSV
(se valoriza después). Plan: `.claude/planes/005-carga-masiva-activos-csv.html`.

### Hecho
- **API `/api/asset-imports`**: `POST /` (multipart `file`, valida todo el CSV **sin escribir** y guarda el trabajo en Redis), `POST /:id/start`
  (`?skipInvalid=true` carga solo las filas válidas), `GET /:id` (estado y avance), `GET /:id/result` (CSV con el resultado por fila, con
  BOM), `POST /:id/resume` y `POST /:id/cancel`. Permisos `asset-imports:read|create`, sin acceso por defecto; cada carga solo la ve su
  dueño o un admin. Menú «Carga Masiva de Activos» (`/assets/import`).
- **Columnas del CSV**: `serial_number`, `product` (nombre exacto), `cost_center_code` (obligatorias); `category`, `status`
  (`AVAILABLE` por defecto, `ASSIGNED`, `SUPPORT`, `DAMAGED`), `assigned_username` o `assigned_rut` (si `ASSIGNED`) y `warranty_expires_at`.
  La categoría es del producto y el tenedor sale del movimiento, así que el CSV los **resuelve** y usa las funciones existentes; el TAG lo
  genera el sistema. Máximo 5.000 filas y 2 MB, UTF-8, separador `,` o `;`.
- **Reanudación**: cada fila es **una transacción Postgres** (Mongo y MSSQL solo se leen); Redis guarda las filas ya resueltas, el cursor y el
  resultado por fila. Un *lease* impide que dos réplicas procesen el mismo trabajo; un barrido cada 30 s en cada réplica retoma los trabajos en
  curso sin lease; SIGTERM/SIGINT esperan hasta 8 s la fila en curso. Como Redis va por detrás de Postgres (AOF por segundo, réplica asíncrona),
  al reanudar una fila ya confirmada se **adopta** en vez de rechazarla como duplicada.
- **Refactor sin cambio de comportamiento**: el bloqueo por serie y la aplicación del estado declarado se extrajeron de `inventoryCount.service.ts`
  a `assetIntake.service.ts` para que la toma y la carga usen las mismas reglas.
- **Front** `pages/activos/ImportAssets.tsx`: plantilla descargable, subida (valida), tabla de errores por fila, «Iniciar carga» o «Cargar solo las
  filas válidas», barra de avance con sondeo, «Reanudar» si se detiene, «Cancelar» y descarga del resultado. La carga vive en `?job=<id>`.
- **Sin dependencias nuevas**: parser CSV propio (`library/csvImport.ts`) en lugar de `csv-parse`.

### Decisiones
- Solo altas, sin valor y sin tocar el schema (pedido del usuario); un trabajo activo por usuario; los errores de una fila no detienen el
  trabajo (quedan en el resultado) y un error de infraestructura sí (se reintenta, hasta 20 veces).

### Verificación
- **Prueba de caída real en Testing (3 réplicas)**: carga de 5.000 filas con la réplica que la procesaba **muerta con SIGKILL** (~1.000 filas) →
  otra la retomó sola a los ~60 s (vencimiento del lease + barrido) y terminó: 5.000 series distintas, TAG contiguos, 0 duplicados, sin valor ni
  Kardex. Repetido con **SIGTERM** (cierre ordenado): retomada en ~10 s, mismo resultado. ~130 filas/s. Datos de prueba y contador de tags
  restaurados después. (Se repitió tras las correcciones de la entrada (10).)
- Tests unitarios del parser (20) y de integración de servicio, trabajo/reanudación y HTTP (la reanudación se prueba dejando Redis y Postgres
  exactamente como los deja una caída: filas confirmadas en Postgres que Redis no alcanzó a registrar).

### Pendiente
- Asignar `asset-imports:read` + `create` a los roles que cargan inventario y probar la UI en un navegador real (no se hizo).

### Impacto en la documentación pública
- `README.md` raíz: nuevo bullet «Carga masiva de activos por CSV».

---

## 2026-09-21 (8) — `promote-to-master.ps1` resuelve los conflictos en rutas excluidas

- **Problema** (visto al promover el PR #11): cuando `testing` modifica un archivo de solo-testing que `master` no tiene
  (`*.integration.test.ts`, `compose.test.yml`), el merge da *modify/delete* y el script se detenía con «conflictos reales»
  antes de aplicar la lista de exclusión; había que resolverlo a mano.
- **Ahora**: el merge ya no corta ahí; los conflictos en rutas de `master-excluded-paths.txt` se resuelven borrando el archivo
  (`git rm -f`) y solo un conflicto en una ruta **normal** detiene la promoción (lista cuáles). El borrado usa `git rm` en vez de
  `Remove-Item`; si el merge falla sin conflictos resolubles se aborta y se vuelve a la rama de partida; al terminar (o si no hay
  nada que promocionar) se restaura la rama desde la que se invocó.
- **Verificado** en un clon aislado con un remoto local falso (sin tocar GitHub) reproduciendo exactamente el caso: excluyó las mismas
  19 rutas y el árbol de `release/master` resultó **idéntico** al que se armó a mano para el PR #12.

---

## 2026-09-21 (7) — CI de GitHub Actions (typecheck, lint y tests)

- Nuevo `.github/workflows/ci.yml`: en PR y push a `develop` y `testing` corre, para la API, `tsc` y los tests **unitarios**
  (con `qpdf` instalado, para que se ejecuten los del saneador de PDF) y, para el front, `tsc -p tsconfig.app.json`, ESLint,
  tests y build. `pnpm install --frozen-lockfile` (ambos lockfiles verificados al día). No corre hacia `master`: allí los
  tests no viajan (`master-excluded-paths.txt`) y el PR lo cubre `master-no-testing-artifacts.yml`.
- Los tests de **integración** siguen a mano (`.
un.ps1 bdd test`): necesitan las bases reales del stack de Testing.
- Flujo a producción: `develop` → PR a `testing` (CI) → `.
un.ps1 pre prod` (mezcla `testing` en `release/master` sin tests
  ni composes de test) → PR a `master`. `corporate-api/test/pdfFixtures.ts` se agregó a las rutas excluidas de `master`.
- Para que el CI sea obligatorio hay que marcar sus jobs (`API (tsc + tests unitarios)`, `Web (tsc + lint + tests + build)`)
  como checks requeridos en la protección de rama de `develop`/`testing` en GitHub (no se configura desde el repo).
- **No verificado**: la corrida real en GitHub (los pasos se corrieron en local en Windows; en Ubuntu `qpdf` de apt es 11.x, no
  12.x, y ahí el saneador sí aplica los `ulimit`).

---

## 2026-09-21 (6) — Ronda de `cybersecurity-orchestrator` sobre los cambios de la entrada (5)

### Contexto

El usuario pidió una nueva ronda con `cybersecurity-orchestrator` sobre lo agregado en la entrada (5) (qpdf, auditor único,
modos por tenedor, migración con lock, `read_only`). Veredicto del agente: **PASS** (sin Critical/High), 1 Medium, 6 Low.
Se corrigió todo lo accionable. Flujo de ramas acordado: `develop` → PR a `testing` → PR a producción (`master`).
Esta entrada **corrige** una afirmación de la (5): qpdf **sí** descomprime en memoria los object streams.

### Hecho

- **M1 (Medium) — bomba de descompresión**: `--json-stream-data=none` no evita que qpdf descomprima entero un `/ObjStm`
  (medido: 82 KB → 137 MB de RSS; un PDF de 5 MB llega a varios GB) y qpdf 12 no tiene tope de tamaño descomprimido.
  Ahora cada qpdf corre por `/bin/sh` con `ulimit -v 192 MB` y `ulimit -f 32 MB`, **un solo qpdf a la vez** por réplica y
  espera en cola de 10 s (después 429), JSON ≤ 8 MB. Con el límite qpdf no falla: atrapa el `bad_alloc`, avisa y sigue sin ese
  flujo (código 3); por eso se rechaza explícitamente cualquier `bad_alloc`/«error decoding stream data» en stderr. El límite
  solo aplica donde hay `/bin/sh` (contenedores Linux); en Windows (desarrollo) no.
- **L1**: se rechazan también `/URI`, `/Named`, `/ResetForm`, `/GoToDp`, `/SetOCGState`; y lo que se va a guardar se
  **vuelve a inspeccionar** (defensa en profundidad).
- **L2**: propiedad y estado se validan **antes** de recibir y sanear el archivo (`assertDocumentUploadAllowed`, un SELECT):
  un tercero o una devolución ya enviada no gastan CPU/RAM de qpdf. Cola con cupo transferido directo (sin carrera).
- **L3**: `closeInventoryCount` autoriza antes de tomar el lock de la cabecera (403 antes que 409).
- **L4**: `sendAssetReturn` vuelve a exigir el modo OWN/OTHERS; un activo que cambió de tenedor se lista y no se envía.
- **L5**: `GET /inventory-counts/:id/lookup` con límite de 120/min por usuario; las líneas, el informe, el PDF y las etiquetas
  de una toma **abierta** solo las lee su auditor o un admin (traen RUT). El front no las pide si no es el auditor.
- **L6**: cualquier usuario del último movimiento cuenta como tenedor para el modo (antes solo el primero).
- **Migración (Info)**: `runDdl` consulta el catálogo antes de `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
  (piden lock de tabla aunque el objeto exista y encolaban tráfico en cada reinicio en caliente).

### Verificación

API 243 tests en verde, `tsc` limpio (API y front), ESLint y 68 tests del front. En **Testing** (imagen reconstruida): una
bomba que expande a 80 y a 150 MB se rechaza en ~120 ms sin OOM ni reinicios; un PDF normal y uno con object streams
comprimidos legítimos se aceptan; JavaScript, basura y polyglot se comportan igual; las 3 réplicas arrancan sin errores.

### Riesgos que siguen

- El agente supone (no probó) que un `idle_in_transaction_session_timeout` en el servidor real mataría la transacción que
  sostiene el lock de migración; no hay tal parámetro en el repo.
- Exploits en el decodificador de imágenes/fuentes del lector (JBIG2, JPX) no los cubre ningún saneado estructural.
- La lectura del RUT del tenedor en `lookup` sigue disponible para el auditor (lo necesita el formulario), ahora con límite.
- Los PR a `testing`/`master` se fusionan en GitHub y el hook local `pre-push` no corre ahí: para exigir esta revisión hace
  falta protección de rama en GitHub (checks/aprobaciones obligatorias).

---

## 2026-09-21 (5) — Cierre de los riesgos abiertos de la revisión de seguridad

### Contexto

La entrada (4) dejó cinco puntos abiertos. Decisiones del usuario: **reescribir la guía con `qpdf`**; **solo
"Descargar guía"** (sin ver ni imprimir en el navegador); **probar en Testing** `read_only` y `lock_timeout`; **solo el
auditor** quita o modifica en la toma; y en devoluciones **el titular no modifica la asignación ni el centro de costo de
sus propios equipos**. Esta entrada reemplaza lo que la (4) decía sobre esos puntos.

### Hecho

- **Guía de despacho saneada con qpdf** (`library/pdfSanitizer.ts`, reemplaza a `pdfActiveContent.ts`, que se eliminó):
  `qpdf --json` entrega el árbol de objetos tal como lo lee un visor (incluye object streams, descifrado, sin depender de
  un `/Length` falso), se recorre y se rechaza JavaScript, `/EF`, `/Launch`, `/GoToR`, `/SubmitForm`, multimedia, XFA, etc.
  Lo que se **guarda** es la reescritura de qpdf del mismo archivo (sin basura antes/después: los polyglots quedan sin la
  carga; sin cifrado). Sin zip bomb (no descomprime flujos), `timeout` 15 s, salida ≤ 16 MB, máximo 2 qpdf a la vez, entorno
  mínimo, temporales en `/tmp`. **Falla cerrada**: sin el binario la subida responde 503. qpdf entra en `Dockerfile` y
  `Dockerfile.dev` (`apk add qpdf`); en el equipo de desarrollo hace falta `winget install QPDF.QPDF` para los tests que
  suben PDF (`QPDF_BIN` o PATH; sin él esos tests se omiten).
- **Solo descarga**: se quitaron "Ver guía" e "Imprimir guía"; el servidor entrega la guía como `attachment`.
- **Toma de inventario, solo el auditor**: ingresar (incluye cambiar estado, usuario y centro de costo de un activo real),
  consultar, corregir y quitar equipos, y cerrar exigen ser el auditor que abrió la toma o un administrador (403, evaluado
  antes que el estado). Ya no hay escritura compartida entre auditores. El front oculta la captura al que no es el auditor.
- **Devoluciones, dos modos por tenedor** (`asset_returns.holder_scope`, `OWN`/`OTHERS`): "Mis equipos" solo admite
  activos asignados al solicitante y el **centro de costo lo define el activo** (no hay selector; si abarcan varios centros
  se hace una devolución por centro); "Equipos de otro usuario" exige elegir el centro de costo y **rechaza** activos del
  propio solicitante. Una devolución no mezcla modos. El administrador queda exento. Lo exige el servidor (409/400); los
  candidatos se filtran en la BD por tenedor vigente (`GET /asset-returns/candidates?scope=`).
- **Migración de Postgres**: las 3 réplicas se serializan con `pg_advisory_xact_lock` (una migra a la vez) y cada DDL corre
  con `SET LOCAL lock_timeout = 30 s` (espera al lock 120 s).
- **`read_only: true`** + `tmpfs /tmp` (64 MB, `noexec`) en las réplicas de API de Testing y Producción.

### Verificación

- API: `tsc` limpio y **237 tests** en verde (28 archivos; incluye qpdf real: object stream comprimido, cifrado, polyglot,
  falla cerrada); front: `tsc`, ESLint y 68 tests en verde.
- **Probado en Testing con `run.ps1 backend test`** (imagen reconstruida): las 3 réplicas healthy con rootfs de solo
  lectura, volúmenes `api_uploads`/`api_downloads` montados, migración serializada (cada una obtuvo el lock en ms y aplicó
  sin errores); el saneador dentro del contenedor (qpdf 12.3.2 de Alpine) acepta un PDF normal, rechaza JavaScript y basura y
  elimina el trailer de un polyglot; un archivo escrito en `uploads` por una réplica lo lee otra y **sobrevive a
  `up --force-recreate`**; con `asset_returns` bloqueada (`ACCESS EXCLUSIVE`) una réplica falló a los 30 s con
  `canceling statement due to lock timeout` en lugar de congelarse. Las réplicas de Testing no tenían adjuntos previos.
- **No verificado**: la UI en un navegador; el flujo HTTP completo contra Testing con sesión real (cubierto por los tests
  de rutas); Producción no se tocó (solo el compose).

### Riesgos que siguen

- El `RUT`/nombre de quien tiene cada equipo lo ve cualquier titular de `asset-returns:create` en el modo "otros".
- `createAssetsFromReceipt` y `PUT /assets` no toman el advisory lock de serie (preexistente).
- Con el arranque fallido por `lock_timeout` el cierre imprime "Socket already opened" de Redis (ruido del apagado,
  preexistente); el contenedor se reinicia y reintenta.

---

## 2026-09-21 (4) — Revisión de seguridad previa a los commits

### Contexto

Antes de commitear la toma de inventario, la valorización y las devoluciones, el usuario pidió validar la
seguridad y resolver **todos** los riesgos, incluso los menores. Se hizo una revisión propia y una auditoría en
paralelo con cinco agentes de solo lectura (`security-engineer`, `penetration-tester`, `docker-expert`,
`security-auditor`, `database-administrator`), cada uno con un alcance distinto; después una segunda ronda de
un agente sobre los propios fixes. Decisiones del usuario: **solo el solicitante o un administrador modifica una
devolución**, y **`inventory-counts:create` se asigna solo a quienes hacen inventario físico** (es un permiso fuerte:
ahora reasigna activos y cambia su estado).

### Hecho

- **Propiedad y separación de funciones (devoluciones)**: agregar/quitar activos, adjuntar la guía, enviar y cancelar
  exigen ser el solicitante o admin (403); recibir lo prohíbe a quien solicitó o envió (admin exento). Tope de 10
  borradores abiertos por solicitante (un borrador reserva sus activos). El tenedor se lee bajo el lock del activo y
  se refresca al despachar; enviar exige que la guía exista en disco; el primer adjunto fallido borra su archivo huérfano.
- **Integridad de la máquina de estados**: un activo `MOVE_TO_RETURNED` solo admite `RETURNED` (antes un `SUPPORT` o una
  baja por la API genérica dejaba la devolución trabada para siempre).
- **Toma de inventario**: solo el creador o admin cierra la toma; el tenedor de una línea se guarda solo si el estado
  resultante es `ASSIGNED`/`DEVALUATED`; la validación del colaborador pasó a `POST /inventory-counts/holders/lookup`
  (RUT exacto, devuelve solo `{userId, fullName}`: ya no hay búsqueda parcial que enumere personas ni RUT en la URL);
  medidas de etiqueta ≤ 300 mm.
- **Valorización**: valor ≥ 0,01 (un `0.004` redondeaba a 0); `PUT /assets/:id` ya no acepta `value` (permiso
  otorgado a todo usuario que dejaba fijar un costo sin asiento de Kardex). Menú y pantalla de valorización usan
  `asset-valuation:read`; guardar exige `:update`.
- **Subidas de archivos**: guía ≤ 5 MB; multipart acotado (1 archivo, pocos campos); tope de subidas **simultáneas**
  (8 por proceso, 2 por usuario) además del límite de 60 por 15 min; el inspector de PDF (`library/pdfActiveContent.ts`)
  rechaza JavaScript/Launch/archivos incrustados (también en flujos Flate y con nombres escapados), PDF cifrados,
  filtros no verificables y zip bombs. `Cache-Control: no-store` en la descarga (la CSP `sandbox` se probó y se
  retiró: bloquea el visor de PDF).
- **Almacenamiento**: `saveBuffer` atómico (temporal + rename), `deleteIfExists` sin carrera y `findFileByPrefix` exacto
  (`OC-1` ya no casa con `OC-10.pdf`: bug preexistente que podía adjuntar el archivo de otra orden o proveedor).
  Corregido además un `\n` literal que dejé en el `Dockerfile` (creaba un directorio `/app/n`).
- **Paginación y búsqueda**: lista permitida de `sortBy` y `limit` máximo por endpoint nuevo (`?sortBy=value` dejaba
  deducir el ranking de valor de los activos), tope de `page`, escape de `%`/`_` en las búsquedas Postgres.
- **Postgres**: el CHECK de `movement_type` se reescribe en una sola sentencia y solo si cambia (antes cada arranque de
  cada réplica hacía DROP+ADD con ACCESS EXCLUSIVE); se verifica que los índices únicos parciales existan de verdad
  (`runDdl` traga el `unique_violation`); `asset_return_lines` sin `ON DELETE CASCADE`; CHECK de coherencia
  (`NOT VALID`) y FK faltante; índices nuevos (`assets(cost_center_id)`, serie normalizada, último movimiento, etc.);
  `lockAssetRow` con `FOR NO KEY UPDATE`; el estado del activo se consulta dentro de la transacción (antes tomaba una
  segunda conexión del pool); clave del advisory lock de serie normalizada en SQL.
- **Front**: `window.open` con `opener = null`, descargas con `<a>` anclado y revocación diferida, WebUSB siempre cierra el
  dispositivo, gate de valorización sin petición previa al permiso.

- **Segunda ronda (re-auditoría de los propios fixes)**: el inspector escaneaba el archivo completo y una secuencia
  `/JS ` aparece por azar en datos binarios (medido: ~27 % de falsos positivos en PDF con imágenes). Ahora solo
  inspecciona el texto fuera de los flujos y descodifica las capas de los flujos (Flate anidado, ASCII85 —lo que usa
  ReportLab— y ASCIIHex, hasta 3 niveles, con tope); un object stream sin comprimir también se revisa; `/JS` solo cuenta
  con su valor; se rechazan además RunLength y LZW. "Ver guía" e "Imprimir guía" pasan a usar la URL de la API (mismo
  origen, cookie de sesión) en vez de una URL `blob:`, que la CSP de nginx (`default-src 'self'`, sin `frame-src` ni
  `object-src` para blob) habría bloqueado; se agregó "Descargar guía". Límite de 30 consultas/min por usuario en
  `holders/lookup`; el tope de 10 borradores se serializa con un advisory lock (dos POST simultáneos creaban 11);
  `deleteIfExists` ya no lanza (un 500 tras cancelar ya confirmado); temporales con UUID; la búsqueda por serie
  normaliza en SQL a ambos lados (`lower(btrim())`, como el índice y el advisory lock); las constraints `NOT VALID` se
  validan al arrancar (best-effort); `canReceive` del front excluye al solicitante; valorización valida ≥ 0,01 en el cliente.

### Decisiones y riesgos aceptados

- Sigue siendo una **heurística**, no un saneado real, el inspector de PDF (un PDF construido con cuidado, p. ej. con
  `/Length` falso, puede esquivarlo); la defensa de fondo es el sandbox del visor PDF del navegador. Si se quiere
  garantía fuerte: reescribir la guía con `qpdf` al subir.
- Agregar equipos a una toma abierta sigue siendo compartido entre auditores (deliberado); cualquier titular de
  `asset-returns:create` puede elegir cualquier centro de costo (lo elige el solicitante) y ver quién tiene cada activo.
- No se aplicó `read_only: true` al contenedor de la API ni un `lock_timeout`/`pg_advisory_lock` alrededor de la
  migración: requieren probarse en Testing. `createAssetsFromReceipt`/`PUT /assets` no toman el advisory lock de serie
  (preexistente).
- Backup de los volúmenes de adjuntos (no automático): `docker run --rm -v <proyecto>_api_uploads:/d:ro -v $PWD:/b alpine tar czf /b/uploads.tgz -C /d .`
  Los adjuntos que hoy viven en la capa de escritura de cada réplica de Testing/Producción no se migran solos.

### Verificación

`tsc` limpio (API y front), ESLint limpio en el front, API 232 tests y front 68 en verde; las 3 réplicas de dev
aplican la migración nueva sin error. **No verificado**: la UI en un navegador (en particular si el visor de PDF de
Chrome/Edge abre e imprime la guía servida por la API con la CSP de helmet: si no, queda "Descargar guía"), un
`up --build` real con los volúmenes.
El marcador del gate (`.security-gate/last-review.json`) no se actualizó: solo aplica a pushes a `master`.

---

## 2026-09-21 (3) — Devolución de activos a Adquisiciones (guía de despacho) y persistencia de `uploads`

### Contexto

Con la toma de inventario ya validada en desarrollo, el usuario pidió una pantalla para devolver uno o varios
activos con guía de despacho. Plan aprobado y guardado en
[`planes/004-devolucion-de-activos.html`](planes/004-devolucion-de-activos.html). Además pidió mantener la
persistencia de `uploads`. **Esta entrada reemplaza lo que la anterior decía sobre `RETURNED` («solo API,
por `POST /asset-movements`»): ahora solo se crea por el flujo de devoluciones.**

### Hecho

- **Flujo**: `DRAFT` (se arma y se adjunta la guía) → `SENT` (botón «Enviar a Adquisiciones»: los activos pasan
  a `MOVE_TO_RETURNED`, todo o nada, y pierden su tenedor) → `RECEIVED` (Adquisiciones recibe cada activo, o
  «Recibir todos»; cada uno pasa a `RETURNED`). «Recibida parcialmente» no es un estado: es `SENT` con líneas
  recibidas. `CANCELLED` solo desde borrador (libera los activos y borra el PDF).
- **Un centro de costo por devolución**; solo se agregan activos `ASSIGNED`/`DEVALUATED` de ese centro y sin otra
  devolución vigente (índice único parcial `ux_asset_return_lines_active_asset`, además del guard de aplicación).
- **Guía = código**: solo PDF (magic bytes con el middleware de subida existente), guardada como
  `uploads/devoluciones/DEV<centro><aaaammddHHmmssSSS>.pdf` (`library/assetReturnCode.ts`, hora local del
  servidor). El código se asigna al adjuntar por primera vez y es `UNIQUE`; el `UPDATE` con el código va antes de
  escribir el archivo, dentro de la transacción, para no pisar el PDF de otra devolución. Se ve e imprime desde la pantalla.
- **API `/api/asset-returns`**: `GET /`, `GET /candidates`, `POST /`, `GET /:id`, `POST /:id/lines`,
  `DELETE /:id/lines/:lineId`, `POST|GET /:id/document`, `POST /:id/send`, `POST /:id/receive`, `POST /:id/cancel`.
  Permisos `asset-returns:read|create|update` sin `grantToUser` (`create` = solicitante, `update` = recepción en
  Adquisiciones). Menú «Devoluciones de Activos» (`/assets/returns`, detalle con `?return=<id>`).
- **Movimientos**: `MOVE_TO_RETURNED` (solo desde ASSIGNED/DEVALUATED) y `RETURNED` (**solo desde
  `MOVE_TO_RETURNED`**); ambos fuera del enum Zod de `POST /asset-movements`. Sin efecto en Kardex ni en el valor.
- **Toma de inventario**: un activo `MOVE_TO_RETURNED` se rechaza con la instrucción «en tránsito hacia
  Adquisiciones» (`allowedStatusCodes` vacío) y no cuenta como faltante al cerrar.
- **Persistencia de adjuntos**: `compose.prod.yml` y `compose.test.yml` de `corporate-api` montan los volúmenes
  nombrados `api_uploads` y `api_downloads` (compartidos por las 3 réplicas; `downloads` guarda las cotizaciones
  que sube el proveedor); el `Dockerfile` crea las carpetas con dueño `node`. En dev ya persistía por el bind mount.
- Migración: estado `MOVE_TO_RETURNED`, CHECK de `asset_movements.movement_type` ensanchado, tablas
  `asset_returns` y `asset_return_lines`.

### Decisiones

- Enviar y adjuntar son pasos separados: imprimir no cambia el estado (el navegador no puede confirmar que se imprimió).
- Los activos pierden su tenedor al despacharse; la línea de la devolución conserva quién lo tenía.
- Una devolución ya enviada no se revierte desde la pantalla.

### Verificación

`tsc` limpio (API y front), ESLint limpio en el front, API 199 tests en verde contra el stack de Testing
(unit del código y de la transición; integración del servicio: candidatos, carreras, guía, envío atómico,
recepción parcial y total, cancelación, toma con activo en tránsito; HTTP con subida multipart), front 68 unit
tests. Las 3 réplicas de dev migraron sin error. Los compose de prod/test renderizan los volúmenes con
`docker compose config` (variables de relleno). **No verificado**: la UI en un navegador real, la impresión de la
guía (iframe oculto) y su apertura en pestaña nueva, un `docker compose up --build` real de Testing/Producción con
los volúmenes nuevos, ni el flujo con dos usuarios de roles distintos.

### Riesgos y pendiente

- Un activo `RETURNED` no tiene salida (re-disponibilizarlo, baja o soporte): `ASSIGNED` exige `AVAILABLE`. Es el paso siguiente natural.
- El nombre del archivo usa la hora local del servidor (zona horaria del contenedor).
- Sin aviso por correo a Adquisiciones al enviar.
- El admin debe asignar `asset-returns` a los roles (solicitante: `read`+`create`; Adquisiciones: `read`+`update`)
  y `cost-centers:read` a quien arma devoluciones; los usuarios deben volver a iniciar sesión.
- Al recrear los contenedores de Testing/Producción por primera vez con los volúmenes nuevos, los adjuntos que
  ya estuvieran en la capa de la imagen anterior no se migran solos.

### Impacto en la documentación pública

`README.md` raíz: nueva viñeta de devoluciones de activos.

---

## 2026-09-21 (2) — Ajustes a la toma de inventario y valorización de activos

### Contexto

El usuario cambió varias decisiones de la entrada anterior. Plan aprobado y guardado en
[`planes/003-toma-inventario-ajustes-y-valorizacion.html`](planes/003-toma-inventario-ajustes-y-valorizacion.html).
**Esta entrada reemplaza lo que la anterior decía sobre "solo comparar y reportar" y "no valorizar".**

### Hecho

- **Búsqueda por TAG o Serie** (radio + un campo de valor). TAG existente carga la serie del activo; por
  serie se resuelve el TAG. Serie repetida en varios activos se rechaza (se ingresa por TAG). API:
  `GET .../lookup?by=TAG|SERIAL&value=` y `POST .../lines` con `lookupBy`.
- **Los activos existentes se actualizan** según el estado declarado (ASIGNADO por defecto) y quedan en el
  centro de costo (ubicación) donde se encontraron. Reglas en una función pura,
  `library/inventoryAssetTransition.ts` (tabla en el plan 003), que también decide los estados que ofrece el combo.
- **`RETURNED`** (Devolución): estado + movimiento `RETURNED` (ASSIGNED/DEVALUATED → RETURNED), solo API. Un activo
  en devolución encontrado en la toma queda en SOPORTE con la instrucción de enviarlo a Soporte TI / Adquisiciones TI.
- **`DEVALUATED`** (Devaluado; el usuario prefirió este nombre a `REUSED`): una baja encontrada en uso queda asignada,
  con `assets.value = 0` y sin asiento de Kardex (su `WRITE_OFF` ya la dejó en saldo 0). Movimiento interno, fuera
  del enum Zod de `POST /asset-movements`.
- Una línea solo se puede quitar si no creó ni modificó el activo (`asset_modified`); solo se edita la descripción.
- **Valorización** (`/api/asset-valuation`, pantalla `/assets/valuation`): lista activos con `value` NULL (excluye
  baja y devaluados) y los valoriza en lote (máx. 200, cada uno en su transacción, resultado por ítem), fijando
  `assets.value` y escribiendo el asiento `ACQUISITION`. Valor > 0; un valor ya cargado no se corrige aquí.
  Permisos `asset-valuation:read|update`, sin `grantToUser`.
- Migración: estados `RETURNED`/`DEVALUATED`, CHECK de `asset_movements.movement_type` ensanchado
  (`asset_movements_movement_type_allowed`), columnas nuevas en `inventory_count_lines`.
- Autoverificación del colaborador y CSV: descartados por el usuario.

### Decisiones

- Con centro de costo distinto al del sistema, el activo se mueve aunque el estado no cambie (el plan solo lo
  decía para cambios de estado; se aplicó siempre porque ubicación = centro de costo).
- SOPORTE y DAÑADO reasignados a un usuario pasan antes por AVAILABLE (guard de `ASSIGNED`), sin movimiento intermedio.
- Un asignado no puede quedar DISPONIBLE desde la toma (falta el movimiento de devolución a AVAILABLE, que sigue
  siendo un hueco): se rechaza con el mensaje "registre su devolución".
- Las asignaciones hechas por la toma no generan acta de entrega (no captura supervisor, MAC ni accesorios).

### Verificación

`tsc` limpio (API y front), ESLint limpio sobre lo tocado, API 175 tests en verde contra el stack de Testing
(unit de la transición y de los cambios; integración de cada transición, de los movimientos nuevos, de la
valorización y de la capa HTTP), front 68 unit tests. **No verificado**: la UI en un navegador real (radio
TAG/Serie, combo de estados restringido, pantalla de valorización), WebUSB, lector físico y el PDF a simple vista.

### Riesgos y pendiente

- `inventory-counts:create` ahora también reasigna y cambia estado de activos existentes: es un permiso más
  poderoso que en la primera versión.
- Sigue sin existir una pantalla para registrar devoluciones; `RETURNED` solo se puede crear por `POST /asset-movements`.
- Fase 2 (cámara), sin UI de edición de línea y `z.coerce.boolean()` de `GET /assets/:id/label.zpl`, como antes.
- Usuarios deben volver a iniciar sesión para ver el menú «Valorización de Activos» y los permisos nuevos.

### Impacto en la documentación pública

Sección de funcionalidades del `README.md` raíz (toma de inventario y valorización).

---

## 2026-09-21 — Toma de inventario de activos (Inicio / Fin de inventario)

### Contexto

Con el flujo compra → recepción → asignación de equipamiento terminado, faltaba **levantar en terreno
qué hay realmente**, incluidos equipos que no existen en el sistema. Plan aprobado y guardado en
[`planes/002-toma-inventario-activos.html`](planes/002-toma-inventario-activos.html).

### Hecho

**Postgres** (`migrate.ts`, `migrateInventoryCounts`, idempotente): `inventory_counts` (folio
`IT-AAAA-NNNNNN`, índice único parcial: un auditor no tiene dos tomas `OPEN`), `inventory_count_lines`,
`inventory_count_missing_assets`, `inventory_count_counters`. `asset_statuses` suma `DAMAGED`.

**API (`/api/inventory-counts`)**: `POST /start` (retoma la abierta si existe), `GET /`, `GET /:id`,
`GET /:id/lookup?tag=`, `GET|POST /:id/lines`, `PUT|DELETE /:id/lines/:lineId`, `POST /:id/close`,
`GET /:id/report`, `GET /:id/report.pdf`, `GET /:id/labels.zpl` (sirve `etiquetas.txt`),
`GET /holders?search=`. Permisos `inventory-counts:read|create|update`, sin `grantToUser`.
`GET /products` acepta `?categoryId=` (combo categoría → producto).

**Front**: una sola ruta `/inventory/counts` (el menú dicta el ruteo) con `?count=<id>`: listado + «Inicio
de Inventario», captura con input de escaneo y «Fin Inventario», y reporte con panel de etiquetas nuevas.
Opciones de etiqueta extraídas a `lib/labelOptions.ts` + `components/LabelConfigFields.tsx`
(`PrintAssetLabels` las reutiliza).

### Decisiones

- Tag inexistente → se crea un **activo real** con tag **generado por el sistema** (se descarta el texto
  ingresado), sin recepción ni asiento de Kardex (no hay costo). Nace `AVAILABLE` y se lleva al estado
  declarado con un movimiento real (`ASSIGNED`/`SUPPORT`/`DECOMMISSIONED`) o `setAssetStatus` (`DAMAGED`).
- Tag existente → solo se **vincula y compara**; el activo no se modifica.
- Faltantes: todo activo salvo `DECOMMISSIONED` que no se vio; se congelan al cerrar.
- Serie obligatoria al crear; una serie ya existente se rechaza indicando el tag (advisory lock por serie
  porque `assets` no tiene UNIQUE sobre ella).
- Una línea con activo creado por la toma no se elimina (su etiqueta ya existe) y solo edita descripción.
- `createAssetMovement(input, transaction?)` acepta transacción externa; nuevo `listCurrentHoldersByAssetIds`.

### Verificación

`tsc --noEmit` (API) y `tsc -p tsconfig.app.json --noEmit` (front) limpios; ESLint limpio sobre lo nuevo;
API 134 tests + 23 nuevos en verde contra el stack de Testing (servicio y capa HTTP: 401/403/400/404/409,
flujo completo, PDF `%PDF`, `etiquetas.txt`); front 68 unit tests. **No verificado**: la UI en un navegador
real, la impresión WebUSB, la lectura con un lector físico, y el PDF a simple vista (solo se comprobó que
pagina en 2 hojas apaisadas).

### Riesgos y pendiente

- Fase 2: escaneo con cámara (nginx `Permissions-Policy: camera=(self)` en las 2 plantillas + CSP + librería).
- Sin UI para editar una línea; corregir un equipo dado de alta se hace con los movimientos del activo.
- Hallazgo previo, no tocado: `GET /assets/:id/label.zpl` usa `z.coerce.boolean()` y trata `showBorder=false`
  como `true` (cualquier string no vacío es `true`); la toma usa un parseo explícito.
- El auditor necesita además `products:read` y `product-categories:read` (el rol lo arma el admin).
- Usuarios deben volver a iniciar sesión para ver el menú y los permisos nuevos.

### Impacto en la documentación pública

Sección de funcionalidades del `README.md` raíz (toma de inventario) y estado de `corporate-api`/`corporate-front`.

---

## 2026-09-20 — Remuneraciones y previsión al crear un colaborador

### Contexto

Desde el 2026-09-19 se construye la base para generar el archivo de Previred (formato estándar largo
variable, 105 campos separados por `;`). El usuario fijó el orden: **primero** el modelo de
remuneraciones (contrato, gratificación, previsión al alta), **después** la liquidación, y **al final**
la pantalla que genera el archivo de Previred. Los montos de Previred deben salir de liquidaciones que
calcula el propio sistema (no hay sistema externo de sueldos ni importación por CSV).

### Hecho

**Modelo de datos (MSSQL, `corporate-api/src/databases/mssql/migrate.ts`, todo idempotente):**

| Tabla | Para qué |
|---|---|
| `previsional_institutions` | Catálogo de AFP, salud (FONASA/Isapres), CCAF, mutualidades y AFC, con código Previred |
| `previsional_rates` | Tasas versionadas por vigencia (`valid_from`/`valid_to`), p. ej. comisión de cada AFP |
| `apv_institutions` | Instituciones autorizadas de APV |
| `previred_employer_settings` | Fila única: CCAF, mutualidad, sucursal y tasa de accidentes **de la empresa** |
| `employee_previsional_profiles` | Afiliación vigente del colaborador (régimen, AFP, salud/plan Isapre, cargas, jornada) |
| `previred_payrolls`, `previred_payroll_lines` | Cabecera y líneas (foto por período) de la nómina Previred; **aún sin uso** |
| `payroll_settings` | Fila única: sistema de gratificación de la empresa y % de anticipo mensual |
| `payroll_parameters` | Parámetros monetarios con vigencia (hoy solo IMM, lo ingresa el usuario) |
| `employee_contracts` | Contrato: tipo, fechas, sueldo base y forma de pago de la gratificación legal |
| `gratification_movements` | Movimientos de gratificación por contrato/período (alimentarán la liquidación); **aún sin escritura** |

`persons` suma `maternal_last_name`, `sex` y `nationality` (campos 3-7 de Previred).

**Semilla** (`seed-data/*.json`): 27 instituciones previsionales (7 AFP, 11 de salud, 4 CCAF,
4 mutualidades, 1 AFC), 39 instituciones APV y 8 tasas vigentes desde 2026-09-01: las 7 comisiones de
AFP (Capital 1,44; Cuprum 1,44; Habitat 1,27; Modelo 0,58; PlanVital 1,16; Provida 1,45; Uno 0,46 —
confirmadas por el usuario como **comisión**, no cotización total) y la salud legal (7%).

**API (`/api/...`):** `previsional-institutions`, `previsional-profiles`, `previred-settings`,
`employee-contracts`, `payroll-settings`, `payroll-parameters` (controlador + servicio + rutas cada uno).
Permisos nuevos (11, todos admin-only por defecto): `previsional-institutions:read`,
`previsional-profiles:read|update`, `previred-settings:read|update`, `employee-contracts:read|create`,
`payroll-settings:read|update`, `payroll-parameters:read|update`.

**Menú** (Gerencia de Personas): *Previsión* → Asignar AFP, Asignar Salud, CCAF y Mutualidad;
*Remuneraciones* → Configuración de Remuneraciones. Rutas del front: `/employees/previsional/afp`,
`/employees/previsional/salud`, `/company/previsional`, `/payroll/settings`.

**Crear Colaborador (`CrearPersona.tsx`)** ahora captura en un solo flujo, en este orden: persona
(con apellido paterno/materno, sexo y nacionalidad) → dirección → colaborador → **contrato** (tipo,
fechas, sueldo base, gratificación legal y su forma de pago) → **previsión** (régimen, tipo de
trabajador, AFP, institución de salud y plan Isapre) → usuario. Cada paso tiene su bandera de
reintento. La CCAF y la mutualidad **no** se piden: son de la empresa y el colaborador las hereda
(`previred_employer_settings`); la pantalla solo muestra lo que hereda.

**Gratificación legal por contrato:** tipo (`ART47` | `ART50` | `CONVENCIONAL`), método, porcentaje,
tope en veces el IMM, forma de pago (`MENSUAL` | `ANTICIPO_MENSUAL_RELIQUIDACION` | `ANUAL`), mes de
reliquidación, reajuste de anticipos por IPC y, con anticipos, el **monto mensual en pesos**
(`gratification_monthly_advance`). Reglas legales validadas en `library/gratificationRules.ts` (con
tests): ART50 = 25% de las remuneraciones con tope 4,75 IMM; ART47 = participación en utilidades, 30%;
CONVENCIONAL = porcentaje libre sobre remuneraciones.

**Anticipo mensual desde la empresa:** *Configuración de Remuneraciones* permite definir un % del
sueldo base (`payroll_settings.gratification_monthly_advance_percentage`; ART50 máx. 25%, CONVENCIONAL
máx. 100%, ART47 no aplica). Al crear un colaborador el anticipo en pesos se calcula con su sueldo
base y se recalcula al cambiarlo, salvo que se escriba un monto a mano. Cada contrato guarda **su**
monto: cambiar el % de la empresa no altera contratos ya creados.

**Frontend:** `pages/personas/contract/` (`ContractSection`, `contractForm.ts` con lógica pura y
tests), `pages/personas/previsional/` (`PrevisionalSection`, `PensionFields`, `HealthFields`,
`previsionalForm.ts` con validación y tests; las mismas piezas las usan las pantallas *Asignar AFP* y
*Asignar Salud*, que se mantienen para cambiar la afiliación de colaboradores ya existentes),
`ConfiguracionRemuneraciones.tsx`, servicios `previsionalService`, `employeeContractService`,
`payrollService` y tipos `previsional.ts`/`payroll.ts`.

### Decisiones

- **MSSQL para todo lo previsional/remuneraciones** (PII y dinero), con `ALTER … IF NOT EXISTS` como
  camino de actualización: `CREATE TABLE IF NOT EXISTS` nunca corrige una tabla que dev ya tiene.
- **CCAF/mutualidad a nivel empresa**, no por trabajador: Previred las exige iguales en todas las
  líneas y guardarlas por trabajador permitiría que dos filas discrepen.
- **Tasas versionadas** en vez de una columna en la institución: una nómina de un período pasado debe
  recalcularse con la tasa que regía entonces (Previred rechaza con tolerancia 0).
- **Gratificación en columnas, no en un JSON:** permite consultarla y validarla con `CHECK`.
- **Reglas legales en código, no en la BD** (25 %, 4,75 IMM, 30 %): se pueden ajustar sin migrar. Los
  `CHECK` de la BD solo protegen invariantes estructurales y son seguros ante `NULL` (un `CHECK` que da
  `UNKNOWN` **no** rechaza en SQL Server).
- **El IMM y el IPC los ingresa el usuario**, no se siembran.
- **DECIMAL llega como `number`** desde tedious: los modelos lo tipan así (`goodsReceipt` lo tipa mal
  como `string`, no copiarlo).
- **Sueldo base, no bruto:** el cálculo del anticipo usa el sueldo base; la gratificación real va sobre
  todas las remuneraciones imponibles del mes, y la reliquidación cuadra la diferencia.

### Verificación

- Backend: DDL y servicios probados en un SQL Server descartable (imagen local de dev), tanto en BD
  nueva como en BD con datos previos y filas inválidas; 49 tests unitarios de la API pasan (los 11
  archivos de integración exigen bases reales y no cargan en este entorno, como antes).
- Frontend: `tsc -b`, `eslint`, `vite build` y 68 tests unitarios pasan.
- Las 3 réplicas de dev quedaron sanas y sin errores tras cada cambio de esquema.
- **No** se probó en un navegador con sesión iniciada.

### Errores propios corregidos en el camino (para no repetirlos)

- Tres `CHECK` de `employee_contracts`/`gratification_movements` dejaban pasar `NULL`; se reemplazaron
  por versiones `_v2` y se probó con filas violatorias.
- Se declaró DECIMAL como `string` por copiar `goodsReceipt`; en runtime es `number`.
- Se duplicaban datos de identidad entre `persons` y el perfil previsional; se movieron a `persons`.
- La API de dev recarga en caliente y **guardar `migrate.ts` aplica la migración en la BD compartida**:
  se probó tarde el primer campo de anticipo (inocuo); el segundo siguió el orden correcto
  (probar DDL → guardar `migrate.ts` → recién después el modelo/servicio que lee la columna).

### Riesgos y pendiente

- **Siguiente:** la **liquidación** (haberes, descuentos, renta imponible; suma los movimientos de
  gratificación) y luego el cálculo previsional y la pantalla del archivo de Previred.
- Faltan del usuario las tasas de cotización obligatoria de pensiones (10 %), SIS, expectativa de vida
  y rentabilidad protegida; y los datos de IPC e IMM.
- No existe el motor de cálculo de gratificación (anticipos, reliquidación, reajuste por IPC) ni el
  cálculo de ART47 (depende de las utilidades de la empresa).
- No hay pantalla para listar/editar contratos existentes ni para completar apellido materno, sexo y
  nacionalidad de personas ya creadas; un contrato ANTICIPO anterior al campo de monto queda sin monto.
- Crear un colaborador ahora exige `employee-contracts:create`, `previsional-institutions:read` y
  `previsional-profiles:update` (además de los anteriores): hoy solo `admin` los tiene, y los usuarios
  deben volver a iniciar sesión para ver los permisos y el menú nuevos.
- En una máquina con zona horaria distinta de UTC (p. ej. -03) fuera de Docker, Sequelize puede correr
  un día las fechas `DATEONLY`; en los contenedores (UTC) no ocurre.
- El afiliado voluntario (campos 50-61) y la Tabla 14 de ex-cajas no están modelados.

### Impacto en la documentación pública (para el README raíz)

- Tabla "Estado actual" y sección "Funcionalidades implementadas": agregar previsión y remuneraciones al
  alta de colaboradores, y aclarar que el archivo de Previred **aún no se genera**.
- Motor por dominio: estas tablas viven en MSSQL (PII/dinero).
- Tests: cifras de tests unitarios de API y front.
- Limitaciones conocidas: las de la lista de arriba que afecten a quien use el sistema.
