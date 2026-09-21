#!/usr/bin/env bash
# MongoDB Keyfile Generator
# Uso: ./mongo-keyfile.sh dev|test|prod

set -uo pipefail

environment="${1:?Uso: mongo-keyfile.sh <dev|test|prod>}"

# Rutas absolutas (no dependen del directorio desde el que se invoque el script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$SCRIPT_DIR")"

case "$environment" in
    dev)  keyfile_path="$repo_root/corporate-secrets/Development/MongoKeyfile/mongodb_keyfile.txt" ;;
    test) keyfile_path="$repo_root/corporate-secrets/Testing/MongoKeyfile/mongodb_keyfile.txt" ;;
    prod) keyfile_path="$repo_root/corporate-secrets/Production/MongoKeyfile/mongodb_keyfile.txt" ;;
    *) echo "Error: environment debe ser 'dev', 'test' o 'prod'." >&2; exit 1 ;;
esac

# El folder MongoKeyfile puede no existir todavia en ambientes recien creados
keyfile_dir="$(dirname "$keyfile_path")"
mkdir -p "$keyfile_dir"

echo "Generating MongoDB keyfile for environment: $environment"

# Check if keyfile already exists
if [ -f "$keyfile_path" ]; then
    read -r -p "Keyfile already exists. Overwrite? (yes/no) " confirmation
    if [ "$confirmation" != "yes" ]; then
        echo "Operation cancelled."
        exit 0
    fi
fi

# Generate secure random keyfile (1024 bytes base64)
# MongoDB requires keyfile between 6 and 1024 bytes
# 756 bytes = 1008 base64 chars
base64_value="$(head -c 756 /dev/urandom | base64 -w 0)"

# Save to file
printf '%s' "$base64_value" > "$keyfile_path"

echo "MongoDB keyfile generated successfully"
echo "  Location: $keyfile_path"
echo "  Size: ${#base64_value} characters"
echo ""
echo "IMPORTANT SECURITY NOTES:"
echo "  1. This keyfile is used for ReplicaSet authentication"
echo "  2. Keep it secure and never commit to Git"
echo "  3. All nodes in the ReplicaSet must use the SAME keyfile"
echo "  4. Rotate this keyfile periodically (recommended: every 90 days)"
echo ""
