#!/bin/sh
# Writes the local security-review marker consumed by
# corporate-scripts/git-hooks/pre-push. Run this AFTER a passing security
# review (cybersecurity-orchestrator, /code-review, or security-audit skill)
# for the commit you are about to push to master.
#
# Usage: corporate-scripts/security-gate-mark.sh [commit-sha]
#   commit-sha defaults to the current HEAD.

set -eu

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

sha="${1:-$(git rev-parse HEAD)}"
mkdir -p .security-gate

reviewer="${SECURITY_GATE_REVIEWER:-manual}"
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > .security-gate/last-review.json <<EOF
{
  "commit": "$sha",
  "reviewer": "$reviewer",
  "verdict": "pass",
  "at": "$timestamp"
}
EOF

echo "security-gate: marked $sha as reviewed (reviewer=$reviewer) at $timestamp."
echo "  This only affects pushes to master and only on this machine."
