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

## 2026-10-01 (3) — Plan 018: arriendos y servicios se devuelven al proveedor, sin Contabilidad

Plan en [`planes/018-arriendos-devolucion-a-proveedor.html`](planes/018-arriendos-devolucion-a-proveedor.html).

**Origen.** En producción, un arriendo dado de alta en la toma de inventario (serie `MJ08EZSG`, «Dañado») no aparecía en Devoluciones de Activos. Es lo correcto: esa pantalla solo lista equipos asignados en sucursales. Dar de Baja Activos lo encontraba, pero lo habría mandado a Contabilidad.

### Hecho
- **Devolución al proveedor.** Estado y movimiento `RETURNED_TO_SUPPLIER` («Devuelto a proveedor»), terminal.
  - Registro en la tabla `asset_supplier_returns`: motivo, fecha de salida del estado de pago, guía o acta del proveedor y foto opcional.
  - Ruta `POST /asset-movements/supplier-return`, con el mismo permiso que la baja.
  - El Kardex queda en cero.
- **Contabilidad solo con ACT** (`library/assetTag.ts`). Se aplica en:
  - Clasificación y Valorización: listan y aceptan solo ACT;
  - Baja Contable: solo admite ACT;
  - `POST /decommission`: rechaza los ARR y SRV.
- **Toma de inventario.**
  - Un ARR/SRV no se puede declarar «Baja», ni existente ni nuevo: se declara «Dañado».
  - Un activo devuelto al proveedor se rechaza y tampoco cuenta como faltante al cerrar la toma.
- **Front.**
  - Devoluciones de Activos muestra un aviso: la pantalla es para devolver a Sistemas los equipos asignados en sucursales.
  - Dar de Baja Activos tiene dos caminos según `flow`: ACT pasa a Baja Contable, y ARR/SRV se devuelve al proveedor.

### Decisiones
- SRV se trata igual que ARR.
- La devolución se registra en un solo paso.
- Lo ya clasificado de ARR/SRV no se borra.
- Un ARR/SRV que ya estaba «Pendiente de baja contable» antes de este plan puede devolverse al proveedor desde Dar de Baja Activos.

### Verificación
- API: `tsc` OK; unitarias 174/174 OK, con 3 casos nuevos de la toma.
- Front: `tsc`, eslint y 69 pruebas OK.
- Migración aplicada en dev sin errores.
- La integración completa sigue con los mismos 29 archivos fallando por el FK `employees.created_by` del plan 014 (problema previo).

### Revisión de seguridad (ping-pong)
- Orquestador: **GO**, con 3 Low.
- Security-engineer: **GO condicionado**.
- **M1 — un ARR/SRV ya clasificado y devuelto al proveedor seguía en Contabilidad.** Podía capitalizarse, lo que le devolvía valor en el Kardex, y seguía depreciándose.
  - Corrección: `RETURNED_TO_SUPPLIER` se agregó a las listas de exclusión de clasificación, depreciación (cierre y anulación) y valorización.
  - `lockRecord` ahora rechaza los tags que no son ACT, así que no se puede editar el costo, capitalizar ni cambiar parámetros.
  - Un ARR heredado que sigue en uso conserva su depreciación hasta que se devuelve.
- **B1 — `confirmWriteOff` no revisaba el tag** en los borradores armados antes del plan. Ahora lo revisa.
- **B2 — `2026-02-31` pasaba la validación y terminaba en un 500.** Ahora se valida la fecha real y un rango de ±1 año.
- Re-revisión: **GO**.
- Nota para el manual: si un activo depreciado se devuelve al proveedor, el cierre de depreciación anterior ya no se puede anular. Es el mismo criterio que con una baja.

### Promoción
- Commits en `develop`:
  - `698c3ba`: API;
  - `ecd78fa`: front;
  - `d20cec5`: documentación.
- PR #53 `develop → testing`: el CI de API y Web pasó y se hizo el merge (`2d87bbc`). El gate de seguridad quedó marcado sobre ese commit.
- PR #54 `release/master → master`: `promote-to-master` excluyó `inventoryAssetTransition.unit.test.ts` y la guardia de rutas prohibidas pasó. `master` quedó en `8874e74`.

### Pendiente
- Probar en el navegador.
- Redesplegar test y prod.
- En prod, revisar si hay ARR/SRV ya clasificados o en un borrador de Baja Contable.

## 2026-10-01 (2) — Revisión de seguridad del plan 017 y mejoras de «Seguridad de mi cuenta»

### Mejoras pedidas por el usuario
- El escudo de la barra superior queda verde con al menos un factor activo y rojo sin ninguno. Usa el campo nuevo `mfaEnrolled` de `/auth/me`.
- «Seguridad de mi cuenta» tiene una tarjeta «Contraseña». El formulario `ChangePasswordForm` es el mismo que usa la pantalla obligatoria de cambio.

### Revisión (ping-pong)
- Primera ronda: los dos agentes dieron **NO-GO** y coincidieron en todo lo importante.
  - **H1 — fuerza bruta del TOTP.** El tope de 5 intentos era por login a medio camino: se reiniciaba volviendo a hacer login, y las requests en paralelo evaluaban más códigos. El step-up no tenía tope.
  - **M — primer factor solo con la contraseña.** Las cuentas existentes al desplegar, o las que pasaban por un reset administrativo, podían enrolar el primer factor sin verificar el correo.
  - **M — step-up por usuario y no por sesión.** El login legítimo de la víctima habilitaba por 5 minutos a cualquier sesión robada.
  - **Bajos:**
    - el cupo de correos se gastaba con pedidos frenados por la espera entre envíos;
    - el rate limit se alimentaba con tokens elegidos por el cliente;
    - carrera en `consumeEmailCode`;
    - el primer factor no revocaba los refresh tokens;
    - faltaban logs de auditoría;
    - el cifrado TOTP no tenía AAD.
- **Correcciones:**
  - **Tope por cuenta:** 10 fallos en 15 minutos y 30 en 24 horas, reservados antes de verificar. Lo comparten el login, el step-up y las confirmaciones de enrolamiento. Se avisa por correo al dueño cuando la cuenta se bloquea, y no se abre otro login a medio camino mientras siga bloqueada.
  - **Tope por login a medio camino:** el intento también se reserva antes de verificar.
  - **Login sin factores:** con MFA obligatorio siempre pide el código al correo, no solo en el primer ingreso.
  - **Enrolar:** siempre exige step-up de la sesión. Sin factores, el step-up se hace con el código al correo.
  - **Step-up:** atado a la sesión (`sid:`) o al access token (`tok:<sha256>`). Los access tokens llevan ahora un `jti` aleatorio, así dos tokens nunca son iguales.
  - **Correos:** solo cuentan los envíos reales.
  - **Rate limit pre-auth:** por IP, con 300 requests cada 10 minutos.
  - **Primer factor:** revoca todos los refresh tokens.
  - **Auditoría:** eventos `mfa_*` en el log.
  - **Cifrado TOTP:** formato `v2` con AAD `user:<id>`; el `v1` solo se acepta en development.
- **Re-revisión del security-engineer: GO.** Encontró además:
  - **N1 (funcional):** si vencía la verificación en la pantalla de enrolamiento obligatorio, el usuario quedaba sin salida. Las rutas de step-up ahora aceptan el enrolamiento pendiente, solo con el correo y nunca con la contraseña por cambiar.
  - **N2:** los códigos y challenges de enrolamiento y step-up pasan a ser por sesión.
  - **N3:** se agregó la ventana diaria y el aviso por correo.
  - **N5:** liberar un intento ya no borra la clave.
  - **N6:** el `v1` sin AAD queda solo para development.
- **Aceptados:**
  - **N4:** con MFA opcional, el primer factor no corta las otras sesiones; solo pasa en dev.
  - Reset administrativo sin step-up del admin, igual que el reset de contraseña.
  - Las sesiones Redis anteriores al despliegue no traen la marca de enrolamiento.

### Verificación
- API: `tsc` OK; 171 pruebas unitarias OK; integración MFA 7 de 7 OK contra Testing. Casos nuevos:
  - los fallos se acumulan por cuenta aunque se abran logins nuevos;
  - el step-up por correo funciona con el enrolamiento pendiente;
  - el step-up es por sesión (un token renovado no lo hereda).
- Front: `tsc`, eslint y 69 pruebas OK.
- Suite de integración completa: 29 archivos fallan, todos con el mismo `fk_employees_created_by`. Su `resetTestData` hace `DELETE FROM users` contra los colaboradores que siembra el plan 014 en Testing. Es un problema previo y ajeno a este cambio.

### Promoción
- Commits en `develop`:
  - `83396ac`: fuga del hash en solicitudes de compra;
  - `286df9e`: API;
  - `e05af45`: front;
  - `7e4b234`: documentación.
- PR #51 `develop → testing` pasó el CI (API y Web) y se hizo el merge (`103a0a2`). El gate de seguridad quedó marcado sobre ese commit.
- PR #52 `release/master → master`. `promote-to-master` excluyó `compose.dev/test.yml` de la API y las 4 pruebas del plan 017. `master` quedó en `77c034d`.

### Pendiente
- **Al desplegar test/prod:** limpiar las sesiones Redis (`sess:*`), para que nadie siga con una sesión de antes de MFA.
- **Integración de Testing:** arreglar el reset de las suites (o la semilla del plan 014) para que vuelvan a correr completas.

---

## 2026-10-01 — Plan 017: MFA en el inicio de sesión (aprobado)

### Hecho
- Plan aprobado y copiado a [`planes/017-mfa-inicio-sesion.html`](planes/017-mfa-inicio-sesion.html).

### Decisiones
- **Factores:** TOTP (app autenticadora), código por correo (vía `corporate-mailer`) y WebAuthn/passkeys. SMS se descartó: requiere un proveedor pagado y una nueva salida a internet, y es vulnerable a SIM swap.
- **Obligatorio para todos** con `MFA_REQUIRED`; en dev queda en `false`.
- **Primer ingreso:** el código al correo se pide **antes** de cambiar la contraseña temporal. Como esa contraseña es compartida, conocerla no alcanza para tomar una cuenta nueva.
- **Sesión pre-auth:** mientras no se pasa el segundo factor no existe `req.session.user` ni se emiten JWT.
- **Passkeys:** solo se habilitan con `WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGINS`. WebAuthn no acepta IPs y hoy el front se publica por `ALLOCATED_IP`, así que mientras no haya un nombre DNS con certificado de confianza, en test/prod solo quedan disponibles TOTP y correo.

### Implementación (sin commitear, en `develop`)
- **API, esquema:**
  - columnas `users.mfa_totp_secret_enc`, `mfa_email_enabled` y `mfa_enrolled_at`;
  - tablas `user_webauthn_credentials` y `user_mfa_recovery_codes` (`migrateMfa()`).
- **API, `library/mfa/`:**
  - `totp.ts` usa `node:crypto` y no agrega dependencias;
  - `secretBox.ts` cifra con AES-256-GCM;
  - `keys.ts` deriva subclaves con HKDF desde el secret `mfa_encryption_key.txt`;
  - `recoveryCodes.ts`;
  - `webauthn.ts` usa `@simplewebauthn/server` 14.0.3.
- **API, flujo:**
  - el estado del login a medio camino vive en Redis (`services/redis/mfa.service.ts`), con el id en `session.mfaPendingId` o como `mfaToken` para clientes que solo usan tokens;
  - `completeLogin()` en `library/authSession.ts`;
  - las rutas `/auth/mfa/*` están en `controllers/mfa.controller.ts`;
  - el 403 `mfa_enrollment_required` está en `authenticate.ts` y en Socket.IO;
  - reset administrativo con `PATCH /users/:id/mfa/reset`.
- **Cambios respecto del plan:**
  - Los códigos de recuperación y los de correo se guardan con HMAC con clave secreta, no con bcrypt. Así se buscan por igualdad sin recorrer 10 hashes bcrypt, y no se pueden forzar sin la clave.
  - El step-up responde 400 y no 401 ante un código erróneo, porque el front trata cualquier 401 como sesión caída.
  - Hay un tope de 10 correos por usuario y por hora: quien conoce la contraseña podría abrir logins nuevos y llenar de códigos el buzón de la víctima.
- **Fuga corregida de paso:** `purchaseRequest.service` incluía filas completas de `users` (aprobador y beneficiario) en las respuestas, también en «Mis solicitudes». Eso exponía el hash bcrypt de la contraseña del aprobador. Ahora se excluyen `passwordHash` y `mfaTotpSecretEnc`. `toSafeUser` también excluye el secreto TOTP y en su lugar expone `mfaTotpEnabled`.
- **Front:**
  - el paso de segundo factor está dentro de `LoginPage` (`FactorVerifyForm`);
  - `/mfa/enroll` (`MfaEnrollPage`) y `/account/security` (`AccountSecurityPage`, con un ícono de escudo en la barra superior);
  - `EnrollFactor` genera el QR en el navegador con `qrcode` y registra passkeys con `@simplewebauthn/browser`;
  - el gate redirige a `/mfa/enroll`.
- **Infra:**
  - `MFA_REQUIRED`, `MFA_ENCRYPTION_KEY_FILE` y `WEBAUTHN_*` en los 3 compose de la API (en dev `MFA_REQUIRED` es `false` por defecto);
  - `ensure-backend-secrets.ps1` genera `mfa_encryption_key.txt` (ya generado para dev y test);
  - `Permissions-Policy` de nginx con `publickey-credentials-get/create=(self)`.

### Verificación
- `tsc` en la API y `tsc -p tsconfig.app.json` + eslint en el front, sin errores; el build de Vite funciona.
- Unitarias de la API: 170 OK, entre ellas los vectores RFC 6238, `secretBox`, los códigos de recuperación y el envoltorio de WebAuthn con mocks. Front: 69 OK.
- Integración contra Testing (`mfa.routes.integration.test.ts`): 4 de 4 OK.
  - Primer ingreso completo: correo → cambio de contraseña → enrolar TOTP → login con TOTP.
  - Rechazo de TOTP reutilizado.
  - Código de recuperación de un solo uso.
  - Bloqueo al quinto intento.
  - No se puede quitar el último factor.
  - El reset vuelve a exigir enrolamiento.
  - Passkeys apagadas responden 404.
- `passwordChangeRequired.routes.integration.test.ts` (plan 015) ya fallaba antes de este cambio. Su `resetTestData` hace `DELETE FROM users` y choca con `fk_employees_created_by` por los colaboradores que siembra el plan 014 en Testing. La prueba nueva de MFA borra solo sus propias filas.

### Pendiente
- Probar en el navegador, en especial una passkey real en dev sobre `https://localhost` con `WEBAUTHN_RP_ID=localhost`.
- Front de dev: `down -v` antes de reconstruir, porque el volumen anónimo de `node_modules` oculta las dependencias nuevas.
- No hay pantalla de administración de usuarios en el front: `userService.resetMfa` existe, pero no hay botón donde ponerlo.
- `/security-review`, commit y promoción.
- Nombre DNS interno y certificado de confianza para activar las passkeys en test/prod.
- Generar `mfa_encryption_key.txt` de producción, que se crea solo con `run.ps1 backend prod`.

---

## 2026-09-30 — Front responsivo para teléfono y galería de productos

### Hecho
- **Layout compartido:**
  - `AppLayout`: `px-3` en móvil; el saludo se oculta bajo `md`; «Cerrar sesión» pasa a ícono; hamburguesa visible sobre el azul.
  - `index.css`: tablas compactas bajo 640 px, más las utilidades `scrollbar-none` y `scrollbar-thin`.
  - `Input`, `Textarea` y `Select` con texto de 16 px en móvil (evita el zoom de iOS).
  - `Tabs` de Service Desk en una fila con scroll horizontal.
- **Pantallas (84 archivos):** los ajustes por módulo los hicieron 3 agentes UX/UI, en carpetas disjuntas.
  - Sin padding apilado: contenedor `sm:max-w-[95%] sm:px-4` y envoltorio `px-0 py-4 sm:p-4`.
  - Tablas: celdas cortas con `whitespace-nowrap` y columnas de texto con `min-w-*`; columnas secundarias ocultas en móvil.
  - Filtros y chips de vista en grilla o en una fila con scroll.
  - Botones principales a ancho completo en móvil.
- **Productos:** en teléfono se ve una galería de fotos (200 px). Tocar una abre la ficha del producto, con «Editar marca/modelo» si el rol tiene `products:update`. Desde `sm` se mantiene la tabla.

### Decisiones
- Ocultar columnas en móvil es solo presentación, no control de acceso. Solo se ocultaron datos secundarios.

### Verificación
- Front: tsc, lint, 69 pruebas y build.
- Revisión de seguridad con `cybersecurity-orchestrator` sobre `59ca199..35e409d`: **GO**, sin hallazgos.
- El usuario probó dev en el teléfono y confirmó la mejora.

### Promoción
- PR #48 `develop → testing`: lo mergeó el usuario.
- PR #50 `release/master → master`: pasó el CI («Verificar rutas prohibidas»). El gate de seguridad quedó marcado sobre `a7cb954` y `master` quedó en `6b82325`.

### Pendiente
- Redesplegar Testing y producción.
- Mejoras posibles:
  - la acción «Adjuntar» sigue dentro de la tabla en Adjuntar OC;
  - el wrapper de `Select` no tiene ancho propio dentro de un `flex`;
  - tablas anchas de acceso a salas.

---

## 2026-09-29 (6) — Redespliegue de los 3 ambientes con volúmenes nuevos

### Hecho
- El usuario volvió a crear dev, Testing y producción con volúmenes nuevos. Con eso quedan desplegados los planes 012 a 016.
- **Réplicas de la API:** healthy y sin errores en los logs.
- **Postgres (`corpdbpg`), los tres ambientes con el mismo resultado:**
  - las 5 tablas `comm_room*` y la columna `validation_warnings`;
  - el ítem ROOM_ACCESS y el grupo «Responsable TI / Seguridad»;
  - 11 permisos `comm-room*`;
  - el bundle `comm-room-entry` sin `comm-rooms:read`.

### Pendiente
- En cada ambiente:
  - agregar miembros a «Responsable TI / Seguridad»;
  - asignar a los roles los 4 bundles `comm-room-*:access`;
  - crear las salas.
- Probar en el navegador los planes 012 a 016.

---

## 2026-09-29 (5) — Revisión de seguridad del plan 016

### Resultado
- La primera ronda terminó con veredictos distintos:
  - el security-engineer dio **NO-GO**: 2 Medios, 3 Bajos y 4 informativos;
  - el orquestador dio **GO**, con 1 Bajo.
- Después de las correcciones, el security-engineer las volvió a revisar y dio **GO**.

### Correcciones
- **M1:** el beneficiario no aprueba su propio acceso. Se compara por persona y por RUT normalizado, así también cuenta un externo que usa el RUT de un colaborador. Además, esos tickets no aparecen en sus aprobaciones pendientes.
- **M2:** no valida quien pidió o registró la solicitud, ni el beneficiario.
- **B1:** un acceso aprobado ya no se anula a través del ticket; se revoca en Administrar Salas.
- **B2:**
  - los avisos de la validación salen del evento público y pasan a la columna `validation_warnings`, que ven el agente y el aprobador;
  - el aprobador que no pertenece al grupo ahora ve las notas del validador.
- **B3:** aprobar toma `FOR SHARE` sobre la sala, así no puede competir con una desactivación.
- **I1:** `minPlaces` queda acotado entre 2 y 50.
- **I2:** las búsquedas ILIKE escapan los comodines (`escapeLikePattern`).
- **L:**
  - Registrar Ingreso lista las salas por `GET /comm-room-entries/rooms`, que no devuelve la dirección;
  - el bundle `comm-room-entry` ya no incluye `comm-rooms:read`;
  - el campo nuevo `revokedIncludes` del catálogo lo quita de las bases que ya estaban sembradas, en cada arranque. Si un admin lo vuelve a agregar, también se quita.
- **Pruebas:** 3 de integración nuevas (M1, M2, B1/B2) y cobertura de L e I1 en las pruebas de rutas.
  - Suite de la API: 54 archivos, 457 pruebas.
  - Front: tsc, lint, 69 pruebas y build.

### Promoción
- PR #43 `develop → testing` pasó el CI y se hizo el merge. El gate de seguridad quedó marcado sobre `5e6af63`.
- PR #44 `release/master → master`. `promote-to-master` excluyó las 3 pruebas del plan 016 y `master` quedó en `0233437`.

### Pendiente
- Redesplegar Testing y producción.
- En cada ambiente:
  - agregar miembros a «Responsable TI / Seguridad»;
  - asignar a los roles los 4 bundles `comm-room-*:access`;
  - crear las salas.
- Probar en el navegador.

---

## 2026-09-29 (4) — Plan 016: Acceso a Salas de Comunicaciones (aprobado)

### Hecho
- Plan aprobado y copiado a [`planes/016-acceso-salas-comunicaciones.html`](planes/016-acceso-salas-comunicaciones.html).

### Decisiones
- **Módulo:** Gerencia de TI › Serv. Productivos › Comunicaciones › Acceso Sala, con 4 pantallas: Crear Sala, Administrar Salas, Registrar Ingreso y Consulta de Accesos.
- **Solicitud:** el acceso solo se pide por ticket, con el ítem de catálogo `fulfillment = ROOM_ACCESS`.
- **Flujo:** el Service Desk valida y define el período y el tipo; después aprueba el grupo «Responsable TI / Seguridad». Si rechaza, el ticket queda Cancelado; si aprueba, se crea el registro de acceso y el ticket queda Resuelto.
- **Beneficiario:** un colaborador (RUT exacto) o un externo (nombre, RUT y empresa).
- **Tipos de acceso:**
  - Temporal y Única vez llevan fecha de término y expiran solos;
  - Permanente no tiene término;
  - un temporal cuenta como «prolongado» si lleva más de N días activo (configurable, 30 por defecto).
- **Ingresos físicos:** Registrar Ingreso anota la entrada y la salida, y rechaza a quien no tenga acceso vigente.

### Implementación
- **API (`4fd205a`):**
  - `migrateCommRooms()`: las tablas `comm_rooms`, `comm_room_access_requests`, `comm_room_access_grants`, `comm_room_entries` y `comm_room_settings`. Amplía el CHECK de `fulfillment` a `ROOM_ACCESS`, verificándolo antes en `pg_constraint`, y siembra el grupo «Responsable TI / Seguridad» (sin miembros) y el ítem «Acceso a sala de comunicaciones».
  - `ticket.service`:
    - el ticket nace NEW, sin aprobación al crearse;
    - `submitRoomAccessForApproval` lo pasa a PENDING_APPROVAL con el grupo del ítem, con el SLA en pausa (`on_hold_since`);
    - `decideApproval` crea el grant y deja el ticket RESOLVED/FULFILLED; quien validó no puede aprobar, y rechazar lo anula (CANCELLED);
    - no se puede resolver a mano sin aprobación.
  - Ingresos con lock e índice único de ingreso abierto. Un acceso de única vez expira al registrar la salida.
  - Barrido `accessSweeper` cada 60 s, con lease en Redis. «Vigente» siempre se calcula con `now()` de la base.
  - Reportes: accesos vigentes, vencidos, por RUT exacto, varias salas o tiendas, y temporales prolongados (N días configurable).
  - Corrección aparte: pasar de ON_HOLD a CANCELLED repetía `on_hold_since` en el UPDATE.
- **Front:**
  - pantallas `pages/comunicaciones/`: Crear Sala, Administrar Salas, Registrar Ingreso y Consulta de Accesos;
  - `RoomAccessFields` en Generar Ticket y `RoomAccessPanel` (validar y enviar a aprobación) en Gestión de Tickets;
  - en Configuración del Service Desk, el «Tipo de atención» pasa a ser un selector.

### Verificación
- `commRoomAccess.service.integration.test.ts` (17 pruebas) y `commRoom.routes.integration.test.ts` (5, cada bundle con solo sus endpoints y el portal sin dirección).
- `rut.unit.test.ts` (4 pruebas).
- API: suite completa verde (52 archivos, 445 pruebas, antes de las pruebas de rutas). Front: tsc, ESLint, 69 pruebas y build.

### Pendiente
- Revisión de seguridad y promoción a master.
- En cada ambiente, el admin debe:
  - agregar miembros al grupo «Responsable TI / Seguridad»;
  - asignar las 4 pantallas `comm-room-*:access`;
  - crear las salas.
- Probar en el navegador.

## 2026-09-29 (3) — Revisión de seguridad y promoción del plan 015

### Hecho
- **Revisión** del delta `ecf09a8..5467f85` con `cybersecurity-orchestrator` y `security-engineer`: los dos dan **GO**, sin hallazgos Critical, High ni Medium.
- Las correcciones van en el commit de esta entrada:
  - `/auth/me` también informa la marca cuando el acceso es por token Bearer (`req.passwordChangePending`).
  - `/auth/refresh` relee `mustChangePassword` e `isActive` de la BD, así un refresh token anterior no esquiva la marca.
  - La contraseña por defecto se lee una vez y queda en caché.

### Pendiente
- **Despliegue:** las sesiones de cookie abiertas antes del deploy (hasta 8 h) no traen la marca. Si se quiere un corte inmediato, hay que purgar las `sess:*` de Redis al desplegar.
- **Residual, anterior al plan:** quien conozca la contraseña por defecto y el username de alguien que todavía no entró puede tomar esa cuenta cambiándole la contraseña. La solución de fondo es una contraseña inicial aleatoria por usuario o un enlace de activación.

## 2026-09-29 (2) — Plan 015: la API no acepta la contraseña por defecto (aprobado e implementado)

### Hecho
- Plan aprobado y copiado a [`planes/015-contrasena-por-defecto-bloqueada.html`](planes/015-contrasena-por-defecto-bloqueada.html). Cierra el hallazgo L1 de la revisión del 2026-09-29.
- **Marca al iniciar sesión:** la sesión Redis (o el JWT, si se piden tokens) queda marcada cuando el usuario tiene `mustChangePassword` o entra con la contraseña por defecto. `/auth/refresh` conserva la marca.
- **Bloqueo:** `authenticate` responde 403 con `reason: "password_change_required"`. Solo pasan `/auth/me`, `/auth/menu` y `/auth/change-password` (`authenticateAllowingPasswordChange`). Socket.IO también rechaza el handshake.
- **Contraseña nueva:** `PATCH /auth/change-password` rechaza la contraseña por defecto con 400.
- El front no cambia: `/auth/me` ya informaba `mustChangePassword` y ahora también toma en cuenta la marca de la sesión.

### Verificación
- `passwordChangeRequired.routes.integration.test.ts`:
  - login real: 403 en una ruta de negocio;
  - `/auth/me` y `/auth/menu` responden 200;
  - usar la contraseña por defecto como nueva da 400;
  - el cambio da 204 y el siguiente login tiene acceso;
  - la contraseña por defecto bloquea aunque la cuenta no tenga el flag.
- `tsc` limpio. Suite completa: 51 archivos, 428 pruebas OK.

### Pendiente
- Las sesiones abiertas antes del despliegue no traen la marca. Se aplica desde el siguiente inicio de sesión.
- Revisión de seguridad y promoción a master.

## 2026-09-29 (1) — Revisión de seguridad y promoción del plan 014 a master (PR #39, #40)

### Hecho
- Commit `b70f373`: título de la pestaña del front «Corporate View».
- **Revisión de seguridad** del delta `aded34e..b70f373`, en paralelo por `cybersecurity-orchestrator` y `security-engineer`: ambos dan **GO**, sin hallazgos Critical, High ni Medium.
- **Commit `ecf09a8`** corrige lo barato:
  - el log de un JSON inválido ya no serializa el error completo, que trae trozos del archivo; ahora solo lleva el nombre del error y las rutas de Zod;
  - dirección, AFP y salud se completan en el siguiente arranque si uno anterior se cortó a medias;
  - el plan 014 ya no cita la dirección de los datos reales. Sigue en el historial de `develop`, porque el impacto es bajo y no se reescribe.
- **PR #39** `develop → testing`, con CI verde.
- **Gate de seguridad** marcado sobre `ecf09a8`.
- **PR #40** `release/master → master`: se excluyeron `compose.dev/test` y las 2 pruebas de la semilla, y el chequeo de rutas prohibidas pasó. `master` quedó en `6e25ed2`.

### Pendiente (no bloqueante)
- **L1 (ticket):** `mustChangePassword` solo lo aplica el front. Un usuario con la password por defecto puede llamar a la API directo. Hay que bloquear en el servidor todo lo que no sea `/auth/me`, cambiar password y logout. Afecta también a Nuevo Ingreso en producción.
- **Info:** la semilla crea roles y usuarios sin las reglas de actor de las pantallas (prefijo 1110, rol admin). Es aceptable porque el JSON vive en `corporate-secrets`. Un rol renombrado a mano se recrea al reiniciar (solo dev/test).
- Instalación limpia en Testing (recrear volúmenes) para ver la siembra completa.

## 2026-09-28 (18) — Plan 014: datos de prueba en dev/test y manual de operación (aprobado)

### Hecho
- Plan aprobado y copiado a [`planes/014-datos-de-prueba-y-manual.html`](planes/014-datos-de-prueba-y-manual.html).

### Decisiones
- **Datos de prueba** (9 roles con sus permisos, 9 cargos, CCAF/mutual, gratificación y 9 colaboradores): van en `corporate-secrets/{Development,Testing}/seed_test_data.json`, fuera de git, porque tienen RUT, nombres y correos reales. Solo `compose.dev/test` los montan.
- **Correcciones sobre lo que hay en Development:**
  - vendedora «CONSTANZA ANDREA BRITTANY», sexo F;
  - `5802-gerente-tienda` lleva «Devoluciones de Activos (edición)» en vez de «Dar de Baja Activos».
- **Manual de operación:** lo redacta el agente de documentación y se publica como Artifact.

### Implementación
- **Commit `0447677`:**
  - `databases/seedTestData.ts` (semilla), `seedTestData.schema.ts` (Zod) y su prueba unitaria;
  - prueba de integración con datos ficticios: siembra completa, repetición sin duplicar, y archivo vacío o inválido;
  - `SEED_TEST_DATA_FILE` montado solo en `compose.dev/test`;
  - `ensure-backend-secrets` crea `seed_test_data.json` vacío si falta, así el stack levanta igual.
- **Datos:** `corporate-secrets/{Development,Testing}/seed_test_data.json` se exportó de Development con solo lecturas. Las instituciones, la comuna (código territorial 13101), los centros de costo, los cargos y los roles van por código o nombre, no por id.
- **Verificación:**
  - Development recreado con el secret: las 3 réplicas arrancaron y no duplicaron nada;
  - 142 pruebas unitarias OK;
  - integración de la semilla contra Testing: 2/2 OK.
- **Manual:** publicado como Artifact (https://claude.ai/artifact/Utxi8ShZe9FYKaWjvD5SnN). Sobre el borrador del agente se corrigieron:
  - los estados que acepta Dar de Baja y que la clasificación es previa;
  - los folios (SOL/COT/OC, INC/REQ/PRB/CHG/KB, IT y DEV);
  - que el tag se asigna al recepcionar, y que la baja contable no escribe en el Kardex;
  - las transiciones del ciclo de vida.

### Pendiente
- **Probar desde cero en Testing** con los volúmenes recreados. No se hizo porque borra los datos de ese ambiente.
- **Development conserva sus datos anteriores**, porque la semilla no pisa lo existente: la vendedora sigue como «CONTSTANZA … BRITANY» (M) y el gerente sigue con «Dar de Baja». Se corrigen a mano o al recrear los volúmenes.
- **Producción:** no lleva el archivo. El código va a master, pero no se ejecuta.

---

## 2026-09-28 (17) — Promoción de los planes 012 y 013 a master (PR #37, #38)

### Hecho
- **PR #37** `develop → testing` (delta `7275cdc..6a1b0d9`) con CI verde, mergeado (`b3ad2a5`). Gate de seguridad marcado sobre `6a1b0d9`.
- **PR #38** `release/master → master`: se excluyeron 6 archivos de prueba y la guardia de rutas prohibidas pasó. `master` quedó en `512028b`.

### Pendiente
- **Redesplegar Testing y producción.** La migración crea el estado `WRITTEN_OFF`, renombra `DECOMMISSIONED`, crea la tabla de fotos y hace el backfill. La siembra agrega el permiso y la pantalla de Dar de Baja, y `update` a Valorización.
- **Asignar permisos:**
  - «Pantalla: Dar de Baja Activos» a los roles que correspondan;
  - «Devoluciones de Activos (edición)» a los roles 1110 que deban recibir.
- **Revisar** qué roles tienen «Valorización de Activos» (I1).
- **Probar en el navegador** el ciclo devolución → dar de baja con foto → baja contable individual y por lote.

---

## 2026-09-28 (16) — Revisión de seguridad del delta 7275cdc..2aec9e3 (planes 012 y 013, devoluciones, siembra)

### Hecho
- Revisión con los dos agentes, **cybersecurity-orchestrator** y **security-engineer**, en paralelo e independientes. Ambos dan **GO**, sin hallazgos críticos ni altos.
- **M1 (Media), corregido.** Lo reportaron los dos. El privilegio «recibir devoluciones» sale del prefijo `1110-` del nombre del rol, y `PUT /roles/:id` no controlaba quién renombraba, ni siquiera el propio rol.
  - Ahora un no-admin no edita su propio rol ni el de admin, la misma regla que ya aplicaba a los permisos de un rol.
  - Solo un admin crea un rol `1110-…`, o pone o quita ese prefijo al renombrar.
  - El prefijo se compara como texto: `01110-x` ya no cuenta como Sistemas.
- **M2 (Media, previo pero expuesto por el plan 012), corregido.** Solo lo reportó security-engineer.
  - El problema: un `POST /asset-movements` con `SUPPORT` (permiso `asset-movements:create`, que tiene grantToUser) sacaba de la baja un activo «Pendiente de baja contable», con el Kardex en 0.
  - Ahora ese activo solo sale como `WRITTEN_OFF` (baja contable) o `DEVALUATED` (encontrado en uso en una toma).
- **B1 (Baja), corregido.** Solo lo reportó security-engineer. La baja contable aceptaba la foto de una baja anterior del mismo activo. Ahora solo cuenta, se muestra y se sirve la foto del último movimiento `DECOMMISSIONED`.
- **Informativos, sin cambio:**
  - I1: al desplegar, todo rol con «Valorización de Activos» recibe `asset-valuation:update`, por decisión del usuario. Conviene revisar qué roles la tienen.
  - I2: un activo `WRITTEN_OFF` puede volver a usarse devaluado, con valor 0 y sin vía de revalorización.
- **Pruebas:**
  - regresión nueva para M1, M2 y B1;
  - 140 unitarias; integración contra Testing en dar de baja, baja contable, escalamiento de permisos, inventario, movimientos, devoluciones, depreciación, valorización, contabilidad y roles: 123 OK;
  - front: `tsc` y lint.
- Como en run-2, el orquestador solo no vio M2 ni B1: la revisión cruzada sigue siendo necesaria.

---

## 2026-09-28 (15) — Instalación limpia: sin productos de ejemplo

### Hecho
- Se quitó `seedProducts()` (`services/mongo/product.service.ts` y su llamada en `index.ts`). Sembraba en el primer arranque 3 productos de ejemplo (un notebook Dell, una impresora en arriendo y un soporte de servidores), uno por tipo de producto. Ahora el catálogo de productos nace vacío.
- Se mantiene la siembra de las categorías de producto, que son las reales del negocio.
- Las bases que ya tienen esos productos no cambian; si sobran, se desactivan desde la pantalla.

---

## 2026-09-28 (14) — Plan 013: foto al dar de baja y baja contable individual o por lote (aprobado)

### Hecho
- Plan aprobado y copiado a [`planes/013-foto-baja-y-baja-contable-por-lote.html`](planes/013-foto-baja-y-baja-contable-por-lote.html).

### Decisiones
- **Foto obligatoria al dar de baja:** en Dar de Baja Activos, y queda guardada por activo.
- **Estados:**
  - `DECOMMISSIONED` se muestra como «Pendiente de baja contable».
  - Estado nuevo `WRITTEN_OFF` «De baja», que se asigna al confirmar la Baja Contable.
- **Baja Contable:**
  - individual (1 activo, 1 certificado) o por lote (todos los pendientes, 1 certificado);
  - reutiliza la foto tomada al dar de baja;
  - a lo que dio de baja la Toma de Inventario (sin foto) se le pide la foto ahí.

### Implementación
- **Migración:**
  - estado `WRITTEN_OFF` «De baja»; `DECOMMISSIONED` pasa a llamarse «Pendiente de baja contable»;
  - tipo de movimiento `WRITTEN_OFF`;
  - tabla `asset_decommission_photos`, con los archivos en `uploads/bajas-operativas/<activo>`;
  - backfill: los activos que ya tenían baja contable pasan a `WRITTEN_OFF`.
- **API, Dar de Baja:**
  - `POST /asset-movements/decommission` es multipart, con la foto obligatoria (`uploadSingle` de imagen, 5 MB);
  - el archivo se guarda en la misma transacción y se borra si la transacción falla;
  - `GET /asset-movements/decommission/:assetId/photo`.
- **API, Baja Contable:**
  - `POST /asset-write-offs` con `{ allPending: true }` arma la baja por lote: todos los pendientes que no estén en otro borrador, hasta 200;
  - el detalle trae `decommissionPhotos`, servidas por `GET /asset-write-offs/:id/decommission-photos/:photoId`, que exige que el activo sea una línea de esa baja;
  - al confirmar, cuentan también las fotos de la baja operativa, y cada activo pasa a `WRITTEN_OFF` con su movimiento «Baja contable N° X».
- **`WRITTEN_OFF` se trata igual que `DECOMMISSIONED`:**
  - en contabilidad, depreciación, valorización y faltantes de inventario;
  - en la toma de inventario: si se encuentra en uso, queda devaluado;
  - si un activo con baja contable se vuelve a dar de baja, queda `WRITTEN_OFF` y no vuelve a quedar pendiente;
  - ningún otro movimiento sale de `WRITTEN_OFF`.
- **Front:**
  - Dar de Baja: campo de foto (cámara en móvil) con vista previa; es obligatorio para confirmar;
  - Baja Contable: botón «Baja individual» por fila, «Baja por lote (todos los pendientes: N)» y «Baja de los seleccionados»;
  - el borrador muestra la foto de la baja operativa y solo pide foto a las líneas que no tienen.
- **Pruebas:**
  - API: 140 unitarias; 115 de integración contra Testing (dar de baja, baja contable, inventario, depreciación, valorización, contabilidad, movimientos y devoluciones);
  - front: `tsc`, lint y 69 pruebas.

---

## 2026-09-28 (13) — Devoluciones: solo Sistemas (1110) recibe

### Decisión
- **Antes:** quien solicitó o envió una devolución no podía recibirla, salvo un admin. Esto bloqueaba al analista que hace la toma, pide el despacho a la tienda y luego lo recepciona, o cuando no está el analista de Adquisiciones.
- **Ahora:** recibe solo quien tiene un rol del centro de costo **1110** (Sistemas), o un admin, aunque haya solicitado o enviado la devolución. Los demás centros de costo solo solicitan. Se sigue exigiendo `asset-returns:update`.
- **Cómo se sabe el centro de costo:** por el prefijo del rol. Nuevo Rol arma el nombre como `<código>-<nombre>`, y el usuario recibe el rol por su cargo.

### Implementación
- **API:**
  - `library/roleCostCenter.ts` con `isSystemsRole`, más su prueba unitaria.
  - `AssetReturnActor.isSystems` se toma del rol de la sesión.
  - `receiveAssetReturn` responde 403 si el usuario no es de Sistemas ni admin.
- **Front:**
  - `lib/roleCostCenter.ts` aplica la misma regla.
  - El detalle muestra «Pendiente de recepción por Sistemas» a quien no puede recibir.
- **Pruebas:** integración de devoluciones 32/32 contra Testing.

### Ojo
- La API no valida el prefijo al crear o renombrar roles; hoy solo lo arma el front. Quien tenga `roles:create`/`roles:update` podría crear un rol `1110-…`, pero para eso ya administra roles.

---

## 2026-09-28 (12) — Plan 012: Dar de Baja Activos y valorización habilitada (aprobado)

### Hecho
- Plan aprobado y copiado a [`planes/012-dar-de-baja-activos.html`](planes/012-dar-de-baja-activos.html).

### Decisiones
- **Estados que se pueden dar de baja:** los que están en TI (`RETURNED`, `SUPPORT` sin ticket, `DAMAGED`, `AVAILABLE`, `RECEIVED`).
- **Clasificación contable exigida.**
- **Motivo obligatorio** de una lista más un detalle.
- **Excepción a la regla lectura/edición:** «Pantalla: Valorización de Activos» incluye también `asset-valuation:update`. Los analistas veían la pantalla pero no podían ingresar el valor.

### Implementación
- **API:**
  - Permiso base `asset-decommissions:create`, sin `grantToUser`.
  - `getDecommissionCheck` devuelve estado, centro de costo, clasificación, ticket abierto, `eligible` y `blockReason`.
  - `decommissionAsset`: una transacción; bajo el bloqueo de la fila repite la validación de estado y de clasificación, y luego llama a `createAssetMovement(DECOMMISSIONED)`, con el motivo en el movimiento y en el asiento `WRITE_OFF` (`recordWriteOff` ahora recibe `notes`).
  - Rutas: `GET /asset-movements/decommission/:assetId` y `POST /asset-movements/decommission`.
  - El POST genérico `/asset-movements` ya no acepta `DECOMMISSIONED`.
- **Permisos y menú:**
  - Agrupador `asset-decommission`, con `assets:read` y `asset-decommissions:create`.
  - Hoja «Dar de Baja Activos» en Movimiento Activos.
  - `asset-valuation-view` incluye `:update`; `asset-valuation-edit` queda redundante («edición, incluida en la pantalla»).
- **Front:** pantalla `DecommissionAsset.tsx`:
  - búsqueda con aviso por estado;
  - revisión previa, con un `Alert` si algo bloquea la baja;
  - motivo y detalle;
  - modal de confirmación que advierte que la baja es definitiva.

### Verificación
- **API:** `tsc` limpio y 137 tests unitarios. Nuevo `assetDecommission.service.integration.test.ts` (4 tests), que cubre:
  - un activo devuelto y clasificado queda de baja, con el motivo en el Kardex, y aparece en Baja Contable;
  - sin clasificar, 409;
  - asignado, 409;
  - «Otro» sin detalle, 400.
  Las suites de movimientos, inventario, baja contable, kardex, contabilidad, valorización, permisos y menú suman 103 tests OK.
- **Front:** `tsc`, lint y 69 tests OK.
- **Development:** reiniciado.
  - La hoja nueva está en su lugar y el agrupador de valorización ya incluye `update`.
  - Los roles con esa pantalla son `1072-analista-contable`, `1110-analista-adquisiciones`, `1110-jefe-soporte` y admin, y todos pueden ingresar el valor.

### Pendiente
- Asignar «Pantalla: Dar de Baja Activos» a los roles que corresponda.
- Probar en el navegador.
- Revisión de seguridad antes de promover.

## 2026-09-28 (11) — Revisión de seguridad del delta acc720c..74d82cb (plan 011 y acta) y promoción

### Hecho
- **PR #35** `develop → testing`.
- **Revisión de seguridad del delta:** reasignar, asignación vigente, listado de asignaciones, marca/modelo en productos y acta.
  - **F1, Baja/Media, corregido:** el filtro «usuario» del listado (`findUserIdsBySearch`) buscaba el RUT con `LIKE` parcial. Con pantallas de solo lectura («Visualizar Asignaciones», «Formulario Asignación») se podía reconstruir el RUT de un colaborador por tramos, viendo qué nombre aparecía. Antes, ligar RUT y nombre exigía `persons:read` o `asset-movements:create`. Ahora el RUT se busca solo completo (con o sin puntos) y el nombre sigue siendo parcial. El test cubre que un RUT parcial no encuentra nada.
  - **Sin hallazgos:**
    - SQL parametrizado; la serie se escapa y el centro de costo se valida como entero.
    - La categoría se valida como ObjectId, así que no hay inyección de operadores en Mongo.
    - Reasignar usa `asset-movements:create` (el mismo que ya permitía `REASSIGNED`), bloquea la fila y rechaza usuarios inactivos.
    - `/current/:assetId` expone lo mismo que el acta, con el mismo permiso.
    - Marca y modelo tienen largo máximo y se muestran escapados.
- **PR #35** con CI verde, mergeado a `testing` (`e59120e`). Gate marcado sobre `7275cdc`.
- **PR #36** `release/master → master`: se excluyeron 2 tests nuevos y la guardia pasó. `master` quedó en `71bc4ec`.

### Pendiente
- Redesplegar Testing y producción: la siembra mueve el menú, crea los 3 agrupadores y la API trae el acta nueva.
- Completar marca y modelo de los productos; asignar los agrupadores nuevos a los roles; probar en el navegador.

## 2026-09-28 (10) — Acta de entrega con el formato del formulario de TI

### Hecho
- **Formato:**
  - márgenes de 0,5 cm;
  - membrete solo con el logo y párrafo de objetivo (cambios del usuario);
  - tablas de 2 columnas: «Identificación del empleado» y «Equipamiento | Especificaciones», con encabezado sombreado y valores centrados.
- **Fecha:** la de la asignación (antes, la de generación del PDF; al reimprimir salía la fecha del día), en hora de Chile y en negrita.
- **Valor del activo** en CLP («Sin valorizar» si no tiene).
- **Filas fijas del equipamiento:** Marca, Modelo, Número de Serie, Número de Tag, Proveedor, Almacenamiento, Memoria (RAM), Bolso / Mochila, Candado / Seguro, Cargador, MAC Address y Valor (al final, decisión del usuario).
- **«No Aplica» según el tipo de equipo** (`library/equipmentKind.ts`, por el nombre de la categoría del producto):
  - bolso y candado solo en notebook;
  - cargador en notebook o monitor;
  - MAC en notebook o desktop.
- **Marca y modelo en el catálogo** (decisión del usuario): nuevos `brand` y `productModel` en Producto (`model` choca con `Document.model()` de Mongoose).
  - Se cargan en Nuevo Producto.
  - En Ver Productos se ven como columnas y se editan con «Editar marca/modelo», visible solo con `products:update`.

### Verificación
- `tsc` limpio en API y front, más lint del front.
- Tests: 137 unitarios (incluye `equipmentKind.unit.test.ts`), 7 de integración de reasignación y acta, y 69 del front.
- Actas de prueba revisadas visualmente para notebook y desktop.

### Pendiente
- Completar marca y modelo de los productos existentes desde Ver Productos.
- Crear la categoría de monitores cuando corresponda: la regla la reconoce por el nombre («MONITOR…»).

## 2026-09-28 (9) — Plan 011: Movimiento de Activos (aprobado)

### Hecho
- Plan aprobado y copiado a [`planes/011-movimiento-activos.html`](planes/011-movimiento-activos.html).
- **Carpeta nueva** «Movimiento Activos» bajo Adquisiciones, con 4 pantallas:
  - Asignar Activos (se mueve desde «Productos»);
  - Reasignar Activos;
  - Visualizar Asignaciones;
  - Formulario Asignación.

### Decisiones
- **Formulario Asignación:** reimprime el acta de la asignación vigente.
- **Cambio de centro de costo:** también es un movimiento `REASSIGNED` (mismo usuario más una nota) y genera acta nueva.
- **Reasignar a otro usuario:** pide los datos de entrega, precargados con los de la asignación anterior, y descarga el acta.

### Implementación
- **API:**
  - `reassignAsset`: una sola transacción que bloquea el activo; acepta `ASSIGNED` o `DEVALUATED` (este último sigue `DEVALUATED`, valor 0). Tenedor por defecto: el vigente. 400 sin cambios; 409 si el activo no está asignado o el usuario destino está inactivo. Si cambia el centro de costo usa `updateAssetLocation`. La nota automática dice qué cambió.
  - `getCurrentAssignment`: tenedor vigente y último movimiento con acta (`ASSIGNED`/`REASSIGNED`/`DEVALUATED`).
  - `listAssignments`: SQL con `LATERAL` sobre el último movimiento. Los filtros de categoría (Mongo) y de usuario (MSSQL, `findUserIdsBySearch`) se resuelven primero a ids. Devuelve solo el nombre del tenedor.
  - Rutas: `POST /asset-movements/reassign` (`asset-movements:create`), `GET /asset-movements/current/:assetId` (`:read`) y `GET /asset-movements/assignments` (`assets:read` y `asset-movements:read`).
- **Permisos y menú:**
  - Agrupadores `asset-reassignment`, `asset-assignment-list` y `asset-handover-form`.
  - Carpeta «Movimiento Activos»; «Asignar Activos» se movió ahí.
- **Front:**
  - Pantallas nuevas `ReassignAsset`, `AssetAssignments` y `AssetHandoverForm`.
  - Piezas compartidas: `HandoverFields`, `handover.ts` y `AssignmentsTable`. `AssignAsset` reutiliza las dos primeras (el jefe directo pasó a la grilla de datos de entrega).

### Verificación
- **API:** `tsc` limpio y 132 tests unitarios. Nuevo `assetMovementReassign.service.integration.test.ts` (6 tests). Las suites de movimientos, inventario, devoluciones, permisos, menú y Service Desk suman 150 tests OK contra Testing.
- **Front:** `tsc -p tsconfig.app.json`, lint y 69 tests OK.
- **Development:** reiniciado; el menú muestra la carpeta con sus 4 hojas.
  - Los agrupadores nuevos los tiene admin.
  - «Formulario Asignación» además lo recibió `1110-analista-adquisiciones`: la primera siembra lo da a quien ya tenía sus permisos base.

### Pendiente
- Probar las 3 pantallas en el navegador.
- Revisión de seguridad antes de promover: endpoint nuevo que lista tenedores y escribe movimientos.

## 2026-09-28 (8) — Promoción a master (PR #33, #34)

### Hecho
- **PR #33** `develop → testing` (fix F1), CI verde, mergeado (`85b1101`).
- **Gate de seguridad** marcado sobre `acc720c`.
- **PR #34** `release/master → master`: `promote-to-master` excluyó los 2 tests de integración modificados y la guardia de rutas prohibidas pasó. `master` quedó en `79ee420`.

### Pendiente
- **Redesplegar Testing y producción:** al arrancar, la API siembra los agrupadores «(edición)» y los permisos agregados.
- **Asignar agrupadores:** el admin da «Toma de Inventario (edición)» (y los demás que correspondan) a los roles que operan esas pantallas.

## 2026-09-28 (7) — Revisión de seguridad del delta b23e80d..c629028 (PR #32) y corrección F1

### Hecho
- **PR #32** `develop → testing` mergeado (`c629028`), con CI verde.
- **Revisión de seguridad del delta** (agrupadores, folio IT, aviso en Asignar Activos, setup de integración):
  - **F1, Baja/Media, corregido:** «Nuevo Producto» había recibido `products:update` para subir la imagen, pero eso deja editar cualquier producto con `PUT /products/:id`. Ahora `POST /products/:id/image` acepta `products:create` o `products:update`, y el agrupador vuelve a `products:create` + `product-categories:read`. El vínculo sembrado se borró a mano en Development y Testing.
  - **F2, Baja, aceptado:** con `addresses:create`, «Crear Proveedor» también podría agregar una dirección a una persona por `personId`. Solo escribe y no expone datos.
  - **F3, informativo:** con `asset-movements:read`, «Asignar Activos» ve movimientos y actas de otros. Aceptado; es necesario para el acta.
  - **Sin hallazgos:** folio, toast (texto escapado por React) y `setupIntegration.ts` (solo pruebas).

### Verificación
- `tsc` limpio, 132 tests unitarios, tests de integración de permisos y menú (17) en verde. Development reiniciado; `product-creation` queda con `products:create` y `product-categories:read`.

## 2026-09-28 (6) — Asignar Activos explica por qué un activo no se puede asignar

### Hecho
- **Reporte:** un equipo dado de alta en una toma de inventario (`ARR000000002`) no aparecía en Asignar Activos. La búsqueda sí lo encontraba (por tag o serie), pero la pantalla descarta lo que no está `AVAILABLE`, y el alta de la toma lo deja `ASSIGNED` al tenedor. El mensaje decía «no se encontró».
- **Cambio:** si la búsqueda encuentra activos pero ninguno está disponible, el toast dice «El activo X ya se encuentra asignado» o muestra el estado en que está. «No se encontró» queda solo para cuando no existe ninguno.

### Verificación
- `tsc -p tsconfig.app.json` y eslint del archivo, limpios.

## 2026-09-28 (5) — Folio de toma de inventario sin guiones

### Hecho
- `generateInventoryCountNumber` genera `IT2026000001`: prefijo, año y correlativo de 6 dígitos (el mismo contador por año). Las tomas anteriores conservan `IT-AAAA-NNNNNN`, igual que los tickets.
- Actualizado el test de integración que espera el formato.

### Verificación
- `tsc` limpio. Tests de integración de toma de inventario contra Testing: 47 OK.

## 2026-09-28 (4) — Permisos faltantes en pantallas y agrupadores de edición

### Hecho
- **Auditoría de todas las pantallas implementadas:** un script cruzó, para cada hoja del menú, los permisos que su página exige (endpoints que llama más `can()` y `RequirePermissions`) con los includes de su agrupador.
- **Permisos que la propia pantalla necesitaba** (la acción fallaba con 403):
  - Asignar Activos: `asset-movements:read`, para el acta de entrega que se descarga al asignar (el caso reportado con pburgos).
  - Crear Proveedor: `addresses:create` y `supplier-contacts:create`.
  - Nuevo Producto: `products:update` (imagen) y `product-categories:read`.
  - Ver Productos y Actualizar Categorías: `product-categories:read`.
  - Autorizar Solicitud y Aprobar Cotización: `products:read`.
- **Agrupadores de edición nuevos**, sin hoja de menú. El de la pantalla sigue siendo de solo lectura y abre el menú; el rol necesita los dos:
  - «Toma de Inventario (edición)»: `inventory-counts:create/update`, productos y categorías.
  - «Valorización de Activos (edición)».
  - «Devoluciones de Activos (edición)».
  - «Carga Masiva de Activos (edición)».
  - «Depreciación (anular cierre)».

### Decisiones
- **Lectura y edición separadas** (usuario): no se amplía el agrupador de lectura; la edición se otorga con su propio agrupador. En la primera versión se había ampliado «Toma de Inventario», y se borraron a mano esos 4 vínculos en Development y Testing, porque la siembra solo agrega.
- **Por diseño:** las pestañas opcionales (Service Desk, historial de servicio en el Kardex, datos de remuneraciones en Nuevo Ingreso) se ven según sus propios permisos y ya se consultan con `can()`.

### Verificación
- `tsc` limpio, 132 tests unitarios y los tests de integración de permisos y menú (17) en verde.
- Development reiniciado; los agrupadores quedan en la BD y los nuevos solo los tiene admin.

### Pendiente
- Al rol de pburgos, darle «Toma de Inventario (edición)». Después debe cerrar sesión y volver a entrar.

## 2026-09-28 (3) — Tests de integración contra Testing y hosts desde ALLOCATED_IP

### Hecho
- **Causa del timeout:** Testing estaba construido desde una rama local `testing` desactualizada (`92493e1`, 34 commits atrás). Su Redis no tenía el usuario ACL `pristest` (llegó en PR #27) y los tests quedaban reintentando con `WRONGPASS`. Se avanzó la rama local a `origin/testing` y el usuario recreó el stack.
- **`ALLOCATED_IP`:** `test/setupIntegration.ts` lee solo `ALLOCATED_IP` de `corporate-secrets/Environment/.env` y la usa en los `*_HOST` de `.env.test` que valen `${ALLOCATED_IP}` o están vacíos (un host explícito gana). `.env.test.example` y `TESTING.md` lo explican. Así no se vuelve a copiar una IP vieja.
- **Folios:** dos asserts viejos (`/^REQ-/`, `/^PRB-/`) pasaron al formato nuevo.

### Verificación
- Suite de integración completa contra Testing: 28 archivos, 264 tests OK, 4 saltados, incluido `purchaseLink.service.integration.test.ts` (11 tests). `tsc --noEmit` limpio.

### Pendiente
- Redespliegue de producción, prueba en navegador y promoción de este commit.

## 2026-09-28 (2) — Promoción del plan 010 y de los folios con código de grupo a master (PR #30, #31)

### Hecho
- **Commits en `develop`:** `0317ea2` (API), `b9d8a93` (front) y `b23e80d` (docs).
- **Revisión de seguridad** (skill `security-review` sobre todo el delta): sin hallazgos. Gate marcado sobre `b23e80d`.
- **PR #30** `develop → testing`: CI verde (API y Web).
- **PR #31** `release/master → master`: `promote-to-master` excluyó 4 archivos de prueba y la guardia de rutas prohibidas pasó. `master` quedó en `d2175ce`.

### Pendiente
- **Tests de integración:** `purchaseLink.service.integration.test.ts` y el test ajustado de folios no se corrieron. El build de Testing falló con `ERR_SSL_CIPHER_OPERATION_FAILED` en `npm install` (red) y `.env.test` apunta a la IP vieja (.4 en vez de .5).
- **Redespliegue:** Testing y producción. La migración asigna los códigos de grupo, convierte «Solicitud de equipo», retira «Nueva Solicitud» y da «Generar Ticket» a los roles que la tenían.
- **Navegador:** probar el ciclo completo.

## 2026-09-28 (1) — Folios del Service Desk sin guiones y con código de grupo (sin commitear)

### Hecho
- **Formato nuevo:** `REQ202601000001` = prefijo + año + código del grupo que recibe el registro al crearse + correlativo de 6 dígitos, común por prefijo y año. Se aplica a INC, REQ, PRB y CHG. KB no tiene grupo y queda como `KB2026000001`. Sin grupo, el código es `00`.
- **Código de grupo:** `support_groups.code`, de 2 dígitos (01 a 99), único y fijo. `createGroup` asigna el siguiente libre bajo un advisory lock. La migración asignó los códigos a los grupos existentes por orden de id. En Configuración Service Desk se ve como «Código NN».
- **Integración:** el test ajustado espera el formato nuevo.
- **Fix:** el test unitario que usaba `import()` dinámico no compilaba con `tsc`; pasó a import estático.

### Decisiones
- **Número fijo:** el código es el del grupo que recibió el registro al crearse. Si después se escala, el número no cambia.
- **Registros existentes:** conservan su folio con guiones (en dev, `REQ-2026-000001`, `INC-2026-000001` e `INC-2026-000002`).

### Verificación
- `tsc` de la API y del front y ESLint: OK.
- **Unit:** 132 correctos.
- **Dev:** códigos 01 Mesa de Ayuda N1, 02 Soporte N2, 03 Infraestructura, 04 Mesa Funcional, 05 Soporte Terreno y 06 Adquisiciones TI.

## 2026-09-25 (2) — Plan 010 implementado (sin commitear)

### Hecho
- **API** (`corporate-api`):
  - `service_catalog_items.fulfillment` y `service_tickets.purchase_request_{id,number,status}`. Una migración única, en la misma transacción que crea la columna, convierte el ítem «Solicitud de equipo» (sin grupo aprobador ni campo `equipo`) y da `generate-ticket:access` a todo rol que tenía `purchase-request-creation:access`.
  - `POST /service-portal/tickets` acepta `purchaseRequest`. Orden: se abre la transacción MSSQL (cabecera + líneas, `createPurchaseRequestWithLines`), se crea el ticket en Postgres con su commit y después se hace commit de MSSQL. Si falla el ticket, rollback de MSSQL. Si falla el último commit, el ticket se anula.
  - `POST /service-portal/beneficiary`: devuelve solo `{personId, fullName}`, con rate limit. Ya no exige `persons:read`.
  - Sincronización (`purchaseLink.service.ts`): cada cambio de estado de la compra se avisa por `library/purchaseRequestEvents.ts` y `applyPurchaseRequestState` lo aplica en forma idempotente. El barrido del SLA reconcilia lo pendiente.
  - Guardas: el agente no puede resolver ni anular a mano mientras la compra siga viva. El solicitante anula solo en `DRAFT`/`SUBMITTED`, y eso retira la compra.
- **Front:** bloque «Datos de la compra» (`EquipmentRequestFields.tsx` + `equipmentDraft.ts`) en Generar Ticket. `?service=equipment` preselecciona el ítem. El detalle del portal y el workspace muestran la SOL y su estado. Nuevo checkbox «Genera solicitud de compra» en la configuración. `/tickets/create` redirige al portal. Se borró `CreateRequest.tsx`.

### Verificación
- `tsc` de la API y del front (`-p tsconfig.app.json`) y ESLint del front: OK.
- **Unit:** 132 correctos (2 nuevos de `purchaseSyncEffect` y de los textos de estado).
- **Dev:** la API migró sin errores. En la base:
  - el ítem tiene `fulfillment=PURCHASE_REQUEST`;
  - «Generar Ticket» incluye los 6 permisos;
  - «Nueva Solicitud» quedó inactiva;
  - los roles `admin` y `user` recibieron «Generar Ticket».

### Pendiente
- **Integración:** `purchaseLink.service.integration.test.ts` (10 casos) sin correr. Testing está apagado y `.env.test` tiene la IP vieja (192.168.10.4; la actual es .5).
- **Navegador:** falta la prueba manual del ciclo completo.
- **Seguridad:** `/security-review` antes de promover.

## 2026-09-25 (1) — Plan 010: Solicitud de equipo desde Generar Ticket (aprobado)

### Contexto
- «Necesito algo › Solicitud de equipo» debe crear la solicitud de compra (SOL) y el ticket (REQ) juntos, vinculados, para seguir la compra con el SLA del Service Desk.
- Plan en [`planes/010-solicitud-equipo-desde-ticket.html`](planes/010-solicitud-equipo-desde-ticket.html).

### Decisiones
- **Sincronización:** la compra mueve el ticket. OC generada → en espera (proveedor) con el SLA pausado; entregada → resuelto; rechazada o anulada → ticket anulado.
- **Aprobación:** una sola, la del aprobador de la compra. El ítem no usa grupo aprobador.
- **«Nueva Solicitud»:** se retira del menú y `/tickets/create` redirige al portal.
- **Acceso:** `generate-ticket:access` suma los permisos de compra. Cualquiera que use el portal puede pedir equipo.
- **Beneficiario:** endpoint propio que devuelve solo el nombre. Se deja de exigir `persons:read`, que faltaba en la pantalla vieja.

### Pendiente
- Implementar el plan, probar y pasar la revisión de seguridad.

## 2026-09-24 (8) — Promoción del Service Desk a master (PR #28, #29)

### Hecho
- Commits en `develop`: `470d4e5` (API), `66bac8d` (front) y `eb11f63` (docs). Gate de seguridad marcado sobre
  `eb11f63` (run-3, GO de ambos agentes).
- PR #28 `develop → testing`, con CI verde.
- PR #29 `release/master → master`: `promote-to-master` excluyó los 4 archivos de prueba del Service Desk y el
  chequeo de rutas prohibidas pasó. `master` quedó en `faa86a8`.

### Pendiente
- Redesplegar Testing y producción: la migración crea las tablas del Service Desk, el permiso `all_view` y el log de
  auditoría.
- En cada ambiente, el admin asigna los permisos `service-*` y `kb-articles:*` a los roles, `service-tickets:all_view`
  al Jefe de Soporte TI, y carga los miembros de los grupos.
- Probar en navegador.

## 2026-09-24 (7) — Auditoría de seguridad run-3 del Service Desk y visibilidad por grupo

### Hecho
- **Auditoría ping-pong** (`cybersecurity-orchestrator` + `security-engineer`, informes en
  `security-audit-skill/corporate-app/run-3/`): sin Critical ni High. El orquestador informó 3 Low; el engineer,
  5 Medium y 5 Low. Los 5 Medium se confirmaron a mano en el código y se corrigieron:
  - F1: la búsqueda `/kb-articles/search` mostraba artículos INTERNAL a cualquier usuario del portal.
  - F2: se aprobaba una solicitud registrada por uno mismo a nombre de otro.
  - F3: CAB de una persona elegida por quien pide la aprobación.
  - F4: con permisos de problemas se resolvían incidentes sin trabajar tickets.
  - F5: anular un ticket dejaba el activo huérfano en SUPPORT.
- **Menores corregidos:** PDF saneados con qpdf y sin `.eml`/`.msg` (F7); «Tomar» atómico y sin quitarle el ticket a
  otro agente (F9); validación de grupo y de solicitante activo al registrar un ticket como agente (L2, L3).
- **Visibilidad por grupo** (decisión del usuario, `services/postgres/serviceDesk/ticketScope.ts`):
  - Cada agente ve y trabaja solo los tickets de sus grupos de soporte activos.
  - **Ver todo es un permiso:** `service-tickets:all_view` (acción nueva `all_view`). El admin se lo asigna al rol
    del Jefe de Soporte TI; el admin también ve todo.
  - Fuera de alcance responde 404. Aplica a la cola, el detalle, las acciones, los adjuntos, los activos del
    ticket, el historial del activo, los relacionados y los vínculos desde problemas, cambios y KB.
- **Re-verificación de `security-engineer`** (`run-3/engineer-reverify.md`): F1–F5, F7, F9, L2 y L3 confirmados
  cerrados. Sus hallazgos nuevos se corrigieron:
  - N1 (Medium): ver todo salía de estar en todos los grupos, algo que controla quien configura. Se reemplazó por el
    permiso `all_view`. Además, un no-admin ya no cambia su propia membresía y editar un grupo no lo reactiva.
  - N2: el detalle de problemas y cambios lista solo los incidentes o tickets del alcance de quien consulta. La
    resolución en bloque no nombra incidentes de otros grupos.
  - N3: el aprobador lee una solicitud solo mientras está pendiente y sin lo interno.
  - N4: un activo en soporte por un ticket no admite otros movimientos (por ejemplo, darlo de baja) fuera del ticket.
  - N5: quien sale de un grupo suelta sus tickets abiertos de ese grupo, que vuelven a la cola, y deja de verlos.

### Decisiones
- El permiso `all_view` no va en ninguna pantalla agrupadora: lo asigna el admin directamente al rol.
- Las notas internas que dejan un error conocido o el cierre de un cambio en sus tickets se mantienen: vincular esos
  tickets ya exige permiso de tickets y alcance.
- F6, F8 y F10, que quedaron abiertos en la primera ronda, se corrigieron después a pedido del usuario:
  - F6: auditoría de la configuración en `service_desk_audit_log` (solo inserción, forzada por trigger), con
    pestaña «Auditoría».
  - F8 y F10: límites por usuario en Redis para búsquedas de usuarios/activos, búsqueda de KB, alta de tickets y
    comentarios.
- **Revisión final ping-pong** (`run-3/engineer-final.md` y `orchestrator-final.md`): los dos dieron **GO**, sin
  Critical, High ni Medium. Se corrigieron sus Low:
  - L1: editar un cambio conserva los tickets vinculados que el agente no ve.
  - L2: la respuesta de una aprobación no le entrega lo interno al aprobador.
  - L4: la toma de inventario no cambia el estado de un activo en soporte por un ticket.
  - L5: trigger que bloquea UPDATE, DELETE y TRUNCATE del log de auditoría.
  - L6: el grupo aprobador queda fijado en la solicitud al crearla (`service_tickets.approval_group_id`).
  - L3 era un falso positivo: la desvinculación ya exigía permiso y alcance.
- Abiertos a propósito:
  - residuo de F3: sin grupo CAB ni mínimo de aprobadores;
  - la nota de error conocido llega a incidentes de otros grupos;
  - sin auditoría de cambios RBAC;
  - algunos correos de agentes sin límite.

### Verificación
- `tsc` limpio en la API y en el front, ESLint limpio. Suite completa de la API: 383 pasan y 13 se omiten.
- Pruebas nuevas por hallazgo en `serviceDesk.service.integration.test.ts` y `serviceDesk.routes.integration.test.ts`.
- La API de dev migró sin errores: sembró `service-tickets:all_view` y creó el log de auditoría con su trigger y
  `approval_group_id`.
- README raíz actualizado por `documentation-engineer` y revisado a mano: permisos base 19, y el aviso de pantallas
  sin probar en navegador repuesto.

### Pendiente
- Asignar `service-tickets:all_view` al rol del Jefe de Soporte TI en dev.
- Prueba en navegador; commits cuando el usuario lo pida.

## 2026-09-24 (6) — Plan 009: Service Desk ITIL v4 implementado (9A–9E)

### Hecho
- **API** (`corporate-api`):
  - Esquema en `migrateServiceDesk()` (+ problemas, cambios y conocimiento), con configuración inicial sembrada solo si la tabla está vacía (`databases/serviceDesk-defaults.ts`).
  - Reglas puras en `library/serviceDesk/`: `businessTime.ts` y `ticketRules.ts`.
  - Servicios en `services/postgres/serviceDesk/`: settings, ticket, ticketAsset, problem, change, kb, related, report, notifications, numbering y `slaSweeper.ts` (arranca en `index.ts`).
  - Rutas en `routes/serviceDesk.routes.ts`: `/service-portal`, `/service-tickets`, `/service-problems`, `/service-changes`, `/kb-articles`, `/service-desk-reports`, `/service-desk-settings`.
- **Activos:** movimientos internos `SUPPORT_TO_HOLDER` y `SUPPORT_TO_STOCK` (solo desde `SUPPORT`).
- **Catálogo:** 18 permisos base y 3 pantallas (`generate-ticket`, `support-services`, `support-settings`). En `MENU_CATALOG` quedan «Soporte», «Generar Ticket», «Gestión de Tickets» y «Configuración Service Desk».
- **Campana:** suma tickets asignados, aprobaciones de solicitudes y del CAB.
- **Front** (`corporate-front/src/pages/serviceDesk/`):
  - `GenerateTicket`: portal con nuevo ticket, mis tickets y centro de ayuda.
  - `SupportServices`: cola, aprobaciones, problemas, cambios con calendario, conocimiento e indicadores, más el workspace del ticket.
  - `ServiceDeskSettings`.
  - Sección «Historial de servicio» en el Kardex del activo.
  - `components/ui/Modal.tsx`, un modal accesible.

### Decisiones
- **Tiempo hábil:** con `Intl`, sin luxon.
- **Permisos:** sin `grantToUser`; el admin provisiona el acceso.
- **Historial de servicio del activo:** exige `service-tickets:read`.

### Verificación
- `tsc` limpio en la API; `tsc -p tsconfig.app.json` y ESLint limpios en el front.
- **Unit:** 19 tests (tiempo hábil con los cambios de horario de Chile, máquina de estados, matriz y campos dinámicos).
- **Integración contra Testing:** 15 tests de servicio y 5 HTTP (403 sin permiso, IDOR del portal, adjuntos internos, magic bytes).
- **Suite completa:** 368 correctos y 13 omitidos. Hubo 1 fallo intermitente en `purchaseOrder.service`, un módulo que no se tocó; pasó al repetirlo.
- **Dev:** la API migró y sembró bien. Los menús existentes se adoptaron por label (ids 1025–1027) y se agregó el 2074. Vite recompila sin errores.

### Pendiente
- Probar en el navegador en dev.
- Asignar los permisos a los roles y cargar miembros en los grupos.
- Revisión de seguridad ping-pong antes de promover a `master`.
- Commits.

---

## 2026-09-24 (5) — Plan 009: Service Desk ITIL v4 (aprobado)

### Contexto
- En dev se crearon desde el front dos menu-items que solo existen en la BD de desarrollo:
  - «Generar Ticket» (`/generate-ticket`, `generate-ticket:access`, bajo Solicitudes).
  - «Gestión de Tickets» (`/support-services`, `support-services:access`, bajo Soporte › Serv. Productivos).
- Plan en [`planes/009-service-desk-itil.html`](planes/009-service-desk-itil.html).

### Decisiones
- **Alcance:** todo el núcleo ITIL v4 (incidentes, solicitudes, problemas, cambios y conocimiento), entregado en fases 9A–9E con un PR por fase.
- **Asignación:** por grupos de soporte con miembros.
- **SLA:** horario hábil + feriados (`America/Santiago`), con pausa en «En espera».
- **Activos:** acciones explícitas del agente (enviar a soporte, devolver al custodio o a bodega) con los movimientos nuevos `SUPPORT_TO_HOLDER` y `SUPPORT_TO_STOCK`.
- **Menú:** los 2 menu-items de dev, más su padre «Soporte», pasan al seed principal (`MENU_CATALOG`) con labels idénticos.

### Pendiente
- Implementar las fases 9A–9E.

---

## 2026-09-24 (4) — Promoción a master (PR #26, #27) y redespliegue de Testing y producción

### Hecho
- Seis commits en `develop`: menú, combobox, tablas, SMTP, IP real + ACL de Redis, y docs.
- Revisión de seguridad del delta: PASS, con la marca del gate en `86b6aa3`.
- PR #26 `develop → testing`, con CI verde.
- PR #27 `release/master → master`: `promote-to-master` excluyó los `compose.dev/test.yml` de api e infra. `master` quedó en `4ae6016`.
- Se recreó Testing (`bdd test`) y producción (`bdd`, `backend`, `mailer` y `frontend prod`).

### Verificación
- **Testing:**
  - Redis tiene el usuario `pristest`.
  - Integración de la API contra Testing: 219 tests correctos y 4 omitidos (25 archivos).
  - ACL LOG vacío.
- **Producción:**
  - Redis con `roybattyprod`: 9 conexiones de la API con ese usuario y ACL LOG vacío.
  - nginx-api con `set_real_ip_from 10.200.13.0/24`.
  - El mailer compilado trae `requireTLS`.
  - El bundle del front trae el estilo de tablas (`#069`, `e1eef4`), el scroll del menú y el combobox ("Escriba para buscar").

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
