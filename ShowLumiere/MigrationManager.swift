import AppKit
import Foundation

/// Reprise des données de l'ancien Show lumière (LaunchAgent + fausse app) vers l'app.
///
/// Principe : on ne supprime jamais rien. Ordre des opérations :
///   1. mettre l'ancien service en pause (launchctl bootout — son fichier .plist reste en place)
///   2. sauvegarde complète en .zip (data + shows) dans le dossier choisi (le T7), vérifiée
///   3. copie de data/ (avec data/matter : aucun réappairage) et shows/ vers « Application Support/Show lumière »
///   4. démarrage du nouveau serveur, recherche des lampes
///   5. c'est l'utilisateur qui décide : « Oui » → l'ancien démarrage automatique et l'ancienne fausse app vont
///      à la corbeille ; « Non » → retour arrière complet (l'ancien service est relancé).
/// L'ancien dossier ~/Applications/show-lumiere-matter n'est jamais modifié.
@MainActor
final class MigrationManager: ObservableObject {
    static let shared = MigrationManager()

    enum Step: Equatable {
        case intro
        case working
        case verify
        case done(String)
        case rolledBack(String)
        case failed(String)
    }

    enum ItemState {
        case waiting, running, done, failed
    }

    struct Item: Identifiable {
        let id: Int
        let title: String
        var state: ItemState = .waiting
        var detail: String = ""
    }

    /// L'état du nouveau serveur, relu en direct pour l'écran de vérification.
    struct LiveReport {
        var serverRunning: Bool
        var version: String?
        var lampsTotal: Int
        var lampsReachable: Int
        var matterReady: Bool
        var matterError: String?
    }

    private struct Marker: Codable {
        var status: String // "inprogress" | "pending" | "done" | "rolledback"
        var date: String
        var backup: String?
        var legacyWasLoaded: Bool
    }

    private struct MigrationError: LocalizedError {
        let message: String
        init(_ message: String) { self.message = message }
        var errorDescription: String? { message }
    }

    @Published var isVisible = false
    @Published private(set) var step: Step = .intro
    @Published private(set) var items: [Item] = MigrationManager.freshItems()
    @Published private(set) var backupFolder: URL?
    @Published private(set) var backupFile: URL?
    @Published private(set) var dataSizeText = ""
    @Published private(set) var finalizing = false

    private var legacyWasLoaded = false
    private var newDataCreated = false // vrai dès qu'on a commencé à écrire dans la nouvelle installation

    private init() {
        // l'écran de vérification suit l'état du serveur en direct
        ServerManager.shared.addObserver { [weak self] in
            self?.objectWillChange.send()
        }
        backupFolder = MigrationManager.defaultBackupFolder()
    }

    // MARK: - état

    var isBusy: Bool {
        if finalizing { return true }
        if case .working = step { return true }
        return false
    }

    /// Il reste des données de l'ancien Show lumière à reprendre.
    var needsMigration: Bool {
        let fm = FileManager.default
        guard fm.fileExists(atPath: Paths.oldRoot.appendingPathComponent("data/matter").path) else { return false }
        let status = readMarker()?.status
        if status == "pending" || status == "done" { return false }
        if status != nil { return true } // interrompue, annulée ou échouée : on la refait proprement
        return !fm.fileExists(atPath: Paths.dataDir.appendingPathComponent("matter").path)
    }

    /// Tout est copié et le serveur tourne : il reste à confirmer (ou à annuler).
    var isPendingConfirmation: Bool {
        readMarker()?.status == "pending"
    }

    /// Texte de l'entrée de la barre des menus (nil = pas d'entrée).
    var menuTitle: String? {
        if needsMigration { return "Reprendre mes données de l'ancien Show lumière…" }
        if isPendingConfirmation { return "Terminer la migration (confirmer ou annuler)…" }
        return nil
    }

    var liveReport: LiveReport {
        let server = ServerManager.shared
        let s = server.status
        return LiveReport(
            serverRunning: server.phase == .running,
            version: s?.version,
            lampsTotal: s?.lamps?.total ?? 0,
            lampsReachable: s?.lamps?.reachable ?? 0,
            matterReady: s?.matter?.ready == true,
            matterError: s?.matter?.error
        )
    }

    // MARK: - affichage

    func show() {
        if !isBusy {
            if isPendingConfirmation {
                legacyWasLoaded = readMarker()?.legacyWasLoaded ?? false
                step = .verify
            } else if needsMigration {
                if step != .intro { resetToIntro() } else { prepareIntro() }
            }
        }
        isVisible = true
        MainWindowController.shared.show()
    }

    func hide() {
        guard !isBusy else { return }
        isVisible = false
    }

    /// Au lancement : s'il restait une confirmation à donner, on la repropose (la fenêtre est déjà ouverte).
    func resumeIfPending() {
        guard isPendingConfirmation else { return }
        legacyWasLoaded = readMarker()?.legacyWasLoaded ?? false
        step = .verify
        isVisible = true
    }

    func resetToIntro() {
        guard !isBusy else { return }
        step = .intro
        items = MigrationManager.freshItems()
        backupFile = nil
        prepareIntro()
    }

    private func prepareIntro() {
        if backupFolder == nil { backupFolder = MigrationManager.defaultBackupFolder() }
        dataSizeText = "calcul…"
        Task { [self] in
            let hasShows = FileManager.default.fileExists(atPath: Paths.oldRoot.appendingPathComponent("shows").path)
            let dataURL = Paths.oldRoot.appendingPathComponent("data", isDirectory: true)
            let showsURL = Paths.oldRoot.appendingPathComponent("shows", isDirectory: true)
            let bytes = await Task.detached { () -> Int64 in
                Files.size(of: dataURL) + (hasShows ? Files.size(of: showsURL) : 0)
            }.value
            self.dataSizeText = Files.megabytes(bytes)
        }
    }

    private static func freshItems() -> [Item] {
        [
            Item(id: 0, title: "Mettre l'ancien Show lumière en pause"),
            Item(id: 1, title: "Sauvegarder tes données (fichier .zip)"),
            Item(id: 2, title: "Copier tes données (appairages Hue / IKEA, shows, musiques)"),
            Item(id: 3, title: "Démarrer le nouveau serveur"),
            Item(id: 4, title: "Chercher tes lampes"),
        ]
    }

    /// Le disque T7 s'il est branché (le nom du volume contient « T7 »).
    private static func defaultBackupFolder() -> URL? {
        guard let volumes = try? FileManager.default.contentsOfDirectory(atPath: "/Volumes") else { return nil }
        if let t7 = volumes.first(where: { $0.lowercased().contains("t7") }) {
            return URL(fileURLWithPath: "/Volumes/\(t7)", isDirectory: true)
        }
        return nil
    }

    func chooseBackupFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Choisir ce dossier"
        panel.message = "Choisis où ranger la sauvegarde de tes données (le disque T7 de préférence)."
        panel.directoryURL = backupFolder ?? URL(fileURLWithPath: "/Volumes", isDirectory: true)
        if panel.runModal() == .OK, let url = panel.url {
            backupFolder = url
        }
    }

    // MARK: - marqueur (petit fichier JSON : où en est la migration)

    private func readMarker() -> Marker? {
        guard let data = try? Data(contentsOf: Paths.migrationMarker) else { return nil }
        return try? JSONDecoder().decode(Marker.self, from: data)
    }

    private func writeMarker(status: String, backup: String? = nil) {
        let marker = Marker(
            status: status,
            date: ISO8601DateFormatter().string(from: Date()),
            backup: backup ?? readMarker()?.backup ?? backupFile?.path,
            legacyWasLoaded: legacyWasLoaded
        )
        try? FileManager.default.createDirectory(at: Paths.appSupport, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(marker) {
            try? data.write(to: Paths.migrationMarker, options: .atomic)
        }
    }

    // MARK: - suivi des étapes

    private func begin(_ index: Int, _ detail: String = "") {
        items[index].state = .running
        items[index].detail = detail
    }

    private func finish(_ index: Int, _ detail: String = "") {
        items[index].state = .done
        items[index].detail = detail
    }

    private func markFailed(_ message: String) {
        if let index = items.firstIndex(where: { $0.state == .running }) {
            items[index].state = .failed
            items[index].detail = message
        }
    }

    private static func tail(_ text: String, _ count: Int = 400) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.count > count ? "…" + String(trimmed.suffix(count)) : trimmed
    }

    private var launchctlTarget: String { "gui/\(getuid())/\(Paths.oldServiceLabel)" }

    // MARK: - lancement de la migration

    func startMigration() {
        guard !isBusy, let folder = backupFolder else { return }
        step = .working
        items = MigrationManager.freshItems()
        backupFile = nil
        Task { await self.run(folder: folder) }
    }

    private func run(folder: URL) async {
        AppLog.write("Migration : début (sauvegarde dans \(folder.path)).")
        newDataCreated = false
        if let marker = readMarker(), marker.status == "inprogress" { legacyWasLoaded = marker.legacyWasLoaded }
        do {
            try await perform(folder: folder)
        } catch {
            let message = (error as? MigrationError)?.message ?? error.localizedDescription
            markFailed(message)
            await abortAndRestore(message)
        }
    }

    private func perform(folder: URL) async throws {
        let fm = FileManager.default
        let stamp = Files.stamp()
        let oldData = Paths.oldRoot.appendingPathComponent("data", isDirectory: true)
        let oldShows = Paths.oldRoot.appendingPathComponent("shows", isDirectory: true)
        let hasShows = fm.fileExists(atPath: oldShows.path)

        // 0. vérifications avant de toucher à quoi que ce soit
        guard fm.fileExists(atPath: oldData.path) else {
            throw MigrationError("Je ne trouve plus le dossier de l'ancien Show lumière (\(oldData.path)). Rien n'a été modifié.")
        }
        let bytes = await Task.detached { () -> Int64 in
            Files.size(of: oldData) + (hasShows ? Files.size(of: oldShows) : 0)
        }.value
        let needed = bytes + 300_000_000
        if let free = Files.freeSpace(at: Paths.appSupport), free < needed {
            throw MigrationError("Il n'y a pas assez de place sur le disque du Mac : il faut environ \(Files.megabytes(needed)) libres, il en reste \(Files.megabytes(free)). Libère de la place puis réessaie. Rien n'a été modifié.")
        }
        if let free = Files.freeSpace(at: folder), free < bytes + 50_000_000 {
            throw MigrationError("Il n'y a pas assez de place dans le dossier de sauvegarde (\(Files.megabytes(free)) libres, il en faut \(Files.megabytes(bytes + 50_000_000))). Choisis un autre dossier. Rien n'a été modifié.")
        }

        // 1. mettre l'ancien service en pause (son fichier .plist n'est pas touché)
        begin(0)
        let previous = readMarker()
        let loaded = await runTool("/bin/launchctl", ["print", launchctlTarget])
        legacyWasLoaded = loaded.ok || (previous?.status == "inprogress" && previous?.legacyWasLoaded == true)
        writeMarker(status: "inprogress")
        if loaded.ok {
            let result = await runTool("/bin/launchctl", ["bootout", launchctlTarget])
            AppLog.write("Migration : ancien service mis en pause (launchctl : \(result.status)).")
        }
        var freed = false
        for _ in 0..<60 {
            if !Probe.portIsOpen() { freed = true; break }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        guard freed else {
            throw MigrationError("Le port \(Paths.port) est toujours utilisé. L'ancien Show lumière tourne peut-être autrement que par le service (dans le Terminal ?). Ferme-le puis réessaie.")
        }
        finish(0, loaded.ok ? "L'ancien service est en pause (rien n'est supprimé)." : "L'ancien service n'était pas en route.")

        // 2. sauvegarde complète, vérifiée
        begin(1, "En cours… (quelques secondes)")
        try? fm.createDirectory(at: folder, withIntermediateDirectories: true)
        let zipURL = folder.appendingPathComponent("Show-lumiere-sauvegarde-\(stamp).zip")
        var zipArgs = ["-r", "-q", "-y", zipURL.path, "data"]
        if hasShows { zipArgs.append("shows") }
        let zipResult = await runTool("/usr/bin/zip", zipArgs, cwd: Paths.oldRoot)
        guard zipResult.ok else {
            if fm.fileExists(atPath: zipURL.path) { try? Files.trash(zipURL) }
            throw MigrationError("La sauvegarde a échoué (\(MigrationManager.tail(zipResult.output))). Si macOS a demandé l'accès au disque, clique « Autoriser » puis réessaie.")
        }
        let testResult = await runTool("/usr/bin/unzip", ["-tq", zipURL.path])
        let zipSize = ((try? fm.attributesOfItem(atPath: zipURL.path))?[.size] as? NSNumber)?.int64Value ?? 0
        guard testResult.ok, zipSize > 0 else {
            throw MigrationError("La sauvegarde a été écrite mais la vérification a échoué (\(MigrationManager.tail(testResult.output))). Je n'ai rien copié.")
        }
        backupFile = zipURL
        finish(1, "\(zipURL.lastPathComponent) (\(Files.megabytes(zipSize))) — vérifiée.")

        // 3. copie (jamais d'écrasement : un dossier déjà présent est mis de côté, pas supprimé)
        begin(2, "En cours…")
        try fm.createDirectory(at: Paths.appSupport, withIntermediateDirectories: true)
        var folders: [(String, URL)] = [("data", oldData)]
        if hasShows { folders.append(("shows", oldShows)) }
        for (name, source) in folders {
            let destination = Paths.appSupport.appendingPathComponent(name, isDirectory: true)
            if fm.fileExists(atPath: destination.path) {
                let aside = Paths.appSupport.appendingPathComponent("\(name)-avant-migration-\(stamp)", isDirectory: true)
                try fm.moveItem(at: destination, to: aside)
                AppLog.write("Migration : \(name) existant mis de côté (\(aside.lastPathComponent)).")
            }
            newDataCreated = true
            let copy = await runTool("/usr/bin/ditto", [source.path, destination.path])
            guard copy.ok else {
                throw MigrationError("La copie de « \(name) » a échoué (\(MigrationManager.tail(copy.output))).")
            }
            let counts = await Task.detached { () -> (Int, Int) in
                (Files.count(in: source), Files.count(in: destination))
            }.value
            guard counts.0 == counts.1 else {
                throw MigrationError("La copie de « \(name) » est incomplète (\(counts.1) fichiers copiés sur \(counts.0)).")
            }
        }
        let hasMatter = fm.fileExists(atPath: Paths.dataDir.appendingPathComponent("matter").path)
        finish(2, hasMatter ? "Copié, appairages Matter compris." : "Copié (attention : pas de dossier « matter » trouvé).")

        // 4. démarrage du nouveau serveur
        begin(3, "Le serveur démarre…")
        ServerManager.shared.start()
        var running = false
        var lastProblem = ""
        for _ in 0..<180 {
            let phase = ServerManager.shared.phase
            if phase == .running { running = true; break }
            if case .failed(let message) = phase { lastProblem = message }
            if case .legacyServiceRunning = phase { throw MigrationError("Un autre Show lumière utilise encore le port \(Paths.port).") }
            if case .portBusy(let message) = phase { throw MigrationError(message) }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        guard running else {
            throw MigrationError("Le nouveau serveur n'a pas démarré. \(lastProblem) Regarde le journal (barre des menus › Voir le journal).")
        }
        finish(3, "Le serveur tourne.")

        // 5. les lampes (on laisse jusqu'à 60 s à Matter pour retrouver ses appareils)
        begin(4, "Recherche en cours… (jusqu'à une minute)")
        var found = false
        for _ in 0..<120 {
            let report = liveReport
            if report.matterReady && report.lampsTotal > 0 { found = true; break }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        let report = liveReport
        if found {
            finish(4, "\(report.lampsTotal) lampes trouvées (\(report.lampsReachable) joignables).")
        } else {
            items[4].state = .failed
            items[4].detail = report.lampsTotal > 0
                ? "\(report.lampsTotal) lampes listées, mais Matter n'est pas encore prêt. Patiente un peu ou contrôle dans la fenêtre."
                : "Aucune lampe trouvée pour l'instant."
        }

        writeMarker(status: "pending", backup: zipURL.path)
        AppLog.write("Migration : copie terminée, en attente de confirmation (lampes : \(report.lampsTotal)).")
        step = .verify
    }

    // MARK: - échec : tout remettre comme avant

    private func abortAndRestore(_ message: String) async {
        AppLog.write("Migration : échec — \(message)")
        await ServerManager.shared.stop()
        ServerManager.shared.markWaitingForMigration()
        let moved = newDataCreated ? setAsideNewData(tag: "echec") : false
        let restored = await restoreLegacyService()
        writeMarker(status: "rolledback")
        var text = message
        if moved { text += "\n\nLes données copiées à moitié ont été mises de côté (dossiers « …-echec-… » dans Application Support/Show lumière), rien n'est perdu." }
        text += "\n\n" + restored
        step = .failed(text)
    }

    /// Met les dossiers data/ et shows/ de la nouvelle installation de côté (renommés, jamais supprimés).
    @discardableResult
    private func setAsideNewData(tag: String) -> Bool {
        let fm = FileManager.default
        let stamp = Files.stamp()
        var moved = false
        for name in ["data", "shows"] {
            let url = Paths.appSupport.appendingPathComponent(name, isDirectory: true)
            guard fm.fileExists(atPath: url.path) else { continue }
            let aside = Paths.appSupport.appendingPathComponent("\(name)-\(tag)-\(stamp)", isDirectory: true)
            do {
                try fm.moveItem(at: url, to: aside)
                moved = true
            } catch {
                AppLog.write("Migration : impossible de mettre \(name) de côté : \(error.localizedDescription)")
            }
        }
        return moved
    }

    /// Relance l'ancien service s'il tournait avant la migration. Renvoie une phrase pour l'utilisateur.
    private func restoreLegacyService() async -> String {
        guard legacyWasLoaded else {
            return "L'ancien service n'avait pas été touché : tout est comme avant."
        }
        let plist = Paths.oldServicePlist
        guard FileManager.default.fileExists(atPath: plist.path) else {
            return "Je n'ai pas retrouvé le fichier de l'ancien service (\(plist.path)). Tes données d'origine sont intactes ; dis-moi et je t'aiderai à le relancer."
        }
        let check = await runTool("/bin/launchctl", ["print", launchctlTarget])
        if !check.ok {
            let result = await runTool("/bin/launchctl", ["bootstrap", "gui/\(getuid())", plist.path])
            AppLog.write("Migration : ancien service relancé (launchctl : \(result.status)).")
        }
        for _ in 0..<40 {
            if Probe.portIsOpen() { return "J'ai remis l'ancien Show lumière en route : tout est comme avant." }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        return "J'ai demandé à macOS de relancer l'ancien service ; il met un peu de temps à répondre. Tes données d'origine sont intactes."
    }

    // MARK: - décision de l'utilisateur

    /// « Oui, tout fonctionne » : l'ancien démarrage automatique et l'ancienne fausse app vont à la corbeille.
    func confirmSuccess() {
        guard case .verify = step, !finalizing else { return }
        finalizing = true
        Task { [self] in
            var notes: [String] = []
            let fm = FileManager.default

            let plist = Paths.oldServicePlist
            if fm.fileExists(atPath: plist.path) {
                do {
                    try Files.trash(plist)
                    notes.append("L'ancien démarrage automatique (LaunchAgent) est à la corbeille.")
                } catch {
                    notes.append("Je n'ai pas pu mettre l'ancien démarrage automatique à la corbeille : \(error.localizedDescription)")
                }
            }

            let fake = Paths.oldFakeApp
            let me = Bundle.main.bundleURL.standardizedFileURL.path
            if fm.fileExists(atPath: fake.path) {
                let fakeID = Bundle(url: fake)?.bundleIdentifier
                let isMe = fake.standardizedFileURL.path == me || fakeID == Bundle.main.bundleIdentifier
                if isMe {
                    notes.append("L'ancienne app « Show lumière.app » n'a pas été touchée (c'est le même emplacement que cette app).")
                } else {
                    do {
                        try Files.trash(fake)
                        notes.append("L'ancienne fausse app « Show lumière.app » est à la corbeille.")
                    } catch {
                        notes.append("Je n'ai pas pu mettre l'ancienne app à la corbeille : \(error.localizedDescription)")
                    }
                }
            }

            writeMarker(status: "done")
            AppLog.write("Migration : confirmée par l'utilisateur. \(notes.joined(separator: " "))")
            var text = notes.joined(separator: "\n")
            text += "\n\nL'ancien dossier « show-lumiere-matter » n'a pas été touché : tu peux le garder quelques semaines, puis le supprimer toi-même."
            if let backup = readMarker()?.backup { text += "\nTa sauvegarde : \(backup)" }
            finalizing = false
            step = .done(text)
        }
    }

    /// « Non » : on arrête le nouveau serveur, on met ses données de côté, on relance l'ancien service.
    func rollback() {
        guard case .verify = step, !finalizing else { return }
        finalizing = true
        Task { [self] in
            await ServerManager.shared.stop()
            ServerManager.shared.markWaitingForMigration()
            let moved = setAsideNewData(tag: "annulee")
            let restored = await restoreLegacyService()
            writeMarker(status: "rolledback")
            AppLog.write("Migration : annulée par l'utilisateur.")
            var text = restored
            if moved { text += "\n\nLes données copiées dans la nouvelle app ont été mises de côté (dossiers « …-annulee-… »), pas supprimées. Ta sauvegarde .zip est toujours là." }
            finalizing = false
            step = .rolledBack(text)
        }
    }

    // MARK: - ancien service encore en route alors que la migration est faite

    /// Bouton « Arrêter l'ancien service et continuer » (écran « L'ancien Show lumière tourne encore »).
    func stopLegacyAndStart() {
        Task { [self] in
            _ = await runTool("/bin/launchctl", ["bootout", launchctlTarget])
            var freed = false
            for _ in 0..<40 {
                if !Probe.portIsOpen() { freed = true; break }
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
            guard freed else {
                showAlert("Show lumière", "Le port \(Paths.port) est toujours occupé. Ferme l'ancien Show lumière (Moniteur d'activité › processus « node ») puis réessaie.", style: .warning)
                return
            }
            ServerManager.shared.start()
            if FileManager.default.fileExists(atPath: Paths.oldServicePlist.path) {
                let alert = NSAlert()
                alert.messageText = "Retirer aussi l'ancien démarrage automatique ?"
                alert.informativeText = "Sinon, l'ancien service reviendra au prochain démarrage du Mac et prendra la place de l'app. Le fichier va à la corbeille (rien n'est supprimé définitivement)."
                alert.addButton(withTitle: "Mettre à la corbeille")
                alert.addButton(withTitle: "Plus tard")
                if alert.runModal() == .alertFirstButtonReturn {
                    try? Files.trash(Paths.oldServicePlist)
                }
            }
        }
    }
}
