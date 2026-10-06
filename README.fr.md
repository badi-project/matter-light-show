# Show lumière Matter 💡🎶

Un logiciel qui transforme ton Mac en **contrôleur Matter** et joue des shows de lumière sur tes lampes, synchronisés avec la musique que tu écoutes (Apple Music, Spotify, Deezer, Sonos…), avec une interface web simple pour les composer — y compris depuis ton téléphone.

Pas de cloud, pas de compte, pas d'API constructeur : tout passe en local, en Matter standard (et, si tu veux, WiZ, Home Assistant ou Zigbee2MQTT).

C'est une **vraie app Mac** (une ampoule dans la barre des menus, Mac Apple Silicon, macOS 14 ou plus) qui contient déjà Node.js : rien d'autre à installer. Le serveur peut aussi se lancer directement depuis le code.

🇬🇧 [Read in English](README.md)

![Éditeur de shows](docs/screenshot-shows.png)

![Synchro musique](docs/screenshot-music.png)

![Pièces](docs/screenshot-rooms.png)

```
 Mac (ce logiciel)  ──Matter / Wi-Fi──▶  Pont Hue  ──Zigbee──▶  lampes Hue
        ▲                                   ▲
   navigateur                        l'app Maison reste connectée en parallèle
```

**Ce qui passe par Philips, et ce qui n'y passe pas.** Tes ampoules Hue parlent Zigbee : le pont Hue reste donc nécessaire, car c'est lui qui les expose sur le réseau en Matter. En revanche, le logiciel n'utilise ni l'API Hue, ni le cloud Philips, ni l'app Hue pour piloter les lampes. Il envoie uniquement des commandes Matter standard (allumer, luminosité, couleur, identifier). Il marcherait de la même façon avec n'importe quelle lampe Matter d'une autre marque.

> Projet personnel partagé tel quel, sans garantie (voir la licence). Il n'est affilié ni à Philips Hue, ni à IKEA, ni à Apple, ni à Spotify, ni à Deezer, ni à Sonos : ces noms appartiennent à leurs propriétaires.

**Le guide complet d'utilisation** (appairage du pont, création de shows, synchro musique, pièces, enceintes, téléphone, dépannage) est dans [`Server/LISEZMOI.md`](Server/LISEZMOI.md).

---

## Installer l'app Mac

**Il te faut** : un Mac **Apple Silicon** (M1 ou plus récent) avec **macOS 14** ou plus. Il n'y a **rien d'autre à installer** : Node.js est déjà dans l'app.

1. Va dans la page [**Releases**](https://github.com/badi-project/matter-light-show/releases) de ce dépôt et télécharge `Show-lumiere-x.y.z.zip`.
2. Ouvre le zip et glisse **Show lumière** dans le dossier **Applications**.
3. Ouvre l'app. La première fois, macOS refuse (« Apple ne peut pas vérifier… ») parce que l'app n'est pas notarisée par Apple. Va dans **Réglages Système › Confidentialité et sécurité**, descends en bas et clique **« Ouvrir quand même »**.
   Variante au Terminal : `xattr -dr com.apple.quarantine "/Applications/Show lumière.app"`
4. Réponds **Autoriser** aux demandes de macOS (réseau local, Musique, Bluetooth, micro) : chacune sert à une fonction précise, et le guide les détaille.
5. Une ampoule apparaît dans la barre des menus. Pour démarrer avec le Mac : ampoule › **Ouvrir au démarrage du Mac**.

Pour vérifier le fichier téléchargé : `shasum -a 256 Show-lumiere-x.y.z.zip` doit afficher la même valeur que dans la Release.

**Premiers pas** : appaire ton pont Hue (ou un autre appareil Matter) en suivant la [section 2 du guide](Server/LISEZMOI.md#2-appairer-le-pont-hue-une-seule-fois), puis ouvre l'onglet des shows.

**Mise à jour** : remplace l'app par la nouvelle version, ton dossier de données est conservé. macOS peut te redemander les autorisations (réseau local, Musique…) après une mise à jour, parce que l'app n'est pas signée par un compte développeur payant. Les notes de chaque version sont dans la page **Releases**.

## Lancer sans l'app (depuis le code)

Il faut **Node.js 22.13 ou plus récent** ([nodejs.org](https://nodejs.org)). Le serveur est dans le dossier `Server/` :

```bash
git clone https://github.com/badi-project/matter-light-show.git
cd matter-light-show/Server
npm ci --omit=dev
node server.mjs
```

Ouvre ensuite <http://localhost:8321>. Les données sont alors dans `Server/data/` (exclu de Git).

Range le dossier dans un endroit **qui n'est pas synchronisé avec le cloud** (par exemple `~/Applications`, pas le Bureau ni Documents si iCloud les synchronise) : quand le disque se remplit, macOS retire les fichiers du Mac pour les garder seulement dans le cloud, et le logiciel ne peut alors plus démarrer.

## Compiler l'app toi-même

Il te faut Xcode et un compte Apple gratuit pour signer l'app.

1. Rends les scripts exécutables une seule fois (GitHub ne garde pas ce droit) : `chmod +x Scripts/*.command Scripts/*.sh`
2. Double-clique `Scripts/preparer.command` : il télécharge le Node officiel (signature SHA-256 vérifiée) et installe les modules du serveur.
3. Ouvre `ShowLumiere.xcodeproj`. Dans **Signing & Capabilities**, choisis ton compte dans **Team** et **remplace l'identifiant** `fr.showlumiere.mac` par un identifiant à toi (par exemple `com.tonnom.showlumiere`) : celui du dépôt est déjà pris.
4. Lance avec ▶ (⌘R), ou double-clique `Scripts/compiler.command`.

Pour fabriquer le zip d'une Release (signature locale, sans compte Apple) : `Scripts/release.command`.

## Tes données restent chez toi

Tout ce qui est personnel est écrit dans un **dossier de données**, jamais dans l'app ni dans ce dépôt : `~/Library/Application Support/Show lumière/` pour l'app Mac, ou `Server/data/` (**exclu de Git**) quand tu lances le code.

| Chemin (dans le dossier de données) | Contenu |
|---|---|
| `data/matter/` | identité du contrôleur Matter et appairages — **ne le partage jamais** |
| `data/systemes.json` | réglages des autres systèmes, dont le **jeton Home Assistant** et le mot de passe MQTT — **ne le partage jamais** |
| `data/acces.json` | clé et code du contrôle depuis le téléphone — **ne le partage jamais** |
| `data/lampes.json` | noms, ordre et lampes masquées |
| `data/pieces.json` | tes pièces, leurs lampes et leurs enceintes |
| `data/reglages.json` | réglages (dont « Mes couleurs ») |
| `data/tempos.json` | tempos calés |
| `data/morceaux/` | pochettes, extraits et analyses en cache des morceaux joués |

Les journaux de l'app sont dans `~/Library/Logs/Show lumière/`. Les shows que tu crées sont enregistrés dans `shows/`, à côté de `data/` (exclus de Git aussi, sauf les 4 shows fournis). Pour en partager un, utilise **Exporter**.

Pour trouver la pochette, l'extrait de 30 s, le genre et le tempo, le logiciel envoie le **titre et l'artiste** du morceau aux API publiques **iTunes Search** et **Deezer** (sans compte ni clé). Les analyses (couleurs, tempo, énergie) sont faites dans ton navigateur et les résultats restent en cache sur ton Mac pendant 30 jours. Spotify n'est contacté que si tu connectes toi-même ton compte.

## Fichiers du projet

- `ShowLumiere.xcodeproj`, `ShowLumiere/`, `Config/` : l'app Mac (Swift : barre des menus, fenêtre, lancement du serveur, reprise des anciennes données).
- `Scripts/` : préparation (téléchargement de Node), compilation, fabrication du zip de Release.
- `Server/` : le serveur (contrôleur Matter avec la bibliothèque open source [matter.js](https://github.com/matter-js/matter.js), pilotes WiZ / Home Assistant / Zigbee2MQTT, moteur de show, pièces, palettes, synchro musique, accès depuis le téléphone), l'interface web (`Server/public/`) et les shows fournis (`Server/shows/`, JSON lisible ; format décrit dans le [README anglais](README.md#show-file-format)).
- `docs/` : captures d'écran.

## Licence

[MIT](LICENSE). Le générateur de QR code (`Server/lib/vendor/qrcode.mjs`) est la bibliothèque *QR Code Generator* de Kazuhiko Arase, sous licence MIT. L'app embarque le binaire officiel de [Node.js](https://nodejs.org) (MIT). Projet indépendant, sans lien avec Philips Hue / Signify, Apple, Spotify, Deezer, Sonos, IKEA, WiZ, Home Assistant ou la Connectivity Standards Alliance.
