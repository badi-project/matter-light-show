#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  Fabrique le zip d'une Release GitHub (« Show-lumiere-x.y.z.zip »).
#
#  Différence avec compiler.command : ici l'app est signée « en local » (ad hoc),
#  donc SANS ton compte Apple. Une app signée avec ton compte de développement
#  embarque un profil lié à ton Mac et ne s'ouvrirait pas chez les autres.
#  Le script vérifie ce point avant de zipper.
#
#  Prérequis : Scripts/preparer.command déjà lancé.
# ─────────────────────────────────────────────────────────────────────────────
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
OUT="$ROOT/build-release"

pause() { if [ -t 0 ] && [ -z "${NO_PAUSE:-}" ]; then echo; read -n 1 -s -r -p "Appuie sur une touche pour fermer cette fenêtre…"; echo; fi; }
say()   { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail()  { printf '\n\033[31m✗ %s\033[0m\n' "$1"; pause; exit 1; }

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

say "Contrôles avant compilation"
command -v xcodebuild >/dev/null 2>&1 || fail "Xcode est introuvable (xcodebuild)."
[ -x "$ROOT/Vendor/node/node" ] && [ -d "$ROOT/Server/node_modules/@matter" ] || fail "Node ou les modules du serveur manquent. Lance d'abord « Scripts/preparer.command »."

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/Server/app-build.json" | head -n 1)"
VERSION_XCODE="$(sed -n 's/.*MARKETING_VERSION = \([0-9.]*\);.*/\1/p' "$ROOT/ShowLumiere.xcodeproj/project.pbxproj" | head -n 1)"
[ -n "$VERSION" ] || fail "Version introuvable dans Server/app-build.json."
if [ "$VERSION" != "$VERSION_XCODE" ]; then
  fail "Les versions ne correspondent pas : $VERSION dans Server/app-build.json, $VERSION_XCODE dans le projet Xcode (MARKETING_VERSION). Mets-les d'accord (make_xcodeproj.py : VERSION), puis relance."
fi
ok "Version $VERSION"

say "Compilation (signature locale, quelques minutes)"
rm -rf "$OUT"
xcodebuild \
  -project "$ROOT/ShowLumiere.xcodeproj" \
  -scheme ShowLumiere \
  -configuration Release \
  -derivedDataPath "$OUT" \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="-" \
  DEVELOPMENT_TEAM="" \
  PROVISIONING_PROFILE_SPECIFIER="" \
  CODE_SIGNING_REQUIRED=YES \
  CODE_SIGNING_ALLOWED=YES \
  GCC_GENERATE_DEBUGGING_SYMBOLS=NO \
  DEBUG_INFORMATION_FORMAT=dwarf \
  OTHER_LDFLAGS='$(inherited) -Wl,-S' \
  build
STATUS=$?
[ $STATUS -eq 0 ] || fail "La compilation a échoué (code $STATUS). Copie les dernières lignes ci-dessus et envoie-les moi."

APP="$OUT/Build/Products/Release/Show lumière.app"
[ -d "$APP" ] || fail "L'app n'est pas là où je l'attendais : $APP"

say "Vérification de l'app"
codesign --verify --deep --strict "$APP" 2>/dev/null || fail "La signature de l'app est invalide."
ok "Signature valide"
codesign -dv "$APP" 2>&1 | grep -q 'Signature=adhoc' || fail "L'app n'est pas signée « en local » (ad hoc) : elle ne s'ouvrirait pas chez les autres. Regarde la ligne « Signature= » de : codesign -dv \"$APP\""
ok "Signée en local (ad hoc), pas avec ton compte Apple"
[ ! -e "$APP/Contents/embedded.provisionprofile" ] || fail "Un profil d'approvisionnement est embarqué (Contents/embedded.provisionprofile) : l'app ne s'ouvrirait que sur ton Mac."
codesign -d --entitlements :- "$APP" 2>/dev/null | grep -q 'application-identifier' && fail "L'app contient un droit lié à ton compte Apple (application-identifier) : elle ne s'ouvrirait que sur ton Mac."
ok "Aucun profil ni droit lié à ton compte"

EXE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist" 2>/dev/null)"
[ -n "$EXE" ] && [ -x "$APP/Contents/MacOS/$EXE" ] || fail "Programme principal introuvable dans l'app."
[ "$(lipo -archs "$APP/Contents/MacOS/$EXE" 2>/dev/null)" = "arm64" ] || fail "Le programme principal n'est pas en arm64 seul."
[ -x "$APP/Contents/Helpers/node" ] || fail "Node n'est pas dans l'app (Contents/Helpers/node)."
[ "$(lipo -archs "$APP/Contents/Helpers/node" 2>/dev/null)" = "arm64" ] || fail "Node n'est pas en arm64."
codesign --verify "$APP/Contents/Helpers/node" 2>/dev/null || fail "La signature de Node est invalide."
codesign -d --entitlements :- "$APP/Contents/Helpers/node" 2>/dev/null | grep -q 'allow-jit' || fail "Node a perdu son droit JIT : il ne démarrerait pas."
[ -d "$APP/Contents/Resources/serveur/node_modules/@matter" ] || fail "Les modules Matter ne sont pas dans l'app."
[ -f "$APP/Contents/Resources/serveur/server.mjs" ] || fail "Le serveur n'est pas dans l'app."
ok "Programme principal et Node en arm64, serveur et modules embarqués"

if find "$APP" \( -name 'data' -o -name '.DS_Store' \) -print -quit | grep -q .; then
  fail "L'app contient un dossier « data » ou un .DS_Store : de quoi fuiter des données. Regarde : find \"$APP\" -name data"
fi
ok "Aucune donnée dans l'app"
if grep -rqaF "$HOME" "$APP" 2>/dev/null; then
  fail "L'app contient le chemin de ton dossier personnel ($HOME) : il serait publié avec le zip. Cherche où : grep -rlaF \"$HOME\" \"$APP\""
fi
ok "Aucun chemin de ton dossier personnel dans l'app"

say "Fabrication du zip"
ZIP="$OUT/Show-lumiere-$VERSION.zip"
rm -f "$ZIP" "$ZIP.sha256"
ditto -c -k --keepParent "$APP" "$ZIP" || fail "Le zip n'a pas pu être créé."
( cd "$OUT" && shasum -a 256 "Show-lumiere-$VERSION.zip" > "Show-lumiere-$VERSION.zip.sha256" )
SUM="$(cut -d' ' -f1 "$ZIP.sha256")"
SIZE="$(du -h "$ZIP" | cut -f1)"
ok "$ZIP ($SIZE)"

cat <<MSG

▸ Pour publier la Release :

  1. Sur GitHub : ton dépôt › Releases › Draft a new release › tag « v$VERSION ».
  2. Glisse le fichier  Show-lumiere-$VERSION.zip  dans la zone des fichiers joints.
  3. Texte de la Release (à adapter) :

       App Mac (Apple Silicon, macOS 14 ou plus). Installation et étape « Ouvrir quand même » : voir le README.
       SHA-256 : $SUM

  AVANT de la publier : télécharge ce zip depuis GitHub avec Safari sur UN AUTRE Mac (c'est ce qui déclenche
  le vrai avertissement de macOS) et vérifie qu'il s'ouvre après « Ouvrir quand même » et qu'il trouve tes lampes.
MSG
command -v open >/dev/null 2>&1 && open -R "$ZIP"
pause
