# Show lumière Matter 💡🎶

Un petit logiciel qui transforme ton Mac en **contrôleur Matter** et joue des shows de lumière sur tes lampes, synchronisés avec Apple Music, avec une interface web simple pour les composer — y compris depuis ton téléphone.

Pas de cloud, pas de compte, pas d'API constructeur : tout passe en local, en Matter standard (et, si tu veux, WiZ, Home Assistant ou Zigbee2MQTT).

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

---

## 1. Installation (une seule fois)

1. **Node.js** : installe la version **LTS** depuis <https://nodejs.org> (22.13 ou plus récente).
2. **Télécharge le projet** : bouton vert **Code › Download ZIP** sur cette page (puis dézippe), ou avec Git :
   ```bash
   git clone https://github.com/badi-project/matter-light-show.git
   ```
   Range le dossier dans un endroit **qui n'est pas synchronisé avec le cloud**, par exemple ton dossier Applications personnel (`~/Applications`).
   - Évite le Bureau et Documents s'ils sont synchronisés avec iCloud ou OneDrive : quand le disque se remplit, macOS retire les fichiers du Mac pour les garder seulement dans le cloud. Le logiciel ne peut alors plus démarrer, et l'appairage du pont peut être perdu.
3. **Une seule fois**, ouvre le Terminal dans le dossier et rends l'app et le lanceur exécutables (GitHub ne garde pas ces droits) :
   ```bash
   chmod +x "Lancer le show.command" "Show lumière.app/Contents/MacOS/show-lumiere"
   ```
4. **Double-clique** sur l'app **`Show lumière`** (dans le dossier ; tu peux la glisser dans le Dock).
   - Elle installe le logiciel **en arrière-plan** : il démarre avec le Mac, sans fenêtre Terminal, se relance tout seul en cas de souci, et la page <http://localhost:8321> s'ouvre.
   - La première fois, macOS peut refuser d'ouvrir l'app (« Apple ne peut pas vérifier… ») : elle n'est pas signée. Va alors dans **Réglages Système › Confidentialité et sécurité**, descends en bas et clique **« Ouvrir quand même »**.
   - `Lancer le show.command` marche toujours (dans une fenêtre Terminal) ; s'il trouve le logiciel en arrière-plan, il ouvre simplement la page.
5. macOS demande d'autoriser **« node » à accéder aux appareils du réseau local** (et, pour la musique, à **contrôler « Musique »**) : clique **Autoriser** / **OK**. Sans cela, Matter ne trouve pas le pont.
   Pour vérifier plus tard : Réglages Système › Confidentialité et sécurité › Réseau local (et Automatisation).

> Avec le Terminal, l'équivalent est : `cd` vers le dossier, puis `npm install` et `npm start`. Le fonctionnement en arrière-plan s'active ensuite dans **Réglages › Marche et arrêt**.
>
> **Mise à jour** : remplace les fichiers par la nouvelle version (ou `git pull`) en gardant ton dossier `data/`, puis clique **↻** en haut de la page.

## 2. Appairer le pont Hue (une seule fois)

Onglet **Lampes › Ajouter un appareil Matter** :

1. Sur l'iPhone, dans l'app **Maison**, ouvre les réglages du **pont Hue** (ou d'une de ses lampes) et touche **« Activer le mode de jumelage »** (*Turn On Pairing Mode*). Copie ensuite le code à 11 chiffres.
2. Si ce bouton n'apparaît pas, c'est que ton pont a été ajouté à Maison via HomeKit et non via Matter. Dans ce cas, génère le code dans l'app **Hue › Réglages › Smart Home / Matter**. C'est la seule étape qui passe par Philips.
3. Colle le code dans l'interface et clique **Appairer**, dans les 15 minutes qui suivent sa création.

Toutes les lampes du pont apparaissent. Elles restent aussi dans l'app Maison et avec Siri, car Matter permet plusieurs contrôleurs en même temps (c'est le « multi-admin »).

Dans l'onglet **Lampes**, tu peux ensuite :
- **renommer** les lampes ;
- les **réordonner** : l'ordre sert aux palettes ;
- les **exclure** d'un show ;
- les **faire clignoter** pour savoir laquelle est laquelle.

## 3. Créer un show

Un show est une **suite d'étapes**. Chaque étape a :

| Réglage | Rôle |
|---|---|
| **Durée** | temps passé sur l'étape avant la suivante |
| **Fondu** | durée de la transition progressive vers les nouvelles couleurs (0 = changement net) |
| **Mode** | voir ci-dessous |

Trois modes :
- **Toutes pareilles** : une couleur et une luminosité pour toutes les lampes.
- **Palette répartie** : une liste de couleurs distribuée dans l'ordre des lampes. Le **décalage** fait « tourner » les couleurs d'une lampe à l'autre. Le bouton **Étape suivante décalée →** crée l'étape suivante en un clic, ce qui donne des effets de mouvement. La couleur « Éteinte » crée des trous, pratique pour un chenillard.
- **Lampe par lampe** : chaque lampe a son réglage, ou reste **inchangée**.

Autres commandes utiles :
- 👁 **Tester** applique une seule étape sur les vraies lampes.
- ▶ sur une étape lance le show à partir de cette étape.
- **Boucle** et **Vitesse** (de 0,5× à 3×) se règlent pour tout le show.
- La **barre d'espace** lance ou arrête le show.
- Tout est enregistré automatiquement dans le dossier `shows/`. Les modifications faites pendant la lecture sont prises en compte dès l'étape suivante.
- **Exporter** et **Importer** servent à partager un show sous forme de fichier `.json`.

Quatre shows sont fournis : **Soirée ambiance**, **Chenillard rouge & bleu**, **Halloween — Nuit des monstres** et **Noël enchanté** (ces deux derniers sont musicaux).

**Pour composer loin de chez toi**, active le **mode démo** (dans Réglages) : 6 lampes virtuelles apparaissent dans l'aperçu.

## 4. Lumières synchronisées avec Apple Music

Tout se passe dans l'onglet **Musique**. La musique reste dans Apple Music : joue-la avec l'app **Musique du Mac** (ou avec les boutons de l'onglet) et choisis tes HomePod ou enceintes dans **Sorties AirPlay**. Un curseur sous chaque enceinte cochée règle son volume, et **Volume général** celui de l'app Musique.

1. Active **Synchroniser les lumières avec la musique**.
2. Choisis d'où viennent les couleurs :
   - **Quatre modes automatiques** :
     - **Auto complet** (par défaut) : les couleurs principales de la **pochette** (les visages, le gris et le noir sont ignorés), complétées par des couleurs d'**ambiance** choisies selon le genre, le style et le tempo. Un morceau calme a moins de couleurs, plus douces et plus chaudes ; un morceau énergique en a plus, saturées, avec une couleur d'« impact ».
     - **Auto sobre** : les couleurs de la pochette et seulement 2 couleurs d'ambiance.
     - **Auto pochette** : uniquement les couleurs de la pochette (lumières blanches si elle est en noir et blanc).
     - **Auto nuances** : uniquement les couleurs de la pochette, déclinées en nuances (vif, clair, pastel, foncé, profond, teintes voisines). Le genre choisit la saveur : vives et teintes voisines pour la K-pop ou l'électro, profondes pour le jazz ou le R&B, douces et pastel pour l'indé ou le folk, contrastées pour le rock. Les nuances foncées sont jouées moins lumineuses.
     - **Genre** : lu dans l'app Musique, chez Apple et chez Deezer (ou deviné à l'écoute s'il manque). Il choisit aussi le **motif des accents** : chaque temps pour la dance et la K-pop, temps 2 et 4 pour le rock et le R&B, « one drop » pour le reggae, respiration lente pour le classique ou l'ambient…
     - **Style** (calme, groove, énergique) : selon le tempo, le genre et l'**énergie** mesurée sur l'extrait de 30 s (volume, attaques, brillance, netteté de la pulsation).
     - En mode complet ou sobre, une playlist nommée « Noël » ou « Halloween » lance les shows dédiés.
   - **Mes couleurs** : choisis jusqu'à 6 couleurs (pastels compris). Le logiciel les range pour qu'elles s'enchaînent joliment : en dégradé autour du cercle des couleurs (une couleur vive à côté de sa version pâle, les blancs là où le dégradé saute), ou en contraste pour un morceau énergique. **Diffuser maintenant** les pose tout de suite sur les lampes, sans musique (ambiance fixe).
   - **Un show** de ta liste : ses couleurs sont gardées, et c'est la musique qui donne le rythme.
   - **Cohérence par pièce** (onglet Musique, sous les couleurs) : au lieu de mélanger les lampes de toute la maison,
     - **Une ambiance par pièce** : une couleur dominante par pièce, avec des nuances proches entre ses lampes, qui change doucement ;
     - **Vagues de pièce en pièce** : à chaque changement, la couleur part de la 1ʳᵉ pièce et avance dans l'ordre des pièces (ex. Salon → Cuisine → Chambre) ;
     - **Une pièce entière d'un coup** : toutes les lampes d'une pièce changent ensemble, les pièces se répondent sur le rythme (c'est aussi ce qui passe le mieux avec la limite du pont) ;
     - **Seulement les pièces où la musique passe** : le show ne joue que dans les pièces dont l'enceinte AirPlay est cochée ; les autres restent en blanc doux, s'éteignent ou ne bougent pas (au choix).
   - **Les pièces** se règlent dans l'onglet **Lampes** (carte Pièces). Le pont Hue ne transmet pas ses pièces en Matter : clique **Proposer d'après les noms** (chevet → Chambre, Jardin 1/2/3 → Jardin, Cuisine 1/2 → Cuisine…), corrige la pièce de chaque lampe dans la liste, mets les pièces dans l'ordre des vagues avec les flèches et relie chaque pièce à ses enceintes. Si un jour le pont annonce ses pièces en Matter, elles sont utilisées automatiquement.
3. **Le rythme** : à chaque temps de la musique, un groupe de lampes change. Les nouvelles couleurs se propagent en vague dans la pièce. Entre deux changements, les lampes battent la mesure en variant leur luminosité, plus fort sur le premier temps de chaque mesure. Le réglage **Intensité du rythme** passe de « douce » à « forte », ou à « aucune » pour garder seulement les couleurs.
4. **Le calage sur les temps** se fait en deux temps :
   - le tempo du morceau est trouvé automatiquement, en mesurant l'extrait de 30 s fourni par Apple (ou à partir de bases publiques) ;
   - le micro du Mac trouve où tombent les temps. Active **Caler les lumières sur les temps grâce au micro** et laisse la page ouverte : après quelques secondes de musique, le statut indique « ✓ Calé ». Le micro ne fait qu'écouter : rien n'est enregistré ni envoyé.
   - Sans micro, tu peux **Taper le tempo** (dans Réglages fins).
5. **Enregistrer ces couleurs comme show** crée un show modifiable à partir des couleurs automatiques d'un morceau.

Avec beaucoup de lampes, le pont Hue limite le nombre de lampes qui changent à chaque temps (environ 10 commandes par seconde). Le statut indique combien de lampes changent par temps. Si tes lampes suivent bien, monte le **Débit max** à 15 ou 20 dans Réglages.

La première fois, macOS demande si le **Terminal peut contrôler « Musique »** : clique **OK**. Safari demande aussi l'accès au **micro** : clique **Autoriser**.

## 5. Bon à savoir

- **Débit.** Le pont Hue retransmet chaque commande en Zigbee et encaisse environ 10 commandes par seconde. Le logiciel les étale automatiquement. Il faut jusqu'à 2 commandes par lampe et par étape (couleur + luminosité). Si une étape est trop courte pour le nombre de lampes, un ⚠ s'affiche. Le réglage se trouve dans **Réglages › Débit max**.
- **Lampes blanches.** Une lampe blanche (White ambiance) n'applique que les blancs et la luminosité. Une ampoule simple n'applique que la luminosité.
- **Pas accessible via Matter** : effets de dégradé des rubans *gradient*, synchro Hue Entertainment, scènes Hue.
- **Arrêter / Démarrer** (en haut de la page) : « Arrêter » coupe le show et la synchro, et **toutes les lampes prennent la même couleur** (réglable dans Réglages › Marche et arrêt, ou « éteintes »). « Démarrer » reprend là où tu en étais. **↻** redémarre le logiciel. Dans Réglages, **Quitter complètement** le ferme : la page affiche alors un bouton **▶ Démarrer le show** qui rouvre l'app *Show lumière* et relance tout (le navigateur demande la première fois s'il peut ouvrir l'app : accepte).
- **Le Mac doit rester allumé** pendant le show : le logiciel l'empêche de se mettre en veille tant qu'un show ou la synchro tourne, plus quand il est arrêté.
- **Autres systèmes** (onglet Lampes) :
  - tout ce qui a un **code Matter** s'appaire comme le pont Hue : pont IKEA DIRIGERA, hubs Aqara, SmartThings, appareils Smart Life / Tuya compatibles Matter, ampoules Nanoleaf, Eve, Govee, WiZ, Meross… Un appareil Matter déjà dans l'app Maison se partage avec « Activer le mode de jumelage ». Le menu « Ton matériel » donne la marche à suivre ;
  - **lampes Zigbee** de toute marque (IKEA, Innr, Lidl, Ledvance…) : le plus simple est de les ajouter au pont Hue avec l'app Hue, elles arrivent ici par le pont ;
  - **WiZ** (Wi-Fi) : pilotées directement, trouvées toutes seules ;
  - **Home Assistant** : toutes ses lampes (Zigbee, Smart Life / Tuya, Z-Wave…) et ses pièces, avec l'adresse et un jeton d'accès longue durée ;
  - **Zigbee2MQTT** : lampes sur une clé USB Zigbee, via le broker MQTT ; ses groupes servent de pièces ;
  - **Smart Life / Tuya sans Matter** : passer par Home Assistant (la commande directe demande des clés propres à chaque appareil et le cloud Tuya limite le nombre de commandes).
  Chaque système a son propre débit : une ampoule WiZ ou Home Assistant n'attend pas le pont Hue.
- **Piloter depuis l'iPhone** (Mac allumé, même Wi-Fi) : sur le Mac, **Réglages › 📱 Téléphone** › active « Contrôler le show depuis mon téléphone ». Un QR code s'affiche : vise-le avec l'**appareil photo** de l'iPhone, touche le lien, puis dans Safari **Partager › « Sur l'écran d'accueil »** pour avoir l'icône Show lumière comme une app. Tout se pilote depuis le téléphone (shows, synchro, musique, volume, lampes, Arrêter/Démarrer).
  - Sans QR code : tape l'adresse affichée (`http://<nom-du-mac>.local:8321`) puis le **code à 6 chiffres**.
  - Personne d'autre ne peut se connecter sans le QR code ou le code ; **« Changer la clé »** déconnecte tous les téléphones (à rescanner).
  - Le Mac reste éveillé tant que l'option est active (réglable) ; s'il est fermé (écran rabattu) ou éteint, le téléphone ne peut pas le joindre.
  - Si le Mac demande d'autoriser **« node » à accepter les connexions entrantes**, clique **Autoriser**.
- **Infos des morceaux** : pour trouver la pochette, l'extrait de 30 s, le genre et le tempo, le logiciel envoie le **titre et l'artiste** du morceau aux API publiques **iTunes Search** et **Deezer** (sans compte ni clé). Les analyses (couleurs, tempo, énergie) sont faites dans ton navigateur et les résultats restent en cache sur ton Mac pendant 30 jours.
- **Variables d'environnement** (pour les curieux) : `PORT` (8321 par défaut), `HOST` (adresse d'écoute imposée), `MATTER_DEBUG=1` (journaux détaillés de matter.js), `MUSIC_SIM=1` (lecteur de musique simulé, pour développer sans Mac).

## 6. Dépannage

| Problème | Piste |
|---|---|
| « Appairage échoué » | Le code a peut-être expiré : régénère-le. Vérifie aussi que le Mac est sur le même Wi-Fi que le pont (pas sur un réseau invité ni sous VPN) et que l'autorisation *Réseau local* est accordée. |
| Le pont est « recherche sur le réseau… » | Il est éteint, ou le Mac a changé de réseau. La reconnexion se fait toute seule. |
| Les lampes réagissent en retard | Allonge les étapes, réduis le nombre de lampes par étape, ou baisse le débit s'il est au-dessus de 10. |
| Les lumières ne suivent pas la musique | La musique doit être jouée par l'app Musique **du Mac**. Vérifie aussi l'autorisation *Automatisation › Terminal › Musique*. |
| Les changements sont décalés par rapport au rythme | Active le **micro** (ou **Taper le tempo**), puis ajuste **Avance des lumières** dans Réglages fins. |
| La page ne s'ouvre plus | Ouvre l'app **Show lumière** : elle relance le logiciel. Le journal du service est dans `data/serveur.log`. |
| La musique n'est plus suivie, ou le pont est « injoignable » depuis le passage en arrière-plan | En arrière-plan c'est **« node »** (et non plus Terminal) qui pilote : Réglages Système › Confidentialité et sécurité › **Réseau local** › active « node », et **Automatisation** › node › coche « Musique ». Puis ↻. |
| Le téléphone n'arrive pas à ouvrir la page | Même Wi-Fi que le Mac ? Mac réveillé ? Dans Réglages › Téléphone, essaie le lien « avec l'adresse IP du Mac ». Pare-feu du Mac : Réglages Système › Réseau › Coupe-feu › autorise « node ». |
| L'app Show lumière ne fait rien | Elle est bloquée par macOS la première fois : Réglages Système › Confidentialité et sécurité › **Ouvrir quand même**. Ce que fait l'app est noté dans `data/app.log`. |
| Ne plus lancer au démarrage du Mac | Réglages › Marche et arrêt › **Ne plus démarrer avec le Mac**. |
| Retirer proprement | Onglet Lampes › **Retirer** : ce contrôleur se désinscrit du pont, qui reste dans l'app Maison. Tu peux ensuite supprimer le dossier. |

## Tes données restent chez toi

Tout ce qui est personnel est écrit dans le dossier `data/`, **exclu de Git** (`.gitignore`) :

| Chemin | Contenu |
|---|---|
| `data/matter/` | identité du contrôleur Matter et appairages — **ne le partage jamais** |
| `data/systemes.json` | réglages des autres systèmes, dont le **jeton Home Assistant** et le mot de passe MQTT — **ne le partage jamais** |
| `data/acces.json` | clé et code du contrôle depuis le téléphone — **ne le partage jamais** |
| `data/lampes.json` | noms, ordre et lampes masquées |
| `data/pieces.json` | tes pièces, leurs lampes et leurs enceintes |
| `data/reglages.json` | réglages (dont « Mes couleurs ») |
| `data/tempos.json` | tempos calés |
| `data/morceaux/` | pochettes, extraits et analyses en cache des morceaux joués |
| `data/*.log` | journaux du service et de l'app |

Les shows que tu crées sont enregistrés dans `shows/` (exclus de Git aussi, sauf les 4 shows fournis). Pour en partager un, utilise **Exporter**.

## Fichiers du projet

- `Show lumière.app` : la petite app de démarrage (un script, sans signature).
- `server.mjs`, `lib/` : le contrôleur Matter (bibliothèque open source [matter.js](https://github.com/matter-js/matter.js)), les pilotes WiZ / Home Assistant / Zigbee2MQTT, le moteur de show, les pièces, les palettes, la synchro musique, le service macOS et l'accès depuis le téléphone.
- `public/` : l'interface, les analyses faites dans le navigateur (couleurs de la pochette, tempo, énergie) et les icônes.
- `shows/` : les shows fournis (JSON lisible, modifiable à la main ; format décrit dans le [README anglais](README.md#show-file-format)).

## Licence

[MIT](LICENSE). Le générateur de QR code (`lib/vendor/qrcode.mjs`) est la bibliothèque *QR Code Generator* de Kazuhiko Arase, sous licence MIT. Projet indépendant, sans lien avec Philips Hue / Signify, Apple, IKEA, WiZ, Home Assistant ou la Connectivity Standards Alliance.
