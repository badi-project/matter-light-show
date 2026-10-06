import Foundation

struct BuildInfo: Decodable {
    let version: String
    let appBuild: Int
}

struct InstallError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Installe (ou met à jour) le serveur embarqué dans ~/Library/Application Support/Show lumière/serveur/
/// pour que les mises à jour par copie de fichiers + POST /api/restart restent possibles.
enum ServerInstaller {
    static func readBuild(at dir: URL) -> BuildInfo? {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent("app-build.json")) else { return nil }
        return try? JSONDecoder().decode(BuildInfo.self, from: data)
    }

    static func isNewer(_ a: BuildInfo, than b: BuildInfo) -> Bool {
        let order = a.version.compare(b.version, options: .numeric)
        if order != .orderedSame { return order == .orderedDescending }
        return a.appBuild > b.appBuild
    }

    /// Renvoie une phrase pour le journal.
    @discardableResult
    static func installIfNeeded() throws -> String {
        let fm = FileManager.default
        let bundled = Paths.bundledServer
        guard let bundledBuild = readBuild(at: bundled) else {
            throw InstallError(message: "Le serveur n'est pas dans l'app (dossier « serveur » absent). Recompile l'app dans Xcode après avoir lancé « Scripts/preparer.command ».")
        }
        try fm.createDirectory(at: Paths.appSupport, withIntermediateDirectories: true)

        let installed = readBuild(at: Paths.serverDir)
        let freshInstall = !fm.fileExists(atPath: Paths.serverDir.path)
        var message = "Serveur \(installed?.version ?? "?") (build \(installed?.appBuild ?? 0)) déjà installé."

        let mustInstall: Bool
        if let installed = installed {
            mustInstall = isNewer(bundledBuild, than: installed)
        } else {
            mustInstall = true
        }

        if mustInstall {
            // l'ancienne version est rangée (jamais supprimée)
            if !freshInstall {
                try fm.createDirectory(at: Paths.oldVersionsDir, withIntermediateDirectories: true)
                let label = installed.map { "\($0.version)-\($0.appBuild)" } ?? "inconnue"
                let archive = Paths.oldVersionsDir.appendingPathComponent("serveur-\(label)-\(Files.stamp())", isDirectory: true)
                try fm.moveItem(at: Paths.serverDir, to: archive)
            }
            try fm.createDirectory(at: Paths.serverDir, withIntermediateDirectories: true)
            for name in ["server.mjs", "package.json", "package-lock.json", "app-build.json", "LISEZMOI.md", "lib", "public"] {
                let source = bundled.appendingPathComponent(name)
                if fm.fileExists(atPath: source.path) {
                    try fm.copyItem(at: source, to: Paths.serverDir.appendingPathComponent(name))
                }
            }
            message = "Serveur \(bundledBuild.version) (build \(bundledBuild.appBuild)) installé dans Application Support."
        }

        // les shows fournis ne sont copiés qu'à la toute première installation (jamais remis après une suppression)
        if !fm.fileExists(atPath: Paths.showsDir.path) {
            try fm.createDirectory(at: Paths.showsDir, withIntermediateDirectories: true)
            let provided = bundled.appendingPathComponent("shows")
            if let files = try? fm.contentsOfDirectory(atPath: provided.path) {
                for file in files where file.hasSuffix(".json") {
                    try? fm.copyItem(at: provided.appendingPathComponent(file), to: Paths.showsDir.appendingPathComponent(file))
                }
            }
        }

        try linkNodeModules()
        return message
    }

    /// node_modules reste dans l'app (140 Mo) ; le dossier installé n'y fait que pointer.
    private static func linkNodeModules() throws {
        let fm = FileManager.default
        let link = Paths.serverDir.appendingPathComponent("node_modules")
        let target = Paths.bundledServer.appendingPathComponent("node_modules").path
        let current = try? fm.destinationOfSymbolicLink(atPath: link.path)
        if current == target { return }
        if current != nil {
            try fm.removeItem(at: link) // un simple lien (l'app a peut-être changé d'endroit)
        } else if fm.fileExists(atPath: link.path) {
            return // vrai dossier (installé à la main) : on n'y touche pas
        }
        try fm.createSymbolicLink(atPath: link.path, withDestinationPath: target)
    }
}
