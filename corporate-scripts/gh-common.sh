#!/usr/bin/env bash
# gh-common.sh
# Helpers compartidos para hablar con GitHub CLI (gh) desde los scripts de
# promocion/PR. Se hace SOURCE (source "$SCRIPT_DIR/gh-common.sh"), no se
# ejecuta suelto. No hace "exit" por su cuenta salvo en gh_assert_ready: cada
# script decide que hacer si gh no esta o no tiene sesion.

gh_get_cli() {
    # Devuelve por stdout la ruta al ejecutable de GitHub CLI, o falla (exit
    # distinto de 0) si no se encuentra. Primero el PATH, despues las
    # ubicaciones estandar de instalacion en Linux.
    local candidate
    candidate="$(command -v gh 2>/dev/null || true)"
    if [ -n "$candidate" ]; then
        printf '%s' "$candidate"
        return 0
    fi

    local candidates=(
        "/usr/local/bin/gh"
        "/usr/bin/gh"
        "/snap/bin/gh"
        "$HOME/.local/bin/gh"
    )
    local c
    for c in "${candidates[@]}"; do
        if [ -x "$c" ]; then
            printf '%s' "$c"
            return 0
        fi
    done
    return 1
}

gh_test_auth() {
    # 0 (true) si gh tiene sesion iniciada para el host actual. No escribe nada.
    local gh_path="$1"
    "$gh_path" auth status >/dev/null 2>&1
}

gh_assert_ready() {
    # Deja la ruta a gh lista para usar en la variable global GH_PATH, o corta
    # el script con un mensaje claro si falta gh o falta la sesion. Usar en
    # scripts donde el PR es obligatorio (git-pr.sh).
    if ! GH_PATH="$(gh_get_cli)"; then
        echo "Error: GitHub CLI (gh) no encontrado." >&2
        echo "Instalalo con tu gestor de paquetes (apt/dnf/pacman/snap) o ver https://cli.github.com" >&2
        exit 1
    fi
    if ! gh_test_auth "$GH_PATH"; then
        echo "Error: GitHub CLI sin sesion iniciada." >&2
        echo "Ejecuta una sola vez:  \"$GH_PATH\" auth login" >&2
        echo "(elegi GitHub.com -> HTTPS o SSH -> login con el navegador) y volve a intentar." >&2
        exit 1
    fi
}

gh_resolve_branch_alias() {
    # Traduce el alias de ambiente que usa run.sh (dev/testing/prod) al nombre
    # real de la rama. Si ya te pasan un nombre de rama, lo devuelve tal cual.
    local name_lower
    name_lower="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
    case "$name_lower" in
        dev|develop) echo "develop" ;;
        testing|test) echo "testing" ;;
        prod|master) echo "master" ;;
        *) echo "$1" ;;
    esac
}

gh_set_label() {
    # Crea (o actualiza) una etiqueta en el repo. Idempotente. Si falla -por
    # permisos, por ejemplo- avisa pero no corta: la creacion del PR puede
    # seguir sin la etiqueta.
    local gh_path="$1" name="$2" color="${3:-BFD4F2}"
    if ! "$gh_path" label create "$name" --color "$color" --force >/dev/null 2>&1; then
        echo "Advertencia: no se pudo crear/actualizar la etiqueta '$name' (se sigue sin ella)." >&2
    fi
}
