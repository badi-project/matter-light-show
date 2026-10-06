#!/bin/bash
# Étape de compilation Xcode (« Run Script ») : met Node et le serveur DANS l'app.
#   Contents/Helpers/node            ← Vendor/node/node  (signé avec ses droits JIT)
#   Contents/Resources/serveur/…     ← Server/ (code + node_modules)
set -euo pipefail

NODE_SRC="$SRCROOT/Vendor/node/node"
SERVER_SRC="$SRCROOT/Server"
DEST="$TARGET_BUILD_DIR/$CONTENTS_FOLDER_PATH"

if [ ! -x "$NODE_SRC" ]; then
  echo "error: Node est absent. Lance d'abord « Scripts/preparer.command » (double-clic), puis recompile."
  exit 1
fi
if [ ! -d "$SERVER_SRC/node_modules/@matter" ]; then
  echo "error: Les modules du serveur sont absents (Server/node_modules). Lance d'abord « Scripts/preparer.command », puis recompile."
  exit 1
fi
if [ ! -f "$SERVER_SRC/server.mjs" ] || [ ! -f "$SERVER_SRC/app-build.json" ]; then
  echo "error: Le dossier « Server » est incomplet (server.mjs ou app-build.json manquant)."
  exit 1
fi

mkdir -p "$DEST/Helpers" "$DEST/Resources/serveur"
cp -f "$NODE_SRC" "$DEST/Helpers/node"
chmod 755 "$DEST/Helpers/node"

# le code du serveur (jamais de données : elles vivent dans Application Support)
rsync -a --delete \
  --exclude '.DS_Store' --exclude '/data/' --exclude '*.log' \
  "$SERVER_SRC/" "$DEST/Resources/serveur/"

# Node est un programme à part : il est signé ici, avec la même identité que l'app
IDENTITY="${EXPANDED_CODE_SIGN_IDENTITY:--}"
if [ -z "$IDENTITY" ]; then IDENTITY="-"; fi
codesign --force --options runtime --timestamp=none \
  --entitlements "$SRCROOT/Config/Node.entitlements" \
  --sign "$IDENTITY" "$DEST/Helpers/node"

echo "Node et le serveur sont dans l'app ($(cat "$SERVER_SRC/app-build.json" | tr -d '\n' | cut -c1-80))."
