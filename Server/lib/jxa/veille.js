// Veille macOS (un seul processus qui reste ouvert, lancé par lib/macwatch.mjs) : écrit une ligne dès qu'il se passe
// quelque chose d'utile, au lieu de tout relire sans cesse.
//   music              l'app Musique a changé (lecture, pause, morceau)       [notification de Musique]
//   spotify            l'app Spotify a changé                                  [notification de Spotify]
//   app <id> on|off    une app s'ouvre ou se ferme                             [NSWorkspace]
//   wake               le Mac sort de veille                                   [NSWorkspace]
//   np <json>          « En cours de lecture » a changé (Deezer, navigateur…)  [MediaRemote, lu ici toutes les 2 s]
//   ready              la veille fonctionne
// Rien n'est lancé à chaque lecture : c'est ce qui allège le Mac. S'arrête tout seul quand le logiciel s'arrête.
ObjC.import("Foundation");
ObjC.import("AppKit");

function run() {
    var out = $.NSFileHandle.fileHandleWithStandardOutput;
    var say = function (line) {
        out.writeData($(line + "\n").dataUsingEncoding($.NSUTF8StringEncoding));
    };
    ObjC.bindFunction("getppid", ["int", []]);
    var parent = $.getppid();

    ObjC.registerSubclass({
        name: "ShowLumiereVeille",
        methods: {
            "music:": { types: ["void", ["id"]], implementation: function () { say("music"); } },
            "spotify:": { types: ["void", ["id"]], implementation: function () { say("spotify"); } },
            "launched:": { types: ["void", ["id"]], implementation: function (n) { say("app " + bundleOf(n) + " on"); } },
            "terminated:": { types: ["void", ["id"]], implementation: function (n) { say("app " + bundleOf(n) + " off"); } },
            "woke:": { types: ["void", ["id"]], implementation: function () { say("wake"); } },
        },
    });
    function bundleOf(n) {
        try {
            var a = n.userInfo.objectForKey("NSWorkspaceApplicationKey");
            var b = a.bundleIdentifier;
            return b && !b.isNil() ? b.js : "?";
        } catch (e) {
            return "?";
        }
    }
    var obs = $.ShowLumiereVeille.alloc.init;
    var dnc = $.NSDistributedNotificationCenter.defaultCenter;
    dnc.addObserverSelectorNameObject(obs, "music:", "com.apple.Music.playerInfo", $()); // $() = nil (null serait NSNull)
    dnc.addObserverSelectorNameObject(obs, "spotify:", "com.spotify.client.PlaybackStateChanged", $()); // $() = nil (null serait NSNull)
    var wnc = $.NSWorkspace.sharedWorkspace.notificationCenter;
    wnc.addObserverSelectorNameObject(obs, "launched:", "NSWorkspaceDidLaunchApplicationNotification", $()); // $() = nil (null serait NSNull)
    wnc.addObserverSelectorNameObject(obs, "terminated:", "NSWorkspaceDidTerminateApplicationNotification", $()); // $() = nil (null serait NSNull)
    wnc.addObserverSelectorNameObject(obs, "woke:", "NSWorkspaceDidWakeNotification", $()); // $() = nil (null serait NSNull)

    // « En cours de lecture » (apps sans notification : Deezer, Tidal, navigateurs…)
    var Req = null;
    try {
        $.NSBundle.bundleWithPath("/System/Library/PrivateFrameworks/MediaRemote.framework/").load;
        Req = $.NSClassFromString("MRNowPlayingRequest");
    } catch (e) {}
    var lastNp = null;
    function nowPlaying() {
        if (!Req) return;
        var o = {};
        try {
            var c = Req.localNowPlayingPlayerPath.client;
            o.bundle = c.bundleIdentifier.js;
        } catch (e) {}
        try {
            var info = Req.localNowPlayingItem.nowPlayingInfo;
            var get = function (k) {
                try {
                    var v = info.valueForKey(k);
                    return !v || v.isNil() ? null : v.js;
                } catch (e) {
                    return null;
                }
            };
            o.title = get("kMRMediaRemoteNowPlayingInfoTitle");
            o.artist = get("kMRMediaRemoteNowPlayingInfoArtist");
            o.rate = get("kMRMediaRemoteNowPlayingInfoPlaybackRate");
        } catch (e) {}
        var s = JSON.stringify(o);
        if (s !== lastNp) {
            lastNp = s;
            say("np " + s);
        }
    }

    say("ready");
    nowPlaying();
    var loop = $.NSRunLoop.currentRunLoop;
    while (true) {
        var t0 = Date.now();
        loop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(2));
        if (Date.now() - t0 < 500) delay(1.5); // boucle sans source d'événements : on ne tourne pas à vide
        if ($.getppid() !== parent) break; // le logiciel s'est arrêté
        nowPlaying();
    }
}
