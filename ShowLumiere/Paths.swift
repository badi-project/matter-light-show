import Foundation

/// Tous les emplacements utilisés par l'app. Rien n'est écrit ailleurs.
enum Paths {
    static let displayName = "Show lumière"
    static let port = 8321
    static let baseURL = URL(string: "http://127.0.0.1:8321")!

    static var home: URL { FileManager.default.homeDirectoryForCurrentUser }

    // --- nouvelle installation (celle de l'app)
    static var appSupport: URL { home.appendingPathComponent("Library/Application Support/Show lumière", isDirectory: true) }
    static var serverDir: URL { appSupport.appendingPathComponent("serveur", isDirectory: true) }
    static var dataDir: URL { appSupport.appendingPathComponent("data", isDirectory: true) }
    static var showsDir: URL { appSupport.appendingPathComponent("shows", isDirectory: true) }
    static var oldVersionsDir: URL { appSupport.appendingPathComponent("anciennes-versions", isDirectory: true) }
    static var migrationMarker: URL { appSupport.appendingPathComponent("migration.json") }

    static var logsDir: URL { home.appendingPathComponent("Library/Logs/Show lumière", isDirectory: true) }
    static var serverLog: URL { logsDir.appendingPathComponent("serveur.log") }
    static var appLog: URL { logsDir.appendingPathComponent("app.log") }

    // --- dans l'app
    static var bundledServer: URL { Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/serveur", isDirectory: true) }
    static var nodeBinary: URL { Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/node") }

    // --- ancienne installation (Node lancé par un LaunchAgent + fausse app bash)
    static var oldRoot: URL { home.appendingPathComponent("Applications/show-lumiere-matter", isDirectory: true) }
    static var oldFakeApp: URL { home.appendingPathComponent("Applications/Show lumière.app", isDirectory: true) }
    static let oldServiceLabel = "fr.showlumiere.serveur"
    static var oldServicePlist: URL { home.appendingPathComponent("Library/LaunchAgents/fr.showlumiere.serveur.plist") }
}
