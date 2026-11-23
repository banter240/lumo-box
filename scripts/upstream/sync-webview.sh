#!/usr/bin/env bash
# Refresh packages/lumo-webview from ProtonLumo/lumo-desktop (see UPSTREAM).
# Usage: bash scripts/upstream/sync-webview.sh [commit-or-ref]   (default: master)

set -euo pipefail

REPO="ProtonLumo/lumo-desktop"
REF="${1:-master}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/packages/lumo-webview/src"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone "https://github.com/$REPO.git" "$TMP/repo" >/dev/null 2>&1
git -C "$TMP/repo" checkout --detach "$REF" >/dev/null 2>&1
COMMIT="$(git -C "$TMP/repo" rev-parse HEAD)"

rm -rf "$DEST"
mkdir -p "$DEST"
# pages/ + static/: the local pages the desktop app serves itself (login,
# search, the full settings UI with its connector/MCP management).
cp -r "$TMP/repo/webview/bridges" "$TMP/repo/webview/shared" "$TMP/repo/webview/types" \
    "$TMP/repo/webview/pages" "$TMP/repo/webview/static" "$DEST/"

cat > "$ROOT/packages/lumo-webview/UPSTREAM" <<EOF
packages/lumo-webview synced from ProtonLumo/lumo-desktop (webview/) - DO NOT EDIT MANUALLY

Repository: https://github.com/ProtonLumo/lumo-desktop
Branch: $REF
Commit: $COMMIT ($(date -u +%Y-%m-%d))
License: GPL-3.0 (same as lumo-box)

Refresh: bash scripts/upstream/sync-webview.sh
EOF

echo "synced $REF ($COMMIT) -> $DEST"
echo "next: npx tsc --noEmit (upstream renames must fail loudly), then npm run build"
