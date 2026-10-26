#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "=== P-Ingá Universal Harness Installer ==="

# 1. Global binary wrapper in ~/.local/bin/pinga
mkdir -p "${HOME}/.local/bin"
cat << 'EOF' > "${HOME}/.local/bin/pinga"
#!/usr/bin/env bash
if command -v bun >/dev/null 2>&1; then
  exec bun /home/shibuka/Projetos/duh-homelab/p-inga/bin/pinga.ts "$@"
else
  exec /home/shibuka/Projetos/duh-homelab/p-inga/.pinga/pinga-stable "$@"
fi
EOF
chmod +x "${HOME}/.local/bin/pinga"
echo "✓ ~/.local/bin/pinga configured"

# 2. Canonical skills source
PINGA_SRC="${REPO_DIR}/skills/pinga/SKILL.md"
REDAUDIT_SRC="${REPO_DIR}/skills/red-audit/SKILL.md"

if [[ ! -f "${PINGA_SRC}" || ! -f "${REDAUDIT_SRC}" ]]; then
  echo "Error: Canonical skills not found in ${REPO_DIR}/skills" >&2
  exit 1
fi

# Target skill directories across all supported harnesses
TARGET_DIRS=(
  "${HOME}/.claude/skills"
  "${HOME}/.pi/agent/skills"
  "${HOME}/.hermes/skills"
  "${HOME}/.config/opencode/skills"
  "${HOME}/.gemini/config/plugins/g-inga/.agents/skills"
  "${REPO_DIR}/.agents/skills"
)

for target in "${TARGET_DIRS[@]}"; do
  mkdir -p "${target}/pinga" "${target}/red-audit"
  cp "${PINGA_SRC}" "${target}/pinga/SKILL.md"
  cp "${REDAUDIT_SRC}" "${target}/red-audit/SKILL.md"
  echo "✓ Installed skills in: ${target}"
done

# Clean up broken legacy symlinks in ~/.pi/agent/skills/ if any
find "${HOME}/.pi/agent/skills" -xtype l -delete 2>/dev/null || true

echo ""
echo "=== All harnesses updated successfully ==="
echo "pinga binary: $(which pinga)"
pinga ledger verify
