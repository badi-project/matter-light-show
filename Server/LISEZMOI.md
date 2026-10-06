# Show lumière Matter

Un petit logiciel qui transforme ton Mac en **contrôleur Matter** et joue des shows de lumière sur tes lampes, avec une interface web simple pour les composer.

```
 Mac (ce logiciel)  ──Matter / Wi-Fi──▶  Pont Hue  ──Zigbee──▶  lampes Hue
        ▲                                   ▲
   navigateur                        l'app Maison reste connectée en parallèle
```

**Ce qui passe par Philips, et ce qui n'y passe pas.** Tes ampoules Hue parlent Zigbee : le pont Hue reste donc nécessaire, car c'est lui qui les expose sur le réseau en Matter. En revanche, le logiciel n'utilise ni l'API Hue, ni le cloud Philips, ni l'app Hue pour piloter les lampes. Il envoie uniquement des commandes Matter standard (allumer, luminosité, couleur, identifier). Il marcherait de la même façon avec n'importe quelle lampe Matter d'une autre marque.

---

## 1. Installation (une seule fois)

**Avec l'app Mac (le plus simple, rien à installer à côté)**

1. Télécharge le fichier `Show-lumiere-x.y.z.zip` dans la page **Releases** du dépôt, ouvre-le et glisse **Show lumière** dans **Applications**.
2. Ouvre l'app. La première fois, macOS peut refuser (« Apple ne peut pas vérifier… »). Va dans **Réglages Système › Confidentialité et sécurité**, descends en bas et clique **« Ouvrir quand même »**.
3. macOS demande d'autoriser **« Show lumière »** à accéder aux appareils du **réseau local**, à **contrôler « Musique »** et au **Bluetooth** : clique **Autoriser** / **OK**. Sans cela, Matter ne trouve pas le pont.
   Pour vérifier plus tard : Réglages Système › Confidentialité et sécurité › Réseau local (et Automatisation).
4. Une ampoule apparaît dans la barre des menus. Pour que le show démarre avec le Mac : ampoule › **Ouvrir au démarrage du Mac**.

Node.js est déjà dans l'app : il n'y a rien d'autre à installer. Tes données sont rangées dans `~/Library/Application Support/Show lumière/` (jamais dans l'app).

**Depuis le code (Terminal)**

1. Installe **Node.js** (version LTS, 22.13 ou plus récente) depuis <https://nodejs.org>.
2. Dans le dossier `Server` : `npm ci --omit=dev`, puis `node server.mjs`, et ouvre <http://localhost:8321>.
3. macOS demande les mêmes autorisations, au nom de « node » ou de ton Terminal. Tes données sont alors dans `Server/data/` : ne les partage jamais.

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

## 4. Lumières synchronisées avec la musique (Apple Music, Spotify, Deezer…)

Tout se passe dans l'onglet **Musique**. La musique reste dans ton app habituelle ; **Source** choisit ce que le show suit :

- **Automatique** (par défaut) : l'app qui joue en ce moment ;
- **Apple Music** : avec en plus les playlists (les enceintes AirPlay se choisissent dans la carte **🔊 Sorties audio**) ;
- **Spotify (app du Mac)** : lecture, pause, morceau suivant et pochette exacte (macOS demande une fois d'autoriser « node » à contrôler Spotify) ;
- **Autres apps du Mac** : **Deezer**, Tidal, Qobuz, YouTube Music ou Deezer dans le navigateur… tout ce que macOS affiche dans « En cours de lecture » (macOS 15.4 ou plus récent). Si l'app ne donne pas la position dans le morceau, elle est estimée : active le **micro** pour caler les temps ;
- **Spotify sur tous mes appareils** : suit Spotify même quand il joue sur l'iPhone, la TV ou une enceinte Spotify Connect. Il faut un compte **Spotify Premium** et créer une « app » gratuite sur developer.spotify.com (la marche à suivre est dans la carte Musique, « Spotify sur l'iPhone… »), une seule fois, sur le Mac ;
- **Enceintes Sonos** : suit ce que jouent tes Sonos (app Sonos, radio, Spotify ou AirPlay vers Sonos), trouvées toutes seules sur le Wi-Fi, sans compte.

**🔊 Sorties audio** (onglet Musique, aussi depuis le téléphone) : toutes les enceintes au même endroit.

- **Sortie du Mac** : haut-parleurs du Mac, **enceintes et casques Bluetooth**, USB, **TV / écran en HDMI**, sorties multiples… Choisis où le Mac joue (Spotify, Deezer, YouTube… et Apple Music quand l'ordinateur est coché en AirPlay) et règle le volume ;
- **Bluetooth** : tes enceintes et casques jumelés, avec **Connecter / Déconnecter**. Une fois connectée, l'enceinte apparaît dans « Sortie du Mac ». Un appareil jamais jumelé se jumelle une fois dans Réglages Système › Bluetooth. Si le bouton **Autoriser** s'affiche, clique-le puis accepte la demande de macOS « Show lumière Bluetooth souhaite utiliser le Bluetooth » (une seule fois) ;
- **AirPlay · Apple Music** : HomePod, Apple TV, TV et enceintes AirPlay, plusieurs à la fois, avec un volume par enceinte et le volume général de l'app Musique (l'app Musique doit être ouverte) ;
- **Spotify Connect** (compte Spotify connecté) : fais passer Spotify sur l'iPhone, une enceinte, la TV, la console… et règle son volume ;
- **Sonos** : le volume de chaque enceinte, et ses groupes.

Avec **Seulement les pièces où la musique passe**, la pièce suit l'enceinte qui joue vraiment : enceinte AirPlay cochée, sortie du Mac (Bluetooth, TV…), appareil Spotify ou groupe Sonos. Relie chaque pièce à ses enceintes dans la carte Pièces.

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
     - **Seulement les pièces où la musique passe** : le show ne joue que dans les pièces dont l'enceinte joue (AirPlay cochée, sortie du Mac, appareil Spotify, groupe Sonos) ; les autres restent en blanc doux, s'éteignent ou ne bougent pas (au choix).
   - **Les pièces** se règlent dans l'onglet **Lampes** (carte Pièces). Le pont Hue ne transmet pas ses pièces en Matter : clique **Proposer d'après les noms** (chevet → Chambre, Jardin 1/2/3 → Jardin, Parent 1/2/3 → Chambre parents…), corrige la pièce de chaque lampe dans la liste, mets les pièces dans l'ordre des vagues avec les flèches et relie chaque pièce à ses enceintes. Si un jour le pont annonce ses pièces en Matter, elles sont utilisées automatiquement.
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
- **Léger pour le Mac.** Un petit programme de veille signale tout de suite lecture, pause et morceau suivant (Musique, Spotify, Deezer, navigateur…) : le logiciel ne relit la musique que lorsqu'elle change, et presque rien ne tourne quand rien ne joue. La page aussi ne travaille que lorsqu'elle est affichée.
- **Version du logiciel** : affichée dans **Réglages** (sous le mode démo), avec sa date, celle de Node.js et de matter.js. Pratique pour vérifier qu'une mise à jour est bien en service (elle est aussi notée dans le journal à chaque démarrage). Après une mise à jour, les pages déjà ouvertes (Mac, téléphone) se rechargent d'elles-mêmes.
- **Le Mac doit rester allumé** pendant le show : le logiciel l'empêche de se mettre en veille tant qu'un show ou la synchro tourne, plus quand il est arrêté.
- **Autres systèmes** (onglet Lampes) :
  - tout ce qui a un **code Matter** s'appaire comme le pont Hue : pont IKEA DIRIGERA, hubs Aqara, SmartThings, appareils Smart Life / Tuya compatibles Matter, ampoules Nanoleaf, Eve, Govee, WiZ, Meross… Un appareil Matter déjà dans l'app Maison se partage avec « Activer le mode de jumelage ». Le menu « Ton matériel » donne la marche à suivre ;
  - **lampes Zigbee** de toute marque (IKEA, Innr, Lidl, Ledvance…) : le plus simple est de les ajouter au pont Hue avec l'app Hue, elles arrivent ici par le pont ;
  - **WiZ** (Wi-Fi) : pilotées directement, trouvées toutes seules ;
  - **Home Assistant** : toutes ses lampes (Zigbee, Smart Life / Tuya, Z-Wave…) et ses pièces, avec l'adresse et un jeton d'accès longue durée ;
  - **Zigbee2MQTT** : lampes sur une clé USB Zigbee, via le broker MQTT ; ses groupes servent de pièces ;
  - **Smart Life / Tuya sans Matter** : passer par Home Assistant (la commande directe demande des clés propres à chaque appareil et le cloud Tuya limite le nombre de commandes).
  Chaque système a son propre débit : une ampoule WiZ ou Home Assistant n'attend pas le pont Hue.
- **Plusieurs Wi-Fi** (maison, bureau, chez tes parents…) : chaque appareil est rattaché au réseau où tu l'as ajouté. Quand le Mac change de réseau, seuls les accessoires de ce réseau apparaissent et sont pilotés ; les autres attendent, en pause (sans message d'erreur). Carte **📶 Réseau** de l'onglet Lampes : renommer le réseau, voir les autres réseaux, « C'est le même que… » après un changement de box. Dans **Appareils appairés** (et pour WiZ, Home Assistant, Zigbee2MQTT), choisis le réseau d'un appareil ou « Tous les réseaux ». Un réseau est reconnu par sa box : deux Wi-Fi de la même box (2,4 / 5 GHz, répéteur) comptent comme un seul réseau. Si macOS masque le nom du Wi-Fi, donne-lui un nom toi-même.
- **Piloter depuis l'iPhone** (Mac allumé, même Wi-Fi) : sur le Mac, **Réglages › 📱 Téléphone** › active « Contrôler le show depuis mon téléphone ». Un QR code s'affiche : vise-le avec l'**appareil photo** de l'iPhone, touche le lien, puis dans Safari **Partager › « Sur l'écran d'accueil »** pour avoir l'icône Show lumière comme une app. Tout se pilote depuis le téléphone (shows, synchro, musique, volume, lampes, Arrêter/Démarrer).
  - Sans QR code : tape l'adresse affichée (`http://<nom-du-mac>.local:8321`) puis le **code à 6 chiffres**.
  - Personne d'autre ne peut se connecter sans le QR code ou le code ; **« Changer la clé »** déconnecte tous les téléphones (à rescanner).
  - Le Mac reste éveillé tant que l'option est active (réglable) ; s'il est fermé (écran rabattu) ou éteint, le téléphone ne peut pas le joindre.
  - Si le Mac demande d'autoriser **« node » à accepter les connexions entrantes**, clique **Autoriser**.

## 6. Dépannage

| Problème | Piste |
|---|---|
| « Appairage échoué » | Le code a peut-être expiré : régénère-le. Vérifie aussi que le Mac est sur le même Wi-Fi que le pont (pas sur un réseau invité ni sous VPN) et que l'autorisation *Réseau local* est accordée. |
| Le pont est « recherche sur le réseau… » | Il est éteint, ou le Mac a changé de réseau. La reconnexion se fait toute seule. |
| Une lampe « ne répond plus » | Le journal le signale, la lampe passe en « injoignable » et le logiciel retente la connexion toutes les 30 s ; le reste du show continue. Vérifie qu'elle est alimentée ; pour une ampoule **Thread** (IKEA KAJPLATS, Eve, Nanoleaf…), que le HomePod / l'Apple TV qui sert de routeur Thread est allumé. Une ampoule Matter seule reçoit au plus 3 commandes par seconde pour ne pas saturer le réseau Thread. |
| « already commissioned » / « déjà appairée » en réappairant | Arrive quand une lampe a été retirée pendant qu'elle était injoignable : elle garde l'ancien appairage. Le logiciel l'efface maintenant tout seul au réappairage. Si la lampe refuse, réinitialise-la aux réglages d'usine (voir sa notice), puis réappaire-la. Une lampe réappairée retrouve son nom et sa pièce. |
| Les lampes réagissent en retard | Allonge les étapes, réduis le nombre de lampes par étape, ou baisse le débit s'il est au-dessus de 10. |
| Les lumières ne suivent pas la musique | La musique doit être jouée **sur le Mac** (Apple Music, Spotify, Deezer…) ou, avec le compte Spotify connecté, sur un appareil Spotify. Regarde la ligne « Suivi : … » de l'onglet Musique, ou force la **Source**. Autorisations : *Automatisation › node (ou Terminal) › Musique / Spotify*. |
| Une enceinte Bluetooth ne se connecte pas | Allume-la et rapproche-la ; si elle est déjà connectée à un téléphone, déconnecte-la de celui-ci. Bouton **Autoriser** affiché : clique-le et accepte la demande de macOS (ou Réglages Système › Confidentialité et sécurité › **Bluetooth** › active « Show lumière Bluetooth »). Sinon, connecte-la depuis le Centre de contrôle : elle apparaît dans « Sortie du Mac ». |
| Une sortie (TV, enceinte) n'apparaît pas | Elle doit être allumée et reliée au Mac (HDMI, Bluetooth connecté…). **Actualiser** dans la carte Sorties audio. Les HomePod et enceintes AirPlay sont dans la partie AirPlay (app Musique ouverte). Les Sonos doivent être sur le même Wi-Fi que le Mac. |
| Des accessoires ont disparu | Le Mac a peut-être changé de Wi-Fi : ils sont rattachés à un autre réseau (carte 📶 Réseau). Si c'est le même réseau avec une nouvelle box : « C'est le même que… ». |
| Les changements sont décalés par rapport au rythme | Active le **micro** (ou **Taper le tempo**), puis ajuste **Avance des lumières** dans Réglages fins. |
| La page ne s'ouvre plus | Ouvre l'app **Show lumière** (ampoule de la barre des menus › **Ouvrir la fenêtre**) : elle relance le logiciel. Le journal est dans `~/Library/Logs/Show lumière/serveur.log` (ampoule › **Voir le journal**). |
| La musique n'est plus suivie, ou le pont est « injoignable » | Réglages Système › Confidentialité et sécurité › **Réseau local** › active **« Show lumière »**, et **Automatisation** › Show lumière › coche « Musique ». Puis ↻. (Lancé depuis le Terminal, c'est « node » ou ton Terminal qu'il faut autoriser.) |
| Le téléphone n'arrive pas à ouvrir la page | Même Wi-Fi que le Mac ? Mac réveillé ? Dans Réglages › Téléphone, essaie le lien « avec l'adresse IP du Mac ». Pare-feu du Mac : Réglages Système › Réseau › Coupe-feu › autorise « node ». |
| L'app Show lumière ne s'ouvre pas | Elle est bloquée par macOS la première fois : Réglages Système › Confidentialité et sécurité › **Ouvrir quand même**. Ce que fait l'app est noté dans `~/Library/Logs/Show lumière/app.log`. |
| Ne plus lancer au démarrage du Mac | Ampoule de la barre des menus › décoche **Ouvrir au démarrage du Mac**. |
| Retirer proprement | Onglet Lampes › **Retirer** : ce contrôleur se désinscrit de l'appareil, qui reste dans l'app Maison. Si l'appareil ne répond pas, il est retiré quand même du show (nettoyage local). Tu peux ensuite supprimer le dossier. |

## Fichiers

- `shows/` : tes shows (JSON lisible, modifiable à la main).
- `data/` : l'appairage Matter (identifiants du contrôleur), tes réglages et les tempos calés. **Ne le partage pas.**
- `server.mjs` : le démarrage ; `lib/app/` : le logiciel (lampes, musique, marche/arrêt, serveur web) ; `lib/routes/` : l'API, par thème ; `lib/` : le contrôleur Matter (bibliothèque open source [matter.js](https://github.com/matter-js/matter.js)), le moteur de show, la synchro, les sources de musique et les autres systèmes.
- `public/` : l'interface (`index.html`, `app.css`, `js/`).
