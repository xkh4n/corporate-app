#!/usr/bin/env bash
# Crea un Pull Request entre dos ramas del modelo de ambientes usando gh.
#
# Pensado para llamarse via `run.sh gitpr <destino> <origen>`, p.ej.
# `run.sh gitpr testing dev`. Acepta alias de ambiente (dev/testing/prod) o
# nombres de rama.
#
# Antes de abrir el PR: actualiza la rama origen (checkout + pull --ff-only +
# push), asegura las etiquetas y evita duplicar un PR ya abierto para el mismo
# par base<-head.
#
# El PR hacia master NO se abre desde aca: master solo recibe desde
# release/master, que arma promote-to-master.sh. Usa `run.sh pre prod`.

set -uo pipefail

destino="${1:?Uso: git-pr.sh <destino> <origen>}"
origen="${2:?Uso: git-pr.sh <destino> <origen>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$SCRIPT_DIR")"
cd "$repo_root" || exit 1

source "$SCRIPT_DIR/gh-common.sh"

base="$(gh_resolve_branch_alias "$destino")"
head_branch="$(gh_resolve_branch_alias "$origen")"

if [ "$base" = "$head_branch" ]; then
    echo "Error: origen y destino son la misma rama ('$base')." >&2
    exit 1
fi
if [ "$base" = "master" ]; then
    echo "Error: el PR hacia master se arma con la rama limpia release/master. Corre:  ./run.sh pre prod" >&2
    exit 1
fi

gh_assert_ready
gh="$GH_PATH"

# 1. Actualizar la rama origen y publicarla.
echo "Actualizando '$head_branch'..."
git fetch origin --quiet
if ! git checkout "$head_branch"; then
    echo "Error: no se pudo cambiar a '$head_branch'." >&2
    exit 1
fi
if ! git pull --ff-only origin "$head_branch"; then
    echo "Error: fallo git pull --ff-only en '$head_branch' (hay divergencia, resolvela a mano)." >&2
    exit 1
fi
if ! git push origin "$head_branch"; then
    echo "Error: fallo git push de '$head_branch'." >&2
    exit 1
fi

# 2. Etiquetas segun el destino.
stamp="$(date '+%Y-%m-%d %H:%M')"
if [ "$base" = "testing" ]; then
    labels="release,testing"
    gh_set_label "$gh" "release" "BFD4F2"
    gh_set_label "$gh" "testing" "FBCA04"
    title="Release: $head_branch -> testing ($stamp)"
    body=$(cat <<EOF
## Cambios incluidos

- **Fecha:** $stamp
- **Rama origen:** $head_branch
- **Rama destino:** testing

### Descripcion
Promueve los cambios de desarrollo al entorno pre-productivo (testing).

### Checklist
- [ ] Codigo revisado
- [ ] Tests unitarios pasan
- [ ] Tests de integracion pasan
- [ ] Documentacion actualizada
EOF
)
else
    labels="release"
    gh_set_label "$gh" "release" "BFD4F2"
    title="PR: $head_branch -> $base ($stamp)"
    body=$(cat <<EOF
## Cambios incluidos

- **Fecha:** $stamp
- **Rama origen:** $head_branch
- **Rama destino:** $base
EOF
)
fi

# 3. No duplicar un PR ya abierto.
existing="$("$gh" pr list --base "$base" --head "$head_branch" --state open --json number --jq '.[0].number')"
if [ -n "$existing" ] && [ "$existing" != "null" ]; then
    echo "Ya existe un PR abierto $head_branch -> $base (#$existing). Abriendo en el navegador..."
    "$gh" pr view "$existing" --web
    exit 0
fi

# 4. Crear el PR.
echo "Creando PR $head_branch -> $base..."
if ! "$gh" pr create --base "$base" --head "$head_branch" --title "$title" --body "$body" --label "$labels" --assignee '@me'; then
    echo "Error: fallo la creacion del PR." >&2
    exit 1
fi
echo "PR creado: $head_branch -> $base"
