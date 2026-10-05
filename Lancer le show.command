#!/bin/bash
# Double-clic pour démarrer le show de lumière (macOS).
cd "$(dirname "$0")" || exit 1
HERE="$(pwd -P)"
P="${PORT:-8321}"
# Après un téléchargement depuis GitHub, l'app « Show lumière » n'est pas encore exécutable
chmod +x "Show lumière.app/Contents/MacOS/show-lumiere" 2>/dev/null
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

pause() { echo; read -n 1 -s -r -p "Appuie sur une touche pour fermer cette fenêtre…"; echo; }

# Si le logiciel tourne en arrière-plan (service macOS), on le (re)lance simplement et on ouvre la page.
LABEL="fr.showlumiere.serveur"
if [ -f "$HOME/Library/LaunchAgents/$LABEL.plist" ]; then
  echo "💡 Le show tourne en arrière-plan : ouverture de la page…"
  launchctl kickstart "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$LABEL.plist" >/dev/null 2>&1
  for i in $(seq 1 40); do curl -fsS -m 1 http://localhost:$P/api/ping >/dev/null 2>&1 && break; sleep 0.5; done
  open "http://localhost:$P"
  echo "Tu peux fermer cette fenêtre (le show continue sans elle)."
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js n'est pas installé."
  echo "   Installe la version LTS depuis https://nodejs.org (bouton « Télécharger »), puis relance ce fichier."
  open "https://nodejs.org/fr/download"
  pause; exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "❌ Ta version de Node.js ($(node -v)) est trop ancienne : il faut la 22 ou plus récente."
  open "https://nodejs.org/fr/download"
  pause; exit 1
fi

if [ ! -d node_modules/@project-chip ]; then
  echo "📦 Première installation (environ 1 minute)…"
  if ! npm install --no-fund --no-audit; then
    echo "❌ L'installation a échoué (connexion Internet ?)."
    pause; exit 1
  fi
fi

# Si une ancienne version du show tourne encore (autre fenêtre Terminal), on l'arrête proprement
OLD=""
for pid in $(pgrep -f "(^|/)node server\.mjs$" 2>/dev/null); do
  [ "$pid" = "$$" ] && continue
  dir=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  [ "$dir" = "$HERE" ] && OLD="$OLD $pid"
done
OLD="$OLD $(lsof -ti tcp:$P -sTCP:LISTEN 2>/dev/null)"
OLD=$(echo $OLD | tr ' ' '\n' | sort -u | tr '\n' ' ')
if [ -n "${OLD// /}" ]; then
  echo "🔄 Arrêt de la version déjà lancée…"
  kill $OLD 2>/dev/null
  for i in $(seq 1 20); do
    alive=""
    for pid in $OLD; do kill -0 "$pid" 2>/dev/null && alive=1; done
    [ -z "$alive" ] && break
    sleep 0.5
  done
  kill -9 $OLD 2>/dev/null
  sleep 1
fi

echo "💡 Démarrage… (garde cette fenêtre ouverte pendant le show, ferme-la pour tout arrêter)"
(sleep 3; open "http://localhost:$P") &
# caffeinate empêche le Mac de se mettre en veille tant que le show tourne.
# Après une mise à jour, le serveur peut demander à être relancé (code de sortie 75) : on le relance ici.
export SHOW_LAUNCHER=1
while true; do
  caffeinate -i node server.mjs
  code=$?
  [ "$code" -eq 75 ] || exit "$code"
  echo "🔄 Redémarrage du show…"
  sleep 1
done
