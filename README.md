# Matter Light Show 💡🎶

**Turn your Mac into a local Matter controller and play light shows on your smart lamps — synced to Apple Music.**

No cloud, no account, no vendor API: the app speaks standard [Matter](https://csa-iot.org/all-solutions/matter/) directly to your lights over your home network. It was built for Philips Hue lamps behind a Hue Bridge, but works with any Matter light.

🇫🇷 [Lire en français](README.fr.md) · The web interface is in French.

![Show editor](docs/screenshot-shows.png)

![Music sync](docs/screenshot-music.png)

![Rooms](docs/screenshot-rooms.png)

---

## Features

- **Local Matter controller** (multi-admin): pair your Hue Bridge (or any Matter light) with an 11-digit pairing code. Your lights stay in Apple Home / Google Home / Alexa at the same time.
- **Show editor** in the browser: a show is a sequence of steps with a duration and a fade. Three modes per step:
  - *All the same* — one colour for every lamp;
  - *Palette* — a list of colours spread over the lamps, with a shift to create chases and waves;
  - *Lamp by lamp* — per-lamp settings.
- **Music sync with Apple Music** (macOS):
  - **4 automatic colour modes** built from the **album cover** (faces, greys and blacks ignored) plus mood colours picked from the genre, style and tempo — *full*, *sober*, *cover only* and *shades* (the cover colours declined into vivid / light / pastel / dark / deep variants);
  - **genre-aware accents**: every beat for dance and K-pop, beats 2 & 4 for rock and R&B, "one drop" for reggae, slow breathing for classical and ambient…;
  - **style** (calm / groove / energetic) from tempo, genre and the **energy** measured on the 30 s preview;
  - **My colours**: pick up to 6 colours (pastels included); they are arranged into a smooth gradient around the colour wheel (or contrasting halves for energetic songs) and can also be applied as a static ambiance;
  - tempo found automatically (30 s Apple preview analysed in the browser, public BPM databases, or tap tempo);
  - optional **microphone beat alignment** — analysed locally in the browser, nothing recorded or sent;
  - each beat sends a wave of colour across the room, with brightness accents on the downbeat;
  - playlists or songs matching keywords (e.g. "Christmas", "Halloween") start dedicated shows.
- **Rooms & coherence**: group lamps into rooms (suggested from lamp names, or read from Matter labels when the device provides them), link each room to its AirPlay speakers, then choose one ambiance per room, waves from room to room, a whole room at once, or **only the rooms where music is playing**.
- **AirPlay volume** per speaker and master volume, right from the Music tab.
- **Rate limiting** built in: commands are spread so a Hue Bridge (~10 commands/s) is never flooded.
- **Demo mode**: 6 virtual lamps to design shows without any hardware.
- 4 bundled shows: *Soirée ambiance*, *Chenillard rouge & bleu*, *Halloween — Nuit des monstres*, *Noël enchanté*.

## How it works

```
 Your Mac (this app)  ──Matter / Wi-Fi──▶  Hue Bridge  ──Zigbee──▶  Hue lamps
        ▲                                      ▲
     browser                          Apple Home stays connected in parallel
```

Hue bulbs speak Zigbee, so the Hue Bridge is still needed: it exposes them on the network as Matter devices. The app only sends standard Matter commands (OnOff, LevelControl, ColorControl, Identify) using the open-source [matter.js](https://github.com/matter-js/matter.js) library.

## Requirements

- **Node.js 22.13 or later** ([nodejs.org](https://nodejs.org), LTS).
- Matter lights on the same local network (Wi-Fi/Ethernet with IPv6, not a guest network, no VPN).
- **macOS** for the Apple Music sync (the app reads the Music app via AppleScript). The show editor and the Matter controller are plain Node.js.

## Install

```bash
git clone https://github.com/badi-project/matter-light-show.git
cd matter-light-show
npm install
npm start
```

Then open <http://localhost:8321>. Already installed? `git pull`, then click **Réglages › Redémarrer le logiciel** (or restart the launcher).

On macOS you can also double-click **`Lancer le show.command`**: it installs dependencies on first run, stops any older instance, prevents the Mac from sleeping while the show runs, and opens the browser. If macOS says the file can't be executed, run `chmod +x "Lancer le show.command"` once.

> 💡 Put the folder somewhere that is **not synced to iCloud/OneDrive** (e.g. `~/Applications`). When the disk fills up, macOS may evict synced files and the app — including its Matter pairing — stops working.

macOS will ask for a few permissions the first time — accept them:
- **Local Network** for Terminal (required for Matter discovery);
- **Automation › Music** for Terminal (music sync);
- **Microphone** in the browser (only if you enable beat alignment).

## Pair your lights

**Lampes › Ajouter un appareil Matter** (Lamps › Add a Matter device):

1. In the **Apple Home** app, open the Hue Bridge settings and tap **Turn On Pairing Mode**, then copy the 11-digit code.
   If the bridge was added to Home through HomeKit rather than Matter, generate the code in the **Hue app › Settings › Smart Home / Matter** instead.
2. Paste the code and click **Appairer** within ~15 minutes.

All lamps of the bridge appear. You can rename them, reorder them (the order is used by palettes), hide them from shows, or make them blink to identify them.

Removing a device (**Retirer**) only removes this controller's fabric — the device stays in your other apps.

## Music sync

In the **Musique** tab, play music with the **Music app on the Mac** (AirPlay to HomePods and speakers works), then turn on **Synchroniser les lumières avec la musique**:

- **Automatic** colours — four modes:
  - *Auto complet* (default): main cover colours + mood colours from genre, style and tempo (fewer, softer, warmer colours for calm songs; more saturated ones with an "impact" colour for energetic songs);
  - *Auto sobre*: cover colours + only 2 mood colours;
  - *Auto pochette*: cover colours only (white light for a black & white cover);
  - *Auto nuances*: cover colours declined into shades, flavoured by the genre (vivid for K-pop/electro, deep for jazz/R&B, soft pastel for indie/folk, contrasted for rock);
- **Mes couleurs**: your own palette (up to 6 colours), auto-arranged; **Diffuser maintenant** applies it without music;
- or pick **one of your shows**: its colours are kept and the music drives the rhythm;
- **Rhythm intensity**: auto, soft, medium, strong or none;
- **Save these colours as a show** turns the automatic palette into an editable show.

The genre is read from the Music app, Apple and Deezer (or guessed from the audio when missing); it also picks the accent pattern.

### Rooms and coherence

In **Lampes › Pièces**, create rooms or click **Proposer d'après les noms** (e.g. "Bedroom lamp" → Chambre, "Kitchen 1/2" → Cuisine, "Garden 1/2/3" → Jardin; French and English keywords, otherwise lamps sharing a name prefix are grouped), fix each lamp's room, order the rooms (this is the wave order) and link each room to its AirPlay speakers. A Hue Bridge doesn't expose its rooms over Matter, so this is done by hand; if a device does announce room labels in Matter, they are used automatically.

Then, under the colours in the **Musique** tab, choose a **coherence** mode:
- **One ambiance per room**: one dominant colour per room with close shades between its lamps;
- **Waves from room to room**: each change starts in the first room and travels in room order;
- **A whole room at once**: all lamps of a room change together, rooms answer each other on the beat (works best with the bridge rate limit);
- **Only where the music plays**: the show only runs in rooms whose AirPlay speaker is selected; other rooms go soft white, turn off or stay unchanged.

To look up cover art, the 30 s preview, genre and BPM, the app sends the **song title and artist** to the public **iTunes Search** and **Deezer** APIs (no account, no key). Colour, tempo and energy analyses run in your browser; results are cached locally for 30 days.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8321` | HTTP port |
| `HOST` | `127.0.0.1` | Set `0.0.0.0` to control the show from a phone on your LAN (`http://<your-mac>.local:8321`). ⚠️ There is no password — only do this on a trusted home network. |
| `MATTER_DEBUG` | – | Verbose matter.js logs |
| `MUSIC_SIM` | – | Simulated music player (for development without a Mac) |

Other settings (max command rate, light lead time, demo mode…) are in the **Réglages** tab, along with **Redémarrer le logiciel** (restart the server — available when started with the launcher, which relaunches it).

## Your data stays on your machine

Everything personal is written to the `data/` folder, which is **git-ignored**:

| Path | Contents |
|---|---|
| `data/matter/` | Matter controller identity and fabric credentials, paired devices — **never share this** |
| `data/lampes.json` | Lamp names, order, hidden lamps |
| `data/pieces.json` | Your rooms, their lamps and speakers |
| `data/reglages.json` | Settings (including *My colours*) |
| `data/tempos.json` | Calibrated tempos |
| `data/morceaux/` | Cached cover art, previews and analyses of the songs you played |

Shows you create are saved to `shows/` (also git-ignored, except the 4 bundled ones). Use **Exporter / Importer** to share a show as a `.json` file.

## Show file format

```jsonc
{
  "name": "Chenillard rouge & bleu",
  "loop": true,
  "speed": 1,
  "tempo": { "bpm": 118 },              // optional: durations are then counted in beats
  "music": { "match": ["halloween"] },  // optional: auto-start keywords for music sync
  "steps": [
    {
      "name": "Step 1",
      "duration": 1.2,                  // seconds (or beats if tempo is set)
      "fade": 0.4,
      "mode": "palette",                // "all" | "palette" | "custom"
      "palette": { "colors": ["#ff0000", "off", "#2040ff", "off"], "brightness": 100, "shift": 0 },
      "all":     { "on": true, "color": "2700K", "brightness": 80 },
      "lamps":   { "<lampId>": { "on": true, "color": "#00ff88", "brightness": 60 } }
    }
  ]
}
```

Colours are `#rrggbb`, a colour temperature like `2700K`, or `off`.

## Project structure

```
server.mjs          HTTP server, REST API + Server-Sent Events, JSON persistence
lib/matter.mjs      Matter controller: pairing, lamp discovery, commands (matter.js)
lib/show.mjs        Show engine: step resolution, player, rate-limited dispatcher
lib/color.mjs       Colour conversions (hex → CIE xy / hue-sat, Kelvin → mireds)
lib/palette.mjs     Colour arrangement (gradient / contrast) and shades
lib/rooms.mjs       Rooms: suggestions from names, speaker links, per-room targets
lib/music.mjs       Apple Music via osascript (state, transport, playlists, AirPlay, volume) + simulator
lib/online.mjs      Song info from public iTunes Search / Deezer APIs (cached)
lib/genre.mjs       Genre families, energy, style, accent patterns, palette building
lib/autoshow.mjs    Automatic shows from cover/genre palettes
lib/tempo.mjs       Known tempos, BPM normalisation, tap tempo
lib/sync.mjs        Music sync: beat clock, waves, rooms and accents
public/index.html   The whole web interface (vanilla JS)
public/analyse.js   In-browser analyses: cover colours (OKLab), tempo, energy
shows/              Bundled shows
```

## Known limitations

- A Hue Bridge accepts roughly **10 Matter commands per second**. With many lamps, only a few change on each beat (changing a big room takes several beats); raise the max rate in Réglages (15–20) if your bridge keeps up.
- A Hue Bridge doesn't share its rooms over Matter: rooms must be set up in the app.
- Analyses run in the page: keep the web interface open (at least once per song).
- Not available through Matter: Hue gradient effects, Hue Entertainment sync, Hue scenes.
- Music sync only follows the **Music app of the Mac** running the server.
- The Mac must stay awake during the show (the launcher uses `caffeinate`).

## Troubleshooting

| Problem | What to check |
|---|---|
| Pairing fails | The code may have expired — generate a new one. Same network as the bridge (no guest Wi-Fi, no VPN). Local Network permission granted to Terminal. |
| Bridge stuck on "recherche sur le réseau…" | Bridge off or the computer changed network; it reconnects automatically. |
| Lamps lag behind | Longer steps, fewer lamps per step, or lower the max rate. |
| Lights don't follow the music | Music must play in the Music app **of this Mac**; check *Automation › Terminal › Music*. |
| Lights are off-beat | Enable the microphone (or tap the tempo), then adjust the light lead in *Réglages fins*. |

## Credits

Built on [matter.js](https://github.com/matter-js/matter.js) (Apache-2.0). Cover art, previews and BPM come from the public iTunes Search and Deezer APIs and belong to their respective owners; they are only cached locally.

Not affiliated with Philips Hue, Signify, Apple or the Connectivity Standards Alliance.

## License

[MIT](LICENSE)
