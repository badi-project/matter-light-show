#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  Fabrique une copie PROPRE du projet, prête à être poussée sur GitHub.
#
#  Rien n'est modifié dans ton dossier de travail : le script copie le projet
#  ailleurs (par défaut « ShowLumiere-publication », à côté du projet), en
#  laissant de côté tout ce qui est perso ou généré, puis il CONTRÔLE le
#  résultat. Si quelque chose de perso reste, il s'arrête et te le montre.
#
#  À relancer avant chaque nouvelle version.
#  Usage : double-clic, ou  Scripts/preparer-publication.command [dossier]
#  (variables facultatives : NOM_LICENCE="ton pseudo"  NO_PAUSE=1)
# ─────────────────────────────────────────────────────────────────────────────
set -u
cd "$(dirname "$0")/.." || exit 1
SRC="$(pwd)"
DEST="${1:-$(dirname "$SRC")/ShowLumiere-publication}"
MARK=".cree-par-preparer-publication"

pause() { if [ -t 0 ] && [ -z "${NO_PAUSE:-}" ]; then echo; read -n 1 -s -r -p "Appuie sur une touche pour fermer cette fenêtre…"; echo; fi; }
say()   { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail()  { printf '\n\033[31m✗ %s\033[0m\n' "$1"; pause; exit 1; }

command -v rsync >/dev/null 2>&1 || fail "rsync est introuvable."
for f in README.md LICENSE .gitignore Server/server.mjs ShowLumiere.xcodeproj/project.pbxproj; do
  [ -e "$SRC/$f" ] || fail "Fichier manquant dans le projet : $f"
done

say "Copie propre du projet vers : $DEST"
if [ -e "$DEST" ] && [ ! -e "$DEST/$MARK" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then
  fail "Le dossier $DEST existe déjà et n'a pas été créé par ce script. Choisis un autre dossier : Scripts/preparer-publication.command /un/autre/dossier"
fi
mkdir -p "$DEST" || fail "Impossible de créer $DEST."
: > "$DEST/$MARK"

rsync -a --delete \
  --exclude '.DS_Store' --exclude '.git/' --exclude "$MARK" --exclude '__pycache__/' --exclude '*.pyc' \
  --exclude '/Vendor/' --exclude '/build/' --exclude '/build-release/' --exclude 'node_modules/' --exclude 'xcuserdata/' \
  --exclude '/data/' --exclude '/Server/data/' \
  --exclude '/LISEZMOI-APP.md' --exclude '/Server-originaux.md5' --exclude 'NOTES*.md' \
  --exclude '*.zip' --exclude '*.app' --exclude '*.dmg' --exclude '*.sha256' --exclude '*.log' \
  --exclude '/LICENSE' --exclude '/Scripts/patch_server.py' \
  "$SRC/" "$DEST/" || fail "La copie a échoué."
ok "Fichiers copiés (sans données, sans node_modules, sans Node, sans notes perso)"

# ── identifiant d'équipe Apple : retiré de la copie ──
P="$DEST/ShowLumiere.xcodeproj/project.pbxproj"
BEFORE="$(grep -c -E 'DEVELOPMENT_TEAM|DevelopmentTeam' "$P" || true)"
grep -v -E 'DEVELOPMENT_TEAM|DevelopmentTeam' "$P" > "$P.tmp" && mv "$P.tmp" "$P" || fail "Impossible de nettoyer project.pbxproj."
ok "Identifiant d'équipe Apple retiré du projet ($BEFORE ligne(s))"

# ── licence : nom ou pseudo au choix ──
NAME="${NOM_LICENCE:-}"
if [ -z "$NAME" ] && [ -t 0 ]; then
  echo
  read -r -p "  Nom ou pseudo à mettre dans la licence (Entrée = « Show lumière contributors ») : " NAME
fi
[ -n "$NAME" ] || NAME="Show lumière contributors"
sed -n '3p' "$SRC/LICENSE" | grep -q '^Copyright (c)' || fail "La licence n'a pas le format attendu (la 3e ligne doit commencer par « Copyright (c) »)."
{ sed -n '1,2p' "$SRC/LICENSE"; printf 'Copyright (c) 2026 %s\n' "$NAME"; sed -n '4,$p' "$SRC/LICENSE"; } > "$DEST/LICENSE"
ok "Licence MIT au nom de : $NAME"

# ── contrôle : rien de perso ni de dangereux ne doit rester ──
say "Contrôle de la copie"
PROBLEMS=0
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; PROBLEMS=$((PROBLEMS + 1)); }

FILES="$(find "$DEST" -name .git -prune -o \( -name '.DS_Store' -o -name '*.zip' -o -name '*.log' -o -name '.env*' -o -name '*.pem' -o -name '*.p12' -o -name '*.key' -o -name '*.mobileprovision' -o -name xcuserdata -o -name node_modules -o -name data -o -name Vendor -o -name '*.app' -o -name __pycache__ \) -print)"
if [ -n "$FILES" ]; then bad "Fichiers qui ne doivent pas être publiés :"; echo "$FILES" | sed 's/^/      /'; fi

# Le pseudo public du dépôt (« badi-project ») est autorisé ; toute autre mention perso est refusée.
PERSO_RE='badi|megueni|badtanimt|gmail\.com|/Users/'
PERSO="$(cd "$DEST" && grep -rIniE --exclude=preparer-publication.command --exclude-dir=.git "$PERSO_RE" . 2>/dev/null | sed 's/badi-project//g' | grep -iE "$PERSO_RE" | cut -c1-180)"
if [ -n "$PERSO" ]; then bad "Mentions personnelles trouvées :"; echo "$PERSO" | sed 's/^/      /'; fi

SECRETS="$(grep -rIniE --exclude=package-lock.json --exclude=preparer-publication.command --exclude-dir=.git '(client_secret|BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|github_pat_|xox[abp]-|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,})' "$DEST" 2>/dev/null | cut -c1-180)"
if [ -n "$SECRETS" ]; then bad "Clés ou jetons possibles :"; echo "$SECRETS" | sed 's/^/      /'; fi

if grep -q -E 'DEVELOPMENT_TEAM|DevelopmentTeam' "$P"; then bad "Un identifiant d'équipe Apple reste dans project.pbxproj."; fi

BIG="$(find "$DEST" -name .git -prune -o -type f -size +20000k -print)"
if [ -n "$BIG" ]; then bad "Fichiers de plus de 20 Mo (à mettre dans une Release, pas dans le dépôt) :"; echo "$BIG" | sed 's/^/      /'; fi

if [ "$PROBLEMS" -gt 0 ]; then
  fail "$PROBLEMS problème(s) à corriger dans ton dossier de travail, puis relance ce script. Rien n'est publié."
fi
ok "Aucun fichier perso, aucune clé, aucun identifiant d'équipe, aucun fichier trop gros"

COUNT="$(find "$DEST" -name .git -prune -o -type f ! -name "$MARK" -print | wc -l | tr -d ' ')"
SIZE="$(du -sh "$DEST" | cut -f1)"
say "Prêt : $COUNT fichiers, $SIZE"
ls -A "$DEST" | grep -v "^$MARK$" | sed 's/^/    /'

cat <<MSG

▸ Pour publier (adapte le chemin du clone de ton dépôt) :

    cd /chemin/vers/ton/clone
    git pull
    git rm -r -q .                       # retire l'ancienne arborescence (elle reste dans l'historique)
    rsync -a --exclude "$MARK" "$DEST/" ./
    git add -A
    git status                           # RELIS la liste : aucun fichier perso ne doit apparaître
    git commit -m "App Mac Show lumière"
    git push

  (Si ton dépôt contient des fichiers à garder qui ne sont pas dans ce projet, saute la ligne « git rm ».)

  Ensuite : Scripts/release.command fabrique le zip à mettre dans une Release GitHub.
MSG
pause
