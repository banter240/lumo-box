#!/bin/bash
#
# Spin up an isolated lumo-box test instance (separate BOX_HOME, own
# vault/config/logs) for live testing against a build. The production
# slot (BOX_HOME/BOX_PORT in the shell env) stays untouched.
#
# Why this script exists (2026-11-22 debugging session):
#   1. The interactive shell exports BOX_PORT / BOX_HOME /
#      BOX_VAULT_KEY_FILE pointing at the production slot — a plain
#      `node dist/src/box.js server` silently binds the PRODUCTION data
#      dir and port. Overriding per-invocation with `env` fixes it.
#   2. auth.vault.keyFilePath must live inside the test home, or vault
#      creation falls back to keychain → /run/secrets and fails on a
#      desktop without a keychain service.
#
# Usage: scripts/dev-test-server.sh [port]   (default 3060)
# Login once at http://localhost:<port>/auth; the vault persists in
# dev/tmp/box-<port>/ across restarts.

set -euo pipefail

PORT="${1:-3060}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOME_DIR="$ROOT/dev/tmp/box-$PORT"
mkdir -p "$HOME_DIR"

if [ ! -f "$HOME_DIR/config.yaml" ]; then
    cat > "$HOME_DIR/config.yaml" <<EOF
server:
  port: $PORT
  apiKey: "test-key-$PORT"
pacing:
  enabled: true
webapp:
  enabled: false
auth:
  vault:
    keyFilePath: $HOME_DIR/vault-key
EOF
fi

# Ensure the vault key path is pinned to the test home even if the file
# was created under an older config.
grep -q "keyFilePath" "$HOME_DIR/config.yaml" || cat >> "$HOME_DIR/config.yaml" <<EOF
auth:
  vault:
    keyFilePath: $HOME_DIR/vault-key
EOF

echo "Starting test lumo_box on :$PORT (home: $HOME_DIR)"
exec env \
    BOX_HOME="$HOME_DIR" \
    BOX_PORT="$PORT" \
    BOX_PORT="$PORT" \
    node "$ROOT/dist/src/box.js" server
