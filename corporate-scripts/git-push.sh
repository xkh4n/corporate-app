#!/usr/bin/env bash
# Commitea (si hay cambios) y hace push de la rama del ambiente indicado.
#
# Pensado para llamarse via `run.sh gitpush <dev|testing> ["mensaje..."]`.
# - Solo admite dev (-> develop) y testing (-> testing). master no recibe push
#   directo: se promociona con `run.sh pre prod`.
# - Verifica que estes parado en la rama que corresponde antes de tocar nada.
# - Si el working tree tiene cambios, exige un mensaje de commit, hace
#   git add -A + git commit y luego push. Si esta limpio, solo push.
#
# Ambiente: 'dev' o 'testing'.
# Resto de los argumentos: palabras del mensaje de commit (se juntan con
# espacios, ignorando las vacias). Obligatorio solo si hay cambios sin
# commitear.

set -uo pipefail

ambiente="${1:-}"
shift || true

if [ "$ambiente" != "dev" ] && [ "$ambiente" != "testing" ]; then
    echo "Error: ambiente debe ser 'dev' o 'testing'." >&2
    exit 1
fi

message=""
for w in "$@"; do
    if [ -n "$w" ]; then
        if [ -n "$message" ]; then
            message="$message $w"
        else
            message="$w"
        fi
    fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$SCRIPT_DIR")"
cd "$repo_root" || exit 1

case "$ambiente" in
    dev) branch="develop" ;;
    testing) branch="testing" ;;
esac

# 1. Tenes que estar parado en la rama que vas a pushear (evita pushear develop
#    estando en un feature branch por accidente).
current="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current" != "$branch" ]; then
    echo "Error: estas en '$current' pero pediste push de '$branch'. Corre primero:  git checkout $branch" >&2
    exit 1
fi

# 2. Commit condicional.
dirty="$(git status --porcelain)"

if [ -n "$dirty" ]; then
    if [ -z "$message" ]; then
        echo "Error: hay cambios sin commitear. Pasa un mensaje:  ./run.sh gitpush $ambiente \"tu mensaje\"" >&2
        exit 1
    fi
    echo "Commiteando cambios en '$branch'..."
    git add -A
    if ! git commit -m "$message"; then
        echo "Error: fallo git commit." >&2
        exit 1
    fi
elif [ -n "$message" ]; then
    echo "Advertencia: no hay cambios para commitear; se ignora el mensaje y solo se hace push." >&2
fi

# 3. Push.
echo "Push de '$branch' -> origin..."
git push origin "$branch"
exit $?
