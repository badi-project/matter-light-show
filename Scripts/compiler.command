#!/bin/bash
# Compile l'app « Show lumière » en version finale (Release) sans ouvrir Xcode.
# Prérequis : « Scripts/preparer.command » déjà lancé, et l'équipe de signature choisie une fois dans Xcode
# (Signing & Capabilities › Team › ton compte personnel).
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"

pause() { echo; read -n 1 -s -r -p "Appuie sur une touche pour fermer cette fenêtre…"; echo; }

# Xcode installé mais « outils en ligne de commande » sélectionnés dans les réglages : on utilise quand même
# Xcode, pour cette exécution seulement (rien n'est modifié dans le système, pas de mot de passe).
if ! xcodebuild -version >/dev/null 2>&1; then
  # Candidats : le Xcode actuellement ouvert, puis Spotlight, puis /Applications.
  RUNNING_XC="$(ps -axo command= 2>/dev/null | sed -n 's#^\(.*\.app\)/Contents/MacOS/Xcode$#\1#p' | head -n 1)"
  while IFS= read -r XC; do
    [ -n "$XC" ] || continue
    if [ -d "$XC/Contents/Developer" ]; then export DEVELOPER_DIR="$XC/Contents/Developer"; break; fi
  done <<XCLIST
$RUNNING_XC
$(mdfind "kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'" 2>/dev/null)
$(ls -d /Applications/Xcode*.app 2>/dev/null)
XCLIST
  [ -n "${DEVELOPER_DIR:-}" ] && printf '  Xcode utilisé : %s\n' "$DEVELOPER_DIR"
fi

if [ ! -x "$ROOT/Vendor/node/node" ] || [ ! -d "$ROOT/Server/node_modules/@matter" ]; then
  echo "✗ Node ou les modules du serveur manquent. Lance d'abord « Scripts/preparer.command »."
  pause; exit 1
fi
if ! grep -Eq 'DEVELOPMENT_TEAM = [A-Z0-9]{10};' "$ROOT/ShowLumiere.xcodeproj/project.pbxproj"; then
  echo "✗ L'équipe de signature n'est pas encore choisie."
  echo "  Ouvre ShowLumiere.xcodeproj dans Xcode › cible « ShowLumiere » › Signing & Capabilities › Team,"
  echo "  choisis ton compte personnel (Apple Development), puis relance ce script."
  pause; exit 1
fi

echo "▸ Compilation (quelques minutes la première fois)…"
xcodebuild \
  -project "$ROOT/ShowLumiere.xcodeproj" \
  -scheme ShowLumiere \
  -configuration Release \
  -derivedDataPath "$ROOT/build" \
  -allowProvisioningUpdates \
  build
STATUS=$?

APP="$ROOT/build/Build/Products/Release/Show lumière.app"
if [ $STATUS -eq 0 ] && [ -d "$APP" ]; then
  echo
  echo "✓ App prête : $APP"
  echo "  Glisse-la dans « Applications » (dossier général, pas ~/Applications) et ouvre-la depuis là."
  open -R "$APP"
else
  echo
  echo "✗ La compilation a échoué (code $STATUS). Copie les dernières lignes ci-dessus et envoie-les moi."
fi
pause
exit $STATUS
