import AppKit
import Foundation

/// Le serveur Node embarqué : installation, lancement, surveillance, redémarrage, arrêt propre.
@MainActor
final class ServerManager: ObservableObject {
    static let shared = ServerManager()

    enum Phase: Equatable {
        case idle
        case waitingForMigration
        case installing
        case starting
        case running
        case restarting
        case failed(String)
        case legacyServiceRunning(String)
        case portBusy(String)
    }

    private(set) var phase: Phase = .idle {
        willSet { objectWillChange.send() }
        didSet { if oldValue != phase { notifyChange() } }
    }

    private(set) var status: AppStatus? {
        willSet { objectWillChange.send() }
        didSet { notifyChange() }
    }

    private(set) var reachable = false {
        willSet { objectWillChange.send() }
    }

    /// Appelé quand le serveur se ferme tout seul avec le code 0 (« Quitter complètement » dans la page).
    var onUserQuit: (() -> Void)?

    private var process: Process?
    private var startedAt = Date()
    private var stoppingOnPurpose = false
    private var crashCount = 0
    private var missedPolls = 0
    private var launching = false
    private var pollTask: Task<Void, Never>?
    private var relaunchTask: Task<Void, Never>?
    private var observers: [UUID: () -> Void] = [:]

    var hasProcess: Bool { process != nil }
    var isRunning: Bool { phase == .running }

    @discardableResult
    func addObserver(_ callback: @escaping () -> Void) -> UUID {
        let id = UUID()
        observers[id] = callback
        return id
    }

    func removeObserver(_ id: UUID) {
        observers[id] = nil
    }

    private func notifyChange() {
        for callback in observers.values { callback() }
    }

    func markWaitingForMigration() {
        phase = .waitingForMigration
    }

    // MARK: - démarrage

    /// Démarre le serveur s'il ne tourne pas (sans effet sinon).
    func start() {
        guard process == nil, !launching else { return }
        relaunchTask?.cancel()
        relaunchTask = nil
        launching = true
        Task { await self.prepareAndLaunch() }
    }

    private func prepareAndLaunch() async {
        defer { launching = false }
        phase = .installing
        do {
            let message = try ServerInstaller.installIfNeeded()
            AppLog.write(message)
        } catch {
            AppLog.write("Installation du serveur impossible : \(error.localizedDescription)")
            phase = .failed(error.localizedDescription)
            return
        }

        if Probe.portIsOpen() {
            let ping = try? await API.get("/api/ping", as: PingInfo.self, timeout: 2)
            if let ping = ping, ping.ok == true {
                if ping.service == "app", let pid = ping.pid {
                    // un serveur de cette app est resté en route (arrêt brutal de l'app) : on le ferme proprement
                    AppLog.write("Un serveur de l'app tournait encore (pid \(pid)) : arrêt.")
                    kill(pid_t(pid), SIGTERM)
                    for _ in 0..<40 {
                        if !Probe.portIsOpen() { break }
                        try? await Task.sleep(nanoseconds: 250_000_000)
                    }
                    if Probe.portIsOpen() {
                        phase = .portBusy("Un ancien serveur de l'app ne se ferme pas (pid \(pid)). Ferme-le dans le Moniteur d'activité (processus « node »).")
                        return
                    }
                } else {
                    AppLog.write("Le port \(Paths.port) est pris par un autre Show lumière (mode « \(ping.service ?? "inconnu") »).")
                    phase = .legacyServiceRunning(ping.service ?? "inconnu")
                    return
                }
            } else {
                AppLog.write("Le port \(Paths.port) est pris par un autre programme.")
                phase = .portBusy("Le port \(Paths.port) est utilisé par un autre programme. Ferme-le puis réessaie.")
                return
            }
        }
        launch()
    }

    private func launch() {
        let node = Paths.nodeBinary
        guard FileManager.default.isExecutableFile(atPath: node.path) else {
            phase = .failed("Le programme Node est introuvable dans l'app. Lance « Scripts/preparer.command » puis recompile l'app dans Xcode.")
            return
        }
        let fm = FileManager.default
        try? fm.createDirectory(at: Paths.logsDir, withIntermediateDirectories: true)
        rotateServerLogIfNeeded()
        if !fm.fileExists(atPath: Paths.serverLog.path) {
            fm.createFile(atPath: Paths.serverLog.path, contents: nil)
        }
        guard let logHandle = try? FileHandle(forWritingTo: Paths.serverLog) else {
            phase = .failed("Impossible d'écrire le journal (\(Paths.serverLog.path)).")
            return
        }
        logHandle.seekToEndOfFile()

        let p = Process()
        p.executableURL = node
        p.arguments = [Paths.serverDir.appendingPathComponent("server.mjs").path]
        p.currentDirectoryURL = Paths.serverDir

        var env = ProcessInfo.processInfo.environment
        env.removeValue(forKey: "HOST")
        env["PORT"] = String(Paths.port)
        env["SHOW_LAUNCHER"] = "1" // redémarrage (code 75) géré par l'app
        env["SHOW_SERVICE"] = "app" // le serveur sait qu'il est lancé par l'app
        env["SHOW_APP_NAME"] = Paths.displayName
        env["SHOW_DATA_DIR"] = Paths.dataDir.path
        env["SHOW_SHOWS_DIR"] = Paths.showsDir.path
        env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin"
        p.environment = env
        p.standardOutput = logHandle
        p.standardError = logHandle
        p.standardInput = FileHandle.nullDevice
        p.qualityOfService = .userInitiated

        p.terminationHandler = { [weak self] proc in
            let pid = proc.processIdentifier
            let code = proc.terminationStatus
            let signaled = proc.terminationReason == .uncaughtSignal
            Task { @MainActor in
                self?.processEnded(pid: pid, code: code, signaled: signaled)
            }
        }

        do {
            try p.run()
        } catch {
            AppLog.write("Lancement de Node impossible : \(error.localizedDescription)")
            phase = .failed("Impossible de lancer Node : \(error.localizedDescription)")
            return
        }
        process = p
        startedAt = Date()
        missedPolls = 0
        phase = .starting
        AppLog.write("Serveur lancé (pid \(p.processIdentifier)).")
        startPolling()
    }

    private func rotateServerLogIfNeeded() {
        let fm = FileManager.default
        guard let attributes = try? fm.attributesOfItem(atPath: Paths.serverLog.path),
              let size = attributes[.size] as? NSNumber, size.int64Value > 5_000_000 else { return }
        let previous = Paths.logsDir.appendingPathComponent("serveur.log.1")
        if fm.fileExists(atPath: previous.path) { try? Files.trash(previous) }
        try? fm.moveItem(at: Paths.serverLog, to: previous)
    }

    // MARK: - fin du processus

    private func processEnded(pid: Int32, code: Int32, signaled: Bool) {
        guard let current = process, current.processIdentifier == pid else { return }
        process = nil
        pollTask?.cancel()
        pollTask = nil
        reachable = false
        status = nil
        let ran = Date().timeIntervalSince(startedAt)
        AppLog.write("Serveur arrêté (code \(code)\(signaled ? ", tué par un signal" : ""), après \(Int(ran)) s).")

        if stoppingOnPurpose {
            stoppingOnPurpose = false
            phase = .idle
            return
        }
        if !signaled && code == 75 { // redémarrage demandé (mise à jour, bouton ↻)
            crashCount = 0
            phase = .restarting
            scheduleRelaunch(after: 0.6)
            return
        }
        if !signaled && code == 0 { // « Quitter complètement » dans la page : l'app se ferme aussi
            phase = .idle
            onUserQuit?()
            return
        }
        if ran > 60 { crashCount = 0 }
        crashCount += 1
        let delay = min(60.0, 2.0 * pow(2.0, Double(crashCount - 1)))
        phase = .failed("Le serveur s'est arrêté de façon inattendue (code \(code)). Nouvel essai dans \(Int(delay)) s.")
        scheduleRelaunch(after: delay)
    }

    private func scheduleRelaunch(after delay: TimeInterval) {
        relaunchTask?.cancel()
        relaunchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled, let self = self else { return }
            self.relaunchTask = nil
            self.start()
        }
    }

    // MARK: - surveillance (état léger toutes les 2 s)

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self = self, self.process != nil else { return }
                await self.pollOnce()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    private func pollOnce() async {
        do {
            let s = try await API.get("/api/app/status", as: AppStatus.self)
            apply(status: s)
        } catch {
            if let ping = try? await API.get("/api/ping", as: PingInfo.self), ping.ok == true {
                apply(status: AppStatus(version: ping.version, service: ping.service, pid: ping.pid, standby: ping.standby))
            } else {
                missedPolls += 1
                reachable = false
                if missedPolls >= 3 && status != nil { status = nil }
                if phase == .starting && Date().timeIntervalSince(startedAt) > 60 {
                    phase = .failed("Le serveur ne répond pas. Regarde le journal pour comprendre pourquoi.")
                }
            }
        }
    }

    private func apply(status s: AppStatus) {
        missedPolls = 0
        reachable = true
        status = s
        switch phase {
        case .starting, .restarting, .installing:
            phase = .running
        case .failed:
            phase = .running
        default:
            break
        }
    }

    /// Relit l'état tout de suite (après une action du menu).
    func refreshNow() async {
        guard process != nil else { return }
        await pollOnce()
    }

    // MARK: - arrêt propre

    /// SIGTERM, attend la fin du serveur (il referme proprement Matter), puis SIGKILL en dernier recours.
    func stop() async {
        relaunchTask?.cancel()
        relaunchTask = nil
        pollTask?.cancel()
        pollTask = nil
        guard let p = process else {
            reachable = false
            status = nil
            if phase != .waitingForMigration { phase = .idle }
            return
        }
        stoppingOnPurpose = true
        p.terminate()
        var waited = 0
        while p.isRunning && waited < 60 {
            try? await Task.sleep(nanoseconds: 200_000_000)
            waited += 1
        }
        if p.isRunning {
            AppLog.write("Le serveur ne se ferme pas : arrêt forcé.")
            kill(p.processIdentifier, SIGKILL)
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        process = nil
        stoppingOnPurpose = false
        reachable = false
        status = nil
        phase = .idle
    }

    func restart() async {
        if process != nil && reachable {
            phase = .restarting
            do {
                try await API.post("/api/restart")
            } catch {
                AppLog.write("Redémarrage doux impossible (\(error.localizedDescription)) : arrêt puis relance.")
                await stop()
                start()
            }
        } else {
            await stop()
            start()
        }
    }

    // MARK: - actions de la barre des menus

    func setStandby(_ stop: Bool) async {
        do {
            try await API.post("/api/power", ["action": stop ? "stop" : "start"])
        } catch {
            showAlert("Show lumière", "Action impossible : \(error.localizedDescription)", style: .warning)
        }
        await refreshNow()
    }

    func setSync(_ on: Bool) async {
        do {
            try await API.post("/api/music/sync", ["enabled": on])
        } catch {
            showAlert("Show lumière", "Action impossible : \(error.localizedDescription)", style: .warning)
        }
        await refreshNow()
    }

    // MARK: - textes de la barre des menus

    var headline: String {
        switch phase {
        case .running: return status?.standby == true ? "○ Show à l'arrêt (lampes en couleur d'arrêt)" : "● Show en marche"
        case .installing, .starting: return "◐ Démarrage…"
        case .restarting: return "◐ Redémarrage…"
        case .failed: return "⚠ Problème avec le serveur"
        case .legacyServiceRunning: return "⚠ L'ancien service tourne encore"
        case .portBusy: return "⚠ Le port \(Paths.port) est occupé"
        case .waitingForMigration: return "⏸ Migration à faire"
        case .idle: return "○ Arrêté"
        }
    }

    var musicLine: String? {
        guard let music = status?.music, let title = music.title, !title.isEmpty else { return nil }
        let artist = music.artist ?? ""
        let text = artist.isEmpty ? title : "\(title) — \(artist)"
        return (music.playing == true ? "♪ " : "⏸ ") + ServerManager.shorten(text)
    }

    var showLine: String? {
        if status?.player?.playing == true, let name = status?.player?.showName { return "Show : \(ServerManager.shorten(name))" }
        if status?.sync?.enabled == true { return "Synchro musique active" }
        return nil
    }

    var lampsLine: String? {
        guard let lamps = status?.lamps, let total = lamps.total else { return nil }
        return "\(total) lampes (\(lamps.reachable ?? total) joignables)"
    }

    var versionLine: String? {
        guard let version = status?.version else { return nil }
        return "Show lumière \(version)"
    }

    private static func shorten(_ text: String, max: Int = 56) -> String {
        text.count > max ? String(text.prefix(max - 1)) + "…" : text
    }
}
