// API : toutes les sorties audio — Mac (Bluetooth, USB, HDMI…), Bluetooth jumelé, AirPlay, Spotify Connect, Sonos.
export default ctx => {
    const { music, macAudio, spotifyWeb, sonos, log, state } = ctx;
    return {
        "GET /api/audio/outputs": async () => {
            const safe = (p, d) => p.catch(e => ({ error: e.message, ...d }));
            const apple = music.sourceOf("apple");
            const [mac, bt, airplay, appleVolume, spotify, sonosList] = await Promise.all([
                safe(macAudio.outputs(), {}),
                safe(macAudio.bluetooth(), {}),
                safe(apple?.available ? music.airplay() : Promise.resolve([]), {}),
                apple?.available && apple.state?.running ? apple.getVolume().catch(() => null) : null, // sans rouvrir Musique
                spotifyWeb.connected ? safe(spotifyWeb.devices(), {}) : null,
                sonos.available ? safe(sonos.outputs(), {}) : [],
            ]);
            // noms proposés pour relier les pièces aux enceintes
            ctx.addSpeakerNames([...(Array.isArray(mac) ? mac : []).map(o => o.name), ...(Array.isArray(airplay) ? airplay : []).map(d => d.name)]);
            return {
                source: music.active,
                mac: { available: macAudio.available, outputs: Array.isArray(mac) ? mac : [], error: mac.error ?? macAudio.lastError },
                bluetooth: { list: bt.list ?? [], error: bt.error ?? null, via: bt.via ?? null, helperAuth: bt.helperAuth ?? null },
                airplay: { available: !!apple?.available, list: Array.isArray(airplay) ? airplay : [], volume: appleVolume, error: airplay.error ?? null },
                spotify: spotify === null ? null : { list: Array.isArray(spotify) ? spotify : [], error: spotify.error ?? null },
                sonos: { list: Array.isArray(sonosList) ? sonosList : [], error: sonosList.error ?? sonos.error ?? null },
                names: state.speakerNames,
            };
        },
        "POST /api/audio/mac": async ({ body }) => {
            await macAudio.select(String(body.name ?? ""));
            log("info", `🔊 Sortie du Mac : ${body.name}.`);
            setTimeout(ctx.refreshSpeakers, 500);
            return { ok: true };
        },
        "POST /api/audio/mac/volume": async ({ body }) => {
            await macAudio.setVolume(Number(body.volume));
            return { ok: true };
        },
        "POST /api/audio/bluetooth/autoriser": async () => macAudio.bluetoothAuthorize(),
        "POST /api/audio/bluetooth": async ({ body }) => {
            await macAudio.bluetoothConnect(String(body.address ?? ""), body.connect !== false);
            log("info", `🔵 ${body.name ?? "Appareil Bluetooth"} ${body.connect !== false ? "connecté" : "déconnecté"}.`);
            setTimeout(ctx.refreshSpeakers, 1500);
            return { ok: true };
        },
        "POST /api/audio/spotify": async ({ body }) => {
            if (!spotifyWeb.connected) throw new Error("Connecte d'abord ton compte Spotify (onglet Musique)");
            if ("volume" in body) await spotifyWeb.setDeviceVolume(body.deviceId, Number(body.volume));
            else {
                await spotifyWeb.transfer(String(body.deviceId ?? ""), true);
                log("info", `🔊 Spotify joue maintenant sur ${body.name ?? "un autre appareil"}.`);
                setTimeout(() => music.refresh().catch(() => {}), 1200);
            }
            return { ok: true };
        },
        "POST /api/audio/sonos/volume": async ({ body }) => {
            await sonos.setVolume(String(body.id ?? ""), Number(body.volume));
            return { ok: true };
        },
    };
};
