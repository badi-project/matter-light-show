// Choisit la sortie audio du Mac (Core Audio), appelé par lib/audio.mjs :
//   osascript -l JavaScript sortie-audio.js <adresse base64> <identifiant base64>
// Les deux arguments sont des octets déjà préparés (petit-boutiste) : la propriété « sortie par défaut » et l'identifiant
// de l'appareil. Renvoie le code d'erreur Core Audio (0 = réussi).
ObjC.import("Foundation");
function run(argv) {
    $.NSBundle.bundleWithPath("/System/Library/Frameworks/CoreAudio.framework").load;
    ObjC.bindFunction("AudioObjectSetPropertyData", ["int", ["unsigned int", "void *", "unsigned int", "void *", "unsigned int", "void *"]]);
    var addr = $.NSData.alloc.initWithBase64EncodedStringOptions($(argv[0]), 0);
    var dev = $.NSData.alloc.initWithBase64EncodedStringOptions($(argv[1]), 0);
    var codes = [];
    codes.push($.AudioObjectSetPropertyData(1, addr.bytes, 0, null, 4, dev.bytes));
    if (argv[2]) {
        // sortie des sons du système (alertes) : même appareil
        var addr2 = $.NSData.alloc.initWithBase64EncodedStringOptions($(argv[2]), 0);
        codes.push($.AudioObjectSetPropertyData(1, addr2.bytes, 0, null, 4, dev.bytes));
    }
    return JSON.stringify(codes);
}
