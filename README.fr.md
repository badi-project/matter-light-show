# Show lumière Matter 💡🎶

Un petit logiciel qui transforme ton Mac en **contrôleur Matter** et joue des shows de lumière sur tes lampes, synchronisés avec Apple Music, avec une interface web simple pour les composer.

Pas de cloud, pas de compte, pas d'API constructeur : tout passe en local, en Matter standard.

🇬🇧 [Read in English](README.md)

![Éditeur de shows](docs/screenshot-shows.png)

![Synchro musique](docs/screenshot-music.png)

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
3. **Double-clique** sur `Lancer le show.command`.
   - La première fois, macOS peut refuser d'ouvrir le fichier (« Apple ne peut pas vérifier… »). Va alors dans **Réglages Système › Confidentialité et sécurité**, descends en bas et clique **« Ouvrir quand même »**.
   - Si macOS répond que le fichier ne peut pas être exécuté (« droits d'accès »), ouvre le Terminal dans le dossier et lance une fois : `chmod +x "Lancer le show.command"`.
   - L'installation prend environ une minute, puis le navigateur s'ouvre sur <http://localhost:8321>.
4. Si macOS demande d'autoriser **Terminal à accéder aux appareils du réseau local**, clique **Autoriser**. Sans cette autorisation, Matter ne peut pas trouver le pont.
   Pour vérifier plus tard : Réglages Système › Confidentialité et sécurité › Réseau local › Terminal.

> Avec le Terminal, l'équivalent est : `cd` vers le dossier, puis `npm install` et `npm start`.

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

Tout se passe dans l'onglet **Musique**. La musique reste dans Apple Music : joue-la avec l'app **Musique du Mac** (ou avec les boutons de l'onglet) et choisis tes HomePod ou enceintes dans **Sorties AirPlay**.

1. Active **Synchroniser les lumières avec la musique**.
2. Choisis d'où viennent les couleurs :
   - **Automatique**, le réglage par défaut : les couleurs sont tirées de la **pochette** du morceau, ou de son genre si la pochette n'est pas disponible. Le style suit la musique : doux pour un morceau calme, plus vif pour un morceau rapide. Une playlist nommée « Noël » ou « Halloween » lance les shows dédiés.
   - **Un show** de ta liste : ses couleurs sont gardées, et c'est la musique qui donne le rythme.
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
- **Le Mac doit rester allumé** pendant le show. Le lanceur empêche la mise en veille tant que la fenêtre Terminal est ouverte. Ferme cette fenêtre pour tout arrêter.
- **Piloter depuis l'iPhone** : lance le logiciel avec `HOST=0.0.0.0 npm start`, puis ouvre `http://<nom-du-mac>.local:8321` sur l'iPhone. Il n'y a pas de mot de passe, donc à réserver à ton réseau personnel.
- **Infos des morceaux** : pour trouver la pochette, l'extrait de 30 s et le tempo, le logiciel envoie le **titre et l'artiste** du morceau aux API publiques **iTunes Search** et **Deezer** (sans compte ni clé). Les résultats restent en cache sur ton Mac pendant 30 jours.
- **Autres réglages** par variables d'environnement : `PORT` (8321 par défaut), `MATTER_DEBUG=1` (journaux détaillés de matter.js), `MUSIC_SIM=1` (lecteur de musique simulé, pour développer sans Mac).

## 6. Dépannage

| Problème | Piste |
|---|---|
| « Appairage échoué » | Le code a peut-être expiré : régénère-le. Vérifie aussi que le Mac est sur le même Wi-Fi que le pont (pas sur un réseau invité ni sous VPN) et que l'autorisation *Réseau local* est accordée. |
| Le pont est « recherche sur le réseau… » | Il est éteint, ou le Mac a changé de réseau. La reconnexion se fait toute seule. |
| Les lampes réagissent en retard | Allonge les étapes, réduis le nombre de lampes par étape, ou baisse le débit s'il est au-dessus de 10. |
| Les lumières ne suivent pas la musique | La musique doit être jouée par l'app Musique **du Mac**. Vérifie aussi l'autorisation *Automatisation › Terminal › Musique*. |
| Les changements sont décalés par rapport au rythme | Active le **micro** (ou **Taper le tempo**), puis ajuste **Avance des lumières** dans Réglages fins. |
| Retirer proprement | Onglet Lampes › **Retirer** : ce contrôleur se désinscrit du pont, qui reste dans l'app Maison. Tu peux ensuite supprimer le dossier. |

## Tes données restent chez toi

Tout ce qui est personnel est écrit dans le dossier `data/`, **exclu de Git** (`.gitignore`) :

| Chemin | Contenu |
|---|---|
| `data/matter/` | identité du contrôleur Matter et appairages — **ne le partage jamais** |
| `data/lampes.json` | noms, ordre et lampes masquées |
| `data/reglages.json` | réglages |
| `data/tempos.json` | tempos calés |
| `data/morceaux/` | pochettes et extraits en cache des morceaux joués |

Les shows que tu crées sont enregistrés dans `shows/` (exclus de Git aussi, sauf les 4 shows fournis). Pour en partager un, utilise **Exporter**.

## Fichiers du projet

- `server.mjs`, `lib/` : le contrôleur Matter (bibliothèque open source [matter.js](https://github.com/matter-js/matter.js)), le moteur de show et la synchro musique.
- `public/index.html` : l'interface.
- `shows/` : les shows fournis (JSON lisible, modifiable à la main ; format décrit dans le [README anglais](README.md#show-file-format)).

## Licence

[MIT](LICENSE). Projet indépendant, sans lien avec Philips Hue / Signify, Apple ou la Connectivity Standards Alliance.
