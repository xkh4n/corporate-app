# Guía de contribución — ramas, promoción y accesos

Este documento es la referencia operativa del flujo de trabajo del repositorio. Aplica a cualquier
persona con acceso, sin importar su rol (dev/QA/prod).

## 1. Las tres ramas, una por ambiente

| Rama | Ambiente | Quién trabaja ahí |
|---|---|---|
| `develop` | Desarrollo — instalación de dependencias, fixes, debug | Equipo de desarrollo |
| `testing` | Pre-productivo — mismas restricciones que producción, pero sin afectarla | Equipo de QA/testing |
| `master` | Producción | Quien despliega/opera producción |

`testing` corre las 5 stacks Docker (`run.ps1 <stack> test`) igual que `dev`/`prod`, con su propio
rango de red y sus propios secretos — ver `.claude/specs/flujo-de-trabajo-e-infraestructura.md` y el
`README.md` raíz para el detalle de arquitectura.

## 2. Flujo normal

`feature/* → PR → develop → PR → testing → (promoción) → PR → master`

> Diagrama del flujo completo (ramas, comandos `run.ps1` en cada paso y el check de CI):
> **[`README.md` § "Promoción entre ramas"](README.md#promoción-entre-ramas-gitpush--gitpr--pre)**.

1. Todo cambio nuevo se rama de `develop` (o se commitea directo ahí si el equipo lo permite) y se
   integra vía Pull Request normal.
2. Cuando `develop` está listo para pre-productivo, se abre un PR **`develop` → `testing`**. Este PR
   sí puede traer tests unitarios/integración nuevos, `compose.dev.yml`/`compose.test.yml`
   actualizados, etc. — todo lo que vive en `testing` puede venir de acá sin restricciones.
3. Cuando lo validado en `testing` está listo para producción, **no se abre un PR directo
   `testing` → `master`**. Primero se corre el script de promoción (sección 3), que arma una rama
   intermedia ya limpia; el PR real es `release/master` → `master`.

Todo el flujo está envuelto en `run.ps1` (raíz del repo) para no olvidar pasos — requiere
[GitHub CLI (`gh`)](https://cli.github.com/) con sesión iniciada (`gh auth login`, una vez):

| Comando | Hace |
|---|---|
| `.\run.ps1 gitpush dev "mensaje"` | commit de lo pendiente (si hay) + `git push origin develop`. Igual con `testing`. |
| `.\run.ps1 gitpr testing dev` | PR `develop → testing` (etiquetas + checklist), reusa el PR abierto si ya existe. |
| `.\run.ps1 pre testing` | `git checkout develop` + pull + push + PR `develop → testing`. |
| `.\run.ps1 pre prod "motivo"` | corre `promote-to-master.ps1` y abre el PR `release/master → master`. |

`gitpush` solo acepta `dev` y `testing`: `master` nunca recibe push ni PR directo.

## 3. Qué nunca debe llegar a `master`, y cómo se garantiza

`master` es producción: no debe contener tests unitarios/de integración, `compose.dev.yml`,
`compose.test.yml`, ni configuración de test runner. La lista exacta y autoritativa de qué se excluye
vive en un solo lugar: [`corporate-scripts/master-excluded-paths.txt`](corporate-scripts/master-excluded-paths.txt)
(agregar un patrón nuevo ahí, nunca duplicado a mano en otro archivo).

Esto se garantiza en dos capas independientes, no solo con disciplina de revisión:

1. **[`corporate-scripts/promote-to-master.ps1`](corporate-scripts/promote-to-master.ps1)** — arma la
   rama `release/master` mezclando `testing` sobre `master`, quita automáticamente del merge cualquier
   ruta de la lista antes de commitear, publica `release/master` en origin y —si `gh` tiene sesión—
   abre el PR `release/master → master`. Uso normal:
   ```powershell
   .\run.ps1 pre prod "sprint 12"
   ```
   Equivale a `.\corporate-scripts\promote-to-master.ps1 -Reason "sprint 12"`. Pasá `-NoPr` (o no
   tengas `gh` logueado) para que solo deje `release/master` publicada e imprima el link del compare
   y abrir el PR a mano.
2. **[`.github/workflows/master-no-testing-artifacts.yml`](.github/workflows/master-no-testing-artifacts.yml)**
   — corre en todo PR hacia `master` (venga o no del script) y **falla el chequeo** si el diff toca
   alguna ruta de la lista. Esta es la capa que de verdad bloquea el merge, no el script — el script
   solo evita que el caso normal necesite intervención manual.

Si el PR hacia `master` falla este chequeo: no lo fuerces por fuera de la lista. O sacás el archivo a
mano del PR, o (si de verdad debería vivir en `master`, ej. un `compose.prod.yml` nuevo con nombre
parecido a uno excluido) revisá primero si el patrón de `master-excluded-paths.txt` está demasiado
amplio, y ajustalo con cuidado — no borres protección para pasar un PR puntual.

## 4. Accesos por rama

GitHub no permite restringir **lectura** de código por rama dentro de un mismo repositorio privado
(la lectura es a nivel de repo completo; sí hay per-branch fine-grained permissions, pero requiere
GitHub Enterprise). El modelo elegido para este repo es:

- **Lectura**: todo colaborador con acceso al repo puede leer las 3 ramas.
- **Escritura/merge**: restringida por rama vía *branch protection rules* — cada rama solo acepta
  push/merge de quien le corresponde:
  - `develop`: equipo de desarrollo.
  - `testing`: equipo de QA/testing (recibe vía PR desde `develop`).
  - `master`: solo vía PR desde `release/master`, aprobado por quien opera producción.

> **Estado actual (2026-09-21):** el repo es privado en el plan gratuito de GitHub, que **no permite
> branch protection ni rulesets** (la API responde «Upgrade to GitHub Pro or make this repository
> public»). Lo de esta sección queda como la configuración objetivo si se pasa a GitHub Pro; mientras
> tanto las barreras reales son el CI visible en cada PR (`.github/workflows/ci.yml`), la guardia de
> `master` (`master-no-testing-artifacts.yml`) y el hook local de `SECURITY-GATE.md`. Los checks del
> CI a marcar como obligatorios en ese caso: `API (tsc + tests unitarios)` y `Web (tsc + lint + tests +
> build)` en `develop` y `testing`.

### 4.1 Cómo configurarlo en GitHub (una vez, por quien administra el repo)

Branch protection no tiene un comando cómodo en `gh`, así que esto se configura a mano en la UI
(`Settings` del repo en GitHub):

1. **Agregar colaboradores** (`Settings → Collaborators and teams`, o `Settings → Teams` si el repo
   vive dentro de una organización): dale a cada persona el rol de repo más bajo que le sirva —
   `Write` alcanza para poder pushear a la rama que le corresponde; no hace falta `Admin` ni
   `Maintain` para el flujo normal.
2. **`Settings → Branches → Add branch protection rule`**, una regla por rama:
   - **`develop`**: `Require a pull request before merging` opcional (según qué tan estricto quieran
     ser con commits directos); `Require status checks to pass` con los dos checks del CI (`API (tsc + tests unitarios)` y
     `Web (tsc + lint + tests + build)`).
   - **`testing`**: `Require a pull request before merging` (activado), reviewers requeridos = equipo
     QA. `Restrict who can push to matching branches` → lista solo a quien puede mergear ahí (o el
     equipo QA, si es una organización con Teams).
   - **`master`**: `Require a pull request before merging` (activado, sin excepciones — ni admins),
     `Require approvals` ≥ 1 (idealmente alguien del equipo de producción), `Require status checks to
     pass before merging` → marcar como obligatorio el check `Guardia de master contra artefactos de
     testing` (el workflow de la sección 3), `Restrict who can push to matching branches` → solo el
     equipo/persona de producción, `Do not allow bypassing the above settings` activado.
3. Si el repo pasa a vivir dentro de una **organización** de GitHub, reemplazá "colaboradores
   individuales" por **Teams** (`dev-team`, `qa-team`, `prod-team`) — mismo mecanismo de branch
   protection, pero referenciando al team en vez de a personas sueltas; es más fácil de mantener
   cuando cambia quién integra cada equipo.

### 4.2 Si en algún momento se necesita aislar lectura de verdad (no solo escritura)

Con un repo único no se puede — la alternativa real es GitHub Enterprise (fine-grained branch
permissions) o separar `testing`/`master` a repos propios (espejo o submódulo desde `develop`). Ninguna
de las dos está implementada hoy; no asumas que existe hasta que se decida explícitamente.

## 5. Ver también

- [`SECURITY-GATE.md`](SECURITY-GATE.md) — todo push a `master` está bloqueado por un git hook hasta
  que exista una revisión de seguridad vigente para el commit exacto. Es un mecanismo real (no solo
  política escrita), independiente de este flujo de ramas pero obligatorio en el mismo paso.
- `.claude/specs/flujo-de-trabajo-e-infraestructura.md` — arranque de los 5 stacks Docker, redes,
  scripts de secretos/certificados. No repite el flujo de ramas (eso vive solo aquí y en
  `.claude/roles/git-workflow-lead.md`).
- `README.md` raíz — arquitectura general y cómo levantar cada ambiente.
