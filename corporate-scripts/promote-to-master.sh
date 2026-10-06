#!/usr/bin/env bash
# Prepara la promocion de "testing" a "master" en una rama intermedia
# (release/master), quitando del merge todo lo que nunca debe llegar a
# produccion (tests unitarios/integracion, compose.dev.yml/compose.test.yml,
# configs de test runner - ver master-excluded-paths.txt).
#
# Este script empuja "release/master" a origin con el diff ya limpio y -si
# "gh" esta disponible y con sesion- abre el Pull Request
# "release/master -> master" por vos (pasa --no-pr para saltarte ese paso y
# abrirlo a mano con el link que imprime al final). El PR sigue pasando por
# revision y por el chequeo de CI
# (.github/workflows/master-no-testing-artifacts.yml), que es quien realmente
# bloquea si algo prohibido se colo igual.
#
# Se invoca normalmente via  ./run.sh pre prod  ["motivo"].
#
# Uso: ./promote-to-master.sh ["motivo"] [--no-pr]
#   motivo   Texto libre que se agrega al mensaje de commit de la promocion
#            (por ejemplo, referencia al PR o milestone que se esta
#            promoviendo). Default: "promocion de rutina".
#   --no-pr  No abrir el Pull Request con gh; solo dejar "release/master"
#            publicada.

set -uo pipefail

reason="promocion de rutina"
no_pr=0

while [ $# -gt 0 ]; do
    case "$1" in
        --no-pr) no_pr=1; shift ;;
        *) reason="$1"; shift ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$SCRIPT_DIR")"
cd "$repo_root" || exit 1

# 0. El working tree tiene que estar limpio: este script hace checkout/merge
#    y no queremos mezclar cambios locales sueltos con la promocion.
dirty="$(git status --porcelain)"
if [ -n "$dirty" ]; then
    echo "Error: el working tree tiene cambios sin commitear. Commitea o descarta antes de promocionar." >&2
    exit 1
fi

echo "Actualizando referencias remotas..."
git fetch origin --quiet

release_branch="release/master"

# 1. Siempre arranca desde origin/master (no desde un release/master local
#    viejo que pueda haber quedado de una corrida anterior sin pushear).
echo "Creando '$release_branch' desde origin/master..."
git checkout -B "$release_branch" origin/master >/dev/null

# 2. Trae testing pero NO commitea todavia -da la chance de curar el
#    resultado (sacar rutas prohibidas) antes de fijar el commit de merge.
echo "Mezclando origin/testing (sin commitear)..."
if ! git merge --no-commit --no-ff origin/testing; then
    echo "Advertencia: el merge de testing -> $release_branch tiene conflictos reales (no relacionados a las rutas excluidas)." >&2
    echo "Advertencia: resolvelos a mano en el working tree, deja todo en stage, y volve a correr este mismo comando de nuevo -no hace falta, no vuelve a mergear si ya hay un merge en curso-." >&2
    echo "Advertencia: si preferis abortar: git merge --abort" >&2
    exit 1
fi

# 3. Lee la lista unica de rutas/patrones prohibidos.
excluded_list_path="$SCRIPT_DIR/master-excluded-paths.txt"
if [ ! -f "$excluded_list_path" ]; then
    echo "Error: no se encontro $excluded_list_path -sin esta lista no hay forma segura de saber que excluir." >&2
    git merge --abort 2>/dev/null || true
    exit 1
fi

mapfile -t patterns < <(grep -v -E '^[[:space:]]*#' "$excluded_list_path" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$')

is_excluded_path() {
    local rel_path="$1"
    local name
    name="$(basename "$rel_path")"
    local p found=1
    shopt -s nocasematch
    for p in "${patterns[@]}"; do
        if [[ "$p" != */* ]]; then
            if [[ "$name" == $p ]]; then
                found=0
                break
            fi
        elif [ "$rel_path" = "$p" ]; then
            found=0
            break
        fi
    done
    shopt -u nocasematch
    return "$found"
}

# 4. Revisa SOLO los archivos que este merge realmente toca (no todo el repo).
mapfile -t changed_files < <(git diff --cached --name-only)
removed=()

for f in "${changed_files[@]}"; do
    if ! is_excluded_path "$f"; then
        continue
    fi

    if git cat-file -e "HEAD:$f" 2>/dev/null; then
        # master ya tenia este archivo (no deberia pasar segun la politica,
        # pero por seguridad restauramos la version de master, no la borramos).
        git checkout HEAD -- "$f"
    else
        # Archivo nuevo que solo existia en testing -se saca del todo del merge.
        git rm -f --cached -- "$f" >/dev/null
        rm -f -- "$f"
    fi
    removed+=("$f")
done

if [ "${#removed[@]}" -gt 0 ]; then
    echo "Excluidas ${#removed[@]} ruta(s) de master (tests/config de testing):"
    for r in "${removed[@]}"; do
        echo "  - $r"
    done
else
    echo "Ninguna ruta prohibida vino en este merge."
fi

# 5. Si tras excluir no queda nada nuevo respecto a master, no hay nada que promocionar.
staged="$(git diff --cached --stat)"
if [ -z "$staged" ]; then
    echo "No hay cambios reales para promocionar (testing == master una vez excluidas sus rutas propias)."
    git merge --abort 2>/dev/null || true
    exit 0
fi

commit_message="Promote testing to master ($reason)"
if [ "${#removed[@]}" -gt 0 ]; then
    joined_removed="$(IFS=', '; echo "${removed[*]}")"
    commit_message="$commit_message

Rutas excluidas (nunca van a master): $joined_removed"
fi

git commit -m "$commit_message" >/dev/null
echo "Publicando '$release_branch' en origin..."
git push origin "$release_branch" --force-with-lease

compare_url="https://github.com/xkh4n/corporate-app/compare/master...${release_branch}?expand=1"

# 6. Abrir el Pull Request 'release/master -> master' con gh (best-effort: si
#    gh no esta o no tiene sesion, se cae al link de compare para hacerlo a
#    mano). El chequeo de CI vuelve a validar que no haya rutas prohibidas igual.
pr_opened=0
if [ "$no_pr" -eq 0 ]; then
    source "$SCRIPT_DIR/gh-common.sh"
    if ! gh_path="$(gh_get_cli)"; then
        echo "Advertencia: gh no encontrado; abri el PR a mano (link abajo)." >&2
    elif ! gh_test_auth "$gh_path"; then
        echo "Advertencia: gh sin sesion ('gh auth login'); abri el PR a mano (link abajo)." >&2
    else
        gh_set_label "$gh_path" "release" "BFD4F2"
        gh_set_label "$gh_path" "production" "D93F0B"
        existing="$("$gh_path" pr list --base master --head "$release_branch" --state open --json number --jq '.[0].number')"
        if [ -n "$existing" ] && [ "$existing" != "null" ]; then
            echo "Ya existe un PR abierto '$release_branch -> master' (#$existing). Abriendolo..."
            "$gh_path" pr view "$existing" --web
            pr_opened=1
        else
            stamp="$(date '+%Y-%m-%d %H:%M')"
            pr_body=$(cat <<EOF
## Release a Produccion

- **Fecha:** $stamp
- **Rama origen:** $release_branch (armada desde testing, ya sin rutas de solo-testing)
- **Rama destino:** master (produccion)
- **Motivo:** $reason

### Validaciones previas
- [ ] Pruebas en ambiente testing completadas
- [ ] Aprobacion de QA
- [ ] Aprobacion de negocio
- [ ] Sin regresiones detectadas

### Rollback
En caso de incidente, revertir este PR o hacer rollback al commit anterior.

---
**IMPORTANTE:** Este PR despliega a PRODUCCION. Requiere aprobacion obligatoria.
El chequeo de CI 'Guardia de master' bloquea el merge si se colo alguna ruta de
solo-testing.
EOF
)
            if "$gh_path" pr create --base master --head "$release_branch" \
                --title "Production Release: $release_branch -> master ($(date '+%Y-%m-%d'))" \
                --body "$pr_body" \
                --label "release,production" \
                --assignee "@me"; then
                echo "PR '$release_branch -> master' creado."
                pr_opened=1
            else
                echo "Advertencia: fallo 'gh pr create'; abri el PR a mano (link abajo)." >&2
            fi
        fi
    fi
fi

echo ""
if [ "$pr_opened" -eq 0 ]; then
    echo "Abri el Pull Request '$release_branch -> master' aca (el chequeo de CI vuelve a validar que no haya rutas prohibidas):"
    echo "$compare_url"
else
    echo "Compare/diff por si lo necesitas: $compare_url"
fi
