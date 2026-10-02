# Matter Light Show 💡🎶

**Turn your Mac into a local Matter controller and play light shows on your smart lamps — synced to Apple Music.**

No cloud, no account, no vendor API: the app speaks standard [Matter](https://csa-iot.org/all-solutions/matter/) directly to your lights over your home network. It was built for Philips Hue lamps behind a Hue Bridge, but works with any Matter light.

🇫🇷 [Lire en français](README.fr.md) · The web interface is in French.

![Show editor](docs/screenshot-shows.png)

![Music sync](docs/screenshot-music.png)

---

## Features

- **Local Matter controller** (multi-admin): pair your Hue Bridge (or any Matter light) with an 11-digit pairing code. Your lights stay in Apple Home / Google Home / Alexa at the same time.
- **Show editor** in the browser: a show is a sequence of steps with a duration and a fade. Three modes per step:
  - *All the same* — one colour for every lamp;
  - *Palette* — a list of colours spread over the lamps, with a shift to create chases and waves;
  - *Lamp by lamp* — per-lamp settings.
- **Music sync with Apple Music** (macOS):
  - colours taken automatically from the **album cover** (or the genre), and the style follows the music (calm / groove / energetic);
  - tempo found automatically (30 s Apple preview analysed in the browser, public BPM databases, or tap tempo);
  - optional **microphone beat alignment** — analysed locally in the browser, nothing recorded or sent;
  - each beat sends a wave of colour across the room, with brightness accents on the downbeat;
  - playlists or songs matching keywords (e.g. "Christmas", "Halloween") start dedicated shows.
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

Then open <http://localhost:8321>.

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

- **Automatic** colours: from the cover art (enriched so that near-monochrome covers still give visible changes), or from the genre, or from a show whose keywords match the playlist / title / genre;
- or pick **one of your shows**: its colours are kept and the music drives the rhythm;
- **Rhythm intensity**: auto, soft, medium, strong or none;
- **Save these colours as a show** turns the automatic palette into an editable show.

To look up cover art, the 30 s preview and BPM, the app sends the **song title and artist** to the public **iTunes Search** and **Deezer** APIs (no account, no key). Results are cached locally for 30 days.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8321` | HTTP port |
| `HOST` | `127.0.0.1` | Set `0.0.0.0` to control the show from a phone on your LAN (`http://<your-mac>.local:8321`). ⚠️ There is no password — only do this on a trusted home network. |
| `MATTER_DEBUG` | – | Verbose matter.js logs |
| `MUSIC_SIM` | – | Simulated music player (for development without a Mac) |

Other settings (max command rate, light lead time, demo mode…) are in the **Réglages** tab.

## Your data stays on your machine

Everything personal is written to the `data/` folder, which is **git-ignored**:

| Path | Contents |
|---|---|
| `data/matter/` | Matter controller identity and fabric credentials, paired devices — **never share this** |
| `data/lampes.json` | Lamp names, order, hidden lamps |
| `data/reglages.json` | Settings |
| `data/tempos.json` | Calibrated tempos |
| `data/morceaux/` | Cached cover art and previews of the songs you played |

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
lib/music.mjs       Apple Music via osascript (state, transport, playlists, AirPlay) + simulator
lib/online.mjs      Song info from public iTunes Search / Deezer APIs (cached)
lib/autoshow.mjs    Automatic shows from cover/genre palettes
lib/tempo.mjs       Known tempos, BPM normalisation, tap tempo
lib/sync.mjs        Music sync: beat clock, waves and accents
public/index.html   The whole web interface (vanilla JS)
shows/              Bundled shows
```

## Known limitations

- A Hue Bridge accepts roughly **10 Matter commands per second**. With many lamps, only a few change on each beat; raise the max rate in Réglages (15–20) if your bridge keeps up.
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
