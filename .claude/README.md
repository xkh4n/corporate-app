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
