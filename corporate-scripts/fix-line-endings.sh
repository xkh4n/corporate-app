#!/usr/bin/env bash
# Corrige terminaciones de linea CRLF -> LF en los .sh de corporate-infra
# (para que corran sin problemas dentro de los contenedores Linux).

set -uo pipefail

echo "Corrigiendo terminaciones de linea para compatibilidad Linux..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$SCRIPT_DIR")"

mapfile -d '' files_to_fix < <(find "$repo_root/corporate-infra" -type f -name "*.sh" -print0)

if [ "${#files_to_fix[@]}" -eq 0 ]; then
    echo "No se encontraron archivos .sh en 'corporate-infra'."
    exit 0
fi

fixed_count=0
skipped_count=0

for file in "${files_to_fix[@]}"; do
    rel_path="${file#"$repo_root"/}"
    echo "  Procesando: $rel_path"

    if grep -qU $'\r' "$file" 2>/dev/null; then
        tmp_file="$file.tmp"
        tr -d '\r' < "$file" > "$tmp_file"
        mv -f "$tmp_file" "$file"
        echo "    Corregido: CRLF -> LF"
        fixed_count=$((fixed_count + 1))
    else
        echo "    Ya tiene formato correcto (LF)"
        skipped_count=$((skipped_count + 1))
    fi
done

echo ""
echo "Resumen de correcciones:"
echo "  - Archivos corregidos: $fixed_count"
echo "  - Archivos ya correctos: $skipped_count"
echo "  - Total procesados: $((fixed_count + skipped_count))"

if [ "$fixed_count" -gt 0 ]; then
    echo ""
    echo "Correcciones aplicadas exitosamente."
    echo "Ahora puedes levantar el stack de bases de datos con: ./run.sh bdd dev"
else
    echo ""
    echo "No se necesitaron correcciones. El proyecto ya esta listo."
fi
