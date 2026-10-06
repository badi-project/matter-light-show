#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  Préparation de l'app « Show lumière » — à lancer UNE FOIS (double-clic),
#  avant de compiler l'app dans Xcode.
#
#  Ce script :
#   1. télécharge le programme Node officiel (Mac Apple Silicon) et vérifie sa signature SHA-256 ;
#   2. installe les modules du serveur (Matter) dans le dossier « Server » ;
#   3. vérifie que tout démarre.
#  Il ne touche ni à tes données, ni à l'ancien Show lumière.
# ─────────────────────────────────────────────────────────────────────────────
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"

pause() { echo; read -n 1 -s -r -p "Appuie sur une touche pour fermer cette fenêtre…"; echo; }
say()   { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$1"; }
fail()  { printf '\n\033[31m✗ %s\033[0m\n' "$1"; pause; exit 1; }

say "Préparation de Show lumière (dossier : $ROOT)"

[ "$(uname -m)" = "arm64" ] || warn "Ce Mac n'est pas un Apple Silicon : l'app est prévue pour arm64."

# ── place disponible (Node, les modules et la compilation demandent de la place) ──
FREE_KB="$(df -k "$ROOT" | awk 'NR==2 {print $4}')"
if [ -n "${FREE_KB:-}" ] && [ "$FREE_KB" -lt 800000 ]; then
  fail "Il reste moins de 800 Mo de libre sur ce disque. Libère de la place ou déplace le dossier du projet sur un disque plus grand, puis relance."
fi
ok "Place disponible : $((FREE_KB / 1024)) Mo"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/showlumiere-prep.XXXXXX")" || fail "Impossible de créer un dossier temporaire."
trap 'rm -rf "$WORK"' EXIT

# ── 1. Node ──
say "1/3  Programme Node (officiel, arm64)"
WANT="${1:-${NODE_VERSION:-}}"
if [ -z "$WANT" ] && command -v node >/dev/null 2>&1; then
  WANT="$(node -v 2>/dev/null | sed 's/^v//')"
fi
[ -n "$WANT" ] || WANT="26.4.0"
echo "  Version souhaitée : $WANT (la même que sur ton Mac si elle est installée)"

NODE_TARBALL=""
fetch_node() {
  local base="$1" line sum file got
  curl -fsSL "$base/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt" || return 1
  line="$(grep -E ' node-v[0-9.]+-darwin-arm64\.tar\.gz$' "$WORK/SHASUMS256.txt" | head -n 1)"
  [ -n "$line" ] || return 1
  sum="${line%% *}"
  file="${line##* }"
  echo "  Téléchargement de $file…"
  curl -fL --progress-bar "$base/$file" -o "$WORK/$file" || return 1
  got="$(shasum -a 256 "$WORK/$file" | awk '{print $1}')"
  if [ "$got" != "$sum" ]; then
    echo "  La somme de contrôle ne correspond pas : fichier rejeté."
    return 2
  fi
  NODE_TARBALL="$WORK/$file"
  ok "Signature SHA-256 vérifiée"
  return 0
}

if ! fetch_node "https://nodejs.org/dist/v$WANT"; then
  warn "La version $WANT n'est pas disponible : je prends la dernière version « 24 » (compatible, ≥ 22.13)."
  fetch_node "https://nodejs.org/dist/latest-v24.x" || fail "Impossible de télécharger Node (réseau ? pare-feu ?). Vérifie ta connexion et relance."
fi

tar -xzf "$NODE_TARBALL" -C "$WORK" || fail "Impossible d'ouvrir l'archive de Node."
NODEDIR="$(ls -d "$WORK"/node-v*-darwin-arm64 2>/dev/null | head -n 1)"
[ -x "$NODEDIR/bin/node" ] || fail "L'archive de Node ne contient pas le programme attendu."

mkdir -p "$ROOT/Vendor/node"
cp -f "$NODEDIR/bin/node" "$ROOT/Vendor/node/node" || fail "Impossible de copier Node dans Vendor/node."
chmod +x "$ROOT/Vendor/node/node"
xattr -dr com.apple.quarantine "$ROOT/Vendor/node" 2>/dev/null || true
NODE_V="$("$ROOT/Vendor/node/node" -v 2>/dev/null)" || fail "Le programme Node téléchargé ne démarre pas sur ce Mac."
echo "$NODE_V" > "$ROOT/Vendor/node/VERSION.txt"
ok "Node $NODE_V prêt dans Vendor/node"

# ── 2. modules du serveur ──
say "2/3  Modules du serveur (Matter)"
OLD="$HOME/Applications/show-lumiere-matter"
export PATH="$NODEDIR/bin:$PATH"
if [ -d "$ROOT/Server/node_modules/@matter" ]; then
  ok "Déjà installés dans Server/node_modules"
elif [ -d "$OLD/node_modules/@matter" ] && cmp -s "$OLD/package-lock.json" "$ROOT/Server/package-lock.json"; then
  echo "  Je reprends les modules déjà installés de l'ancien Show lumière (mêmes versions, sans internet)…"
  ditto "$OLD/node_modules" "$ROOT/Server/node_modules" || fail "Copie des modules impossible."
  ok "Modules copiés (identiques à ceux de l'ancien Show lumière)"
else
  echo "  Installation depuis internet (npm)…"
  if (cd "$ROOT/Server" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund); then
    ok "Modules installés"
  elif [ -d "$OLD/node_modules/@matter" ]; then
    warn "npm n'a pas réussi : je reprends les modules de l'ancien Show lumière."
    ditto "$OLD/node_modules" "$ROOT/Server/node_modules" || fail "Copie des modules impossible."
    ok "Modules copiés depuis l'ancien Show lumière"
  else
    fail "Impossible d'installer les modules (réseau ?). Relance quand internet fonctionne."
  fi
fi

# ── 3. vérification ──
say "3/3  Vérification"
if (cd "$ROOT/Server" && "$ROOT/Vendor/node/node" --input-type=module -e "await import('@matter/main'); await import('@matter/nodejs'); console.log('ok')" >/dev/null 2>&1); then
  ok "Node et les modules Matter fonctionnent ensemble"
else
  fail "Les modules Matter ne se chargent pas avec ce Node. Envoie-moi ce message."
fi

chmod +x "$ROOT"/Scripts/*.command "$ROOT"/Scripts/*.sh 2>/dev/null || true

say "Terminé."
echo "  Étape suivante : ouvre « ShowLumiere.xcodeproj » dans Xcode (voir LISEZMOI-APP.md)."
pause
