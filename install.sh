#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install.sh  –  Installs the "Separate Quick Toggles" GNOME Shell extension
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

UUID="separate-quick-toggles@extension"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "► Installing $UUID …"
mkdir -p "$DEST/schemas"

cp "$SCRIPT_DIR/extension.js"   "$DEST/"
cp "$SCRIPT_DIR/prefs.js"       "$DEST/"
cp "$SCRIPT_DIR/metadata.json"  "$DEST/"
cp "$SCRIPT_DIR/stylesheet.css" "$DEST/"
cp "$SCRIPT_DIR/schemas/org.gnome.shell.extensions.separate-quick-toggles.gschema.xml" \
   "$DEST/schemas/"

echo "► Compiling GSettings schema …"
glib-compile-schemas "$DEST/schemas/"

echo "► Enabling extension …"
gnome-extensions enable "$UUID" 2>/dev/null || true

echo ""
echo "✔  Done!  Installed at:"
echo "   $DEST"
echo ""
echo "Restart GNOME Shell to activate:"
echo "  X11      →  Alt + F2, type 'r', press Enter"
echo "  Wayland  →  Log out and log back in"
echo ""
echo "Open preferences:"
echo "  gnome-extensions prefs $UUID"
