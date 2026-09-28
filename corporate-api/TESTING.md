# Testing (Fase 0)

Framework: [Vitest](https://vitest.dev). Dos tipos de test, por convencion de nombre:

- `*.unit.test.ts` — sin base de datos, corren en cualquier lado (`npm test`, cualquier laptop, futuro CI).
- `*.integration.test.ts` — contra bases de datos reales del stack de **Testing** (`corporate-infra/compose.test.yml`), no las de Development. Necesitan ese stack arriba antes de la primera corrida.

```bash
npm test              # corre unit + integration una vez
npm run test:watch    # modo watch
```

Si `.env.test` no existe o el stack de Testing no está arriba, los tests de integración fallan al conectar (no hacen skip silencioso).

## Por qué el stack de Testing y no bases nuevas dentro de Development

Ya pasó antes en este proyecto que scripts de verificación ad-hoc contra la base de dev compartida dejaron datos huérfanos. La primera versión de esta fase creaba bases con sufijo (`corpdbpgtest`, etc.) *dentro* del mismo servidor de Development; se descartó a favor de usar el stack de Testing (`corporate-infra/compose.test.yml`) que **ya existe en este monorepo** — un servidor de BD completamente separado (otro contenedor, otro puerto, otro volumen), con los mismos init scripts que Development (`corporate-infra/PostgreSQL/init/`, `MsSQL/scripts/setup-ag.sh`, `MongoDB/init.sh`) creando `corpdbpg`/`corpdbsql`/`corpdbmng` y sus usuarios de aplicación automáticamente al levantar el stack. Cero riesgo de tocar Development, y cero pasos manuales de `CREATE DATABASE`/`GRANT`.

## Setup (una sola vez por sesión de trabajo, o cada vez que el stack de Testing esté abajo)

### 1. Levantar el stack de BD de Testing

```powershell
.\run.ps1 bdd test
```

Esto levanta Postgres/MSSQL/Mongo/Redis (+ exporters) en modo Testing — mismos scripts idempotentes que Development, corridos contra un servidor separado. **No hace falta levantar `backend test`/`mailer test`/`frontend test`/`monitoring test`** para correr los tests de integración: `test/setupIntegration.ts` hace su propio `migratePostgres()`/`migrateMssql()`/`seedPermissions()`/`seedMenuItems()` contra esas bases, el mismo trabajo que haría el bootstrap de `corporate-api` si sus réplicas de Testing estuvieran arriba.

Confirmar que quedó healthy:

```bash
docker ps --format "{{.Names}}\t{{.Status}}" | grep test
```

### 2. `.env.test`

```bash
cp .env.test.example .env.test
```

Los `*_HOST` quedan como `${ALLOCATED_IP}`: `test/setupIntegration.ts` los completa con `ALLOCATED_IP` de `corporate-secrets/Environment/.env`, la misma IP que usan los stacks, así que no hay que tocarlos cuando cambia la IP del equipo. Completar los puertos (`POSTGRE_PORT`/`MSSQL_PORT`/`MONGO_PORT`/`REDIS_PORT`) con los valores de `corporate-secrets/Environment/.env` y `corporate-secrets/Testing/.env`, y los usuarios de aplicación (`PG_APP_USER`/`MSSQL_APP_USER`/`MONGO_USER`, cada uno + `test`) con los de `corporate-secrets/Testing/.env`. Los `*_PASSWORD_FILE` ya apuntan por defecto a los secrets de Testing (mismas contraseñas que usaría `corporate-api` si corriera contra ese stack).

`.env.test` está en `.gitignore` — nunca se versiona (aunque no contiene secretos en texto plano, sí referencia rutas a `corporate-secrets/`, que tampoco se versiona).

## Verificar que el setup quedó bien

```bash
npm test
npm test   # correr dos veces seguidas: la segunda corrida tampoco debería fallar
           # (confirma que el test de integración no deja residuo entre corridas)
```

## `resetTestData` — aislamiento entre tests

`test/setupIntegration.ts` expone `resetTestData({ postgres?, mssql?, mongo? })`. Cada archivo `*.integration.test.ts` declara, en su propio `beforeEach`/`afterEach`, qué tablas/colecciones usa y las limpia — no hay un wipe global de toda la base de Testing antes de cada test. Ver `src/services/postgres/costCenter.service.integration.test.ts` como plantilla.

Importante: el stack de Testing es persistente (mismo criterio que Development — volúmenes con nombre, no efímeros) y puede estar siendo usado a la vez para verificación manual (ver `project_prod_readiness_audit_2026-08-17` en la memoria del proyecto). Los tests de integración solo tocan las tablas/colecciones que cada archivo declara explícitamente en `resetTestData(...)`, nunca un wipe general — pero correr la suite completa mientras alguien hace QA manual sobre esas mismas tablas en Testing puede pisarle datos. Coordinar antes de correr `npm test` si el stack de Testing está en uso.

## Alcance explícitamente fuera de esta fase

- **CI/CD**: no existe ningún pipeline en el monorepo (sin `.github/workflows`); esta fase deja los tests corribles en local, conectarlos a CI es un cambio aparte.
- **Tests de componentes del frontend (DOM)**: `corporate-front` solo testea funciones puras en esta fase (ver `corporate-front/vitest.config.ts`); tests con `@testing-library/react` + jsdom mockeando fetch/router/context por pantalla quedan fuera de alcance.
