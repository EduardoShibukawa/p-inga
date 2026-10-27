#!/usr/bin/env bash
# Vigia da fila P-Ingá: scan determinístico + notificação Discord em transições.
# Zero tokens. Instalado por pinga-queue-watch.timer (systemd --user, 5 min).
set -euo pipefail
ROOT="${PINGA_ROOT:-/home/shibuka/Projetos/duh-homelab/p-inga-queue}"
BUN="/home/shibuka/.local/share/mise/installs/bun/latest/bin/bun"
cd "$ROOT"
exec "$BUN" run src/cli.ts queue --notify
