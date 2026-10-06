// Appareils Bluetooth jumelés au Mac (IOBluetooth), appelé par lib/audio.mjs :
//   osascript -l JavaScript bluetooth.js                       -> { auth, devices: [...] }
//   osascript -l JavaScript bluetooth.js connect <adresse>     (ou disconnect)
// Le même script sert aussi de petite app « Show lumière Bluetooth » (osacompile) : macOS ne laisse utiliser le
// Bluetooth qu'aux apps qui le demandent, pas au service en arrière-plan. L'app est lancée par « open » avec
//   --args --show-out <fichier> [connect|disconnect <adresse>]   et écrit sa réponse dans <fichier>.
// auth : 0 = pas encore demandé, 1 = restreint, 2 = refusé, 3 = autorisé (CBManager.authorization).
ObjC.import("Foundation");
ObjC.import("CoreBluetooth");

function authorization() {
    try {
        var a = $.CBManager.authorization;
        return typeof a === "number" ? a : 3; // macOS trop ancien : pas d'autorisation à demander
    } catch (e) {
        return 3;
    }
}

function work(args, isApp) {
    var auth = authorization();
    if (auth !== 3 && !isApp) return { auth: auth, devices: [] }; // ne pas toucher au Bluetooth sans autorisation
    $.NSBundle.bundleWithPath("/System/Library/Frameworks/IOBluetooth.framework").load;
    var Dev = $.NSClassFromString("IOBluetoothDevice");
    var list = Dev.pairedDevices; // dans l'app : déclenche la demande d'autorisation la 1re fois
    if (isApp && auth === 0) {
        // on attend la réponse à la fenêtre « … souhaite utiliser le Bluetooth » (25 s au plus)
        for (var t = 0; t < 50 && authorization() === 0; t++) delay(0.5);
        auth = authorization();
        list = Dev.pairedDevices;
    }
    if (auth !== 3) return { auth: auth, devices: [] };
    var out = [];
    var n = list && !list.isNil() ? list.count : 0;
    var want = args[1] ? args[1].replace(/[^0-9a-f]/gi, "").toLowerCase() : null;
    for (var i = 0; i < n; i++) {
        var d = list.objectAtIndex(i);
        var item = {
            name: d.name && !d.name.isNil() ? d.name.js : "",
            address: d.addressString && !d.addressString.isNil() ? d.addressString.js : "",
            connected: !!d.isConnected,
            major: d.deviceClassMajor,
            minor: d.deviceClassMinor,
        };
        if (want && args[0] && item.address.replace(/[^0-9a-f]/gi, "").toLowerCase() === want) item.result = args[0] === "connect" ? d.openConnection : d.closeConnection;
        out.push(item);
    }
    return { auth: auth, devices: out };
}

function run(argv) {
    var pa = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments) || [];
    var k = pa.indexOf("--show-out");
    if (k < 0) return JSON.stringify(work(argv || [], false));
    var file = pa[k + 1];
    var res;
    try {
        res = work(pa.slice(k + 2), true);
    } catch (e) {
        res = { error: String(e) }; // jamais de fenêtre d'erreur : l'app doit se fermer seule
    }
    $(JSON.stringify(res)).writeToFileAtomicallyEncodingError(file, true, $.NSUTF8StringEncoding, null);
}
