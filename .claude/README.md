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
