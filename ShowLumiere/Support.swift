import AppKit
import Foundation
import ServiceManagement

/// Journal de l'app elle-même : ~/Library/Logs/Show lumière/app.log
enum AppLog {
    private static let queue = DispatchQueue(label: "fr.showlumiere.mac.applog")

    static func write(_ message: String) {
        let line = "\(ISO8601DateFormatter().string(from: Date()))  \(message)\n"
        queue.async {
            let fm = FileManager.default
            try? fm.createDirectory(at: Paths.logsDir, withIntermediateDirectories: true)
            if !fm.fileExists(atPath: Paths.appLog.path) {
                fm.createFile(atPath: Paths.appLog.path, contents: nil)
            }
            guard let data = line.data(using: .utf8), let handle = try? FileHandle(forWritingTo: Paths.appLog) else { return }
            handle.seekToEndOfFile()
            handle.write(data)
            try? handle.close()
        }
    }
}

/// « Ouvrir au démarrage du Mac » (réglage système Éléments de connexion).
enum LoginItem {
    static var status: SMAppService.Status { SMAppService.mainApp.status }
    static var isEnabled: Bool { status == .enabled }

    static func set(_ on: Bool) throws {
        if on {
            try SMAppService.mainApp.register()
        } else {
            try SMAppService.mainApp.unregister()
        }
    }
}

@MainActor
func showAlert(_ title: String, _ message: String, style: NSAlert.Style = .informational) {
    let alert = NSAlert()
    alert.alertStyle = style
    alert.messageText = title
    alert.informativeText = message
    alert.addButton(withTitle: "OK")
    alert.runModal()
}

// MARK: - lancer un outil système sans bloquer l'app

final class DataBox: @unchecked Sendable {
    private let lock = NSLock()
    private var data = Data()

    func append(_ chunk: Data) {
        lock.lock()
        data.append(chunk)
        lock.unlock()
    }

    var string: String {
        lock.lock()
        defer { lock.unlock() }
        return String(data: data, encoding: .utf8) ?? ""
    }
}

struct ToolResult {
    let status: Int32
    let output: String
    var ok: Bool { status == 0 }
}

/// Lance un programme (zip, ditto, launchctl…) et attend la fin. Ne bloque pas l'interface.
func runTool(_ path: String, _ args: [String] = [], cwd: URL? = nil) async -> ToolResult {
    await withCheckedContinuation { (continuation: CheckedContinuation<ToolResult, Never>) in
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = args
        if let cwd = cwd { process.currentDirectoryURL = cwd }
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        let box = DataBox()
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            if !chunk.isEmpty { box.append(chunk) }
        }
        process.terminationHandler = { proc in
            pipe.fileHandleForReading.readabilityHandler = nil
            box.append(pipe.fileHandleForReading.readDataToEndOfFile())
            continuation.resume(returning: ToolResult(status: proc.terminationStatus, output: box.string))
        }
        do {
            try process.run()
        } catch {
            pipe.fileHandleForReading.readabilityHandler = nil
            continuation.resume(returning: ToolResult(status: -1, output: error.localizedDescription))
        }
    }
}

// MARK: - fichiers

enum Files {
    /// Taille totale des fichiers d'un dossier (en octets).
    static func size(of dir: URL) -> Int64 {
        let keys: [URLResourceKey] = [.fileSizeKey, .isRegularFileKey]
        guard let walker = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: keys, options: []) else { return 0 }
        var total: Int64 = 0
        for case let url as URL in walker {
            if let values = try? url.resourceValues(forKeys: Set(keys)), values.isRegularFile == true {
                total += Int64(values.fileSize ?? 0)
            }
        }
        return total
    }

    /// Nombre de fichiers (hors dossiers) d'un dossier.
    static func count(in dir: URL) -> Int {
        let keys: [URLResourceKey] = [.isRegularFileKey]
        guard let walker = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: keys, options: []) else { return 0 }
        var n = 0
        for case let url as URL in walker {
            if let values = try? url.resourceValues(forKeys: Set(keys)), values.isRegularFile == true { n += 1 }
        }
        return n
    }

    /// Place libre (en octets) sur le disque qui contient ce dossier.
    static func freeSpace(at url: URL) -> Int64? {
        var probe = url
        while !FileManager.default.fileExists(atPath: probe.path) && probe.path != "/" {
            probe = probe.deletingLastPathComponent()
        }
        guard let values = try? probe.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]) else { return nil }
        return values.volumeAvailableCapacityForImportantUsage
    }

    static func megabytes(_ bytes: Int64) -> String {
        let mo = Double(bytes) / 1_048_576
        return mo >= 1024 ? String(format: "%.1f Go", mo / 1024) : String(format: "%.0f Mo", mo)
    }

    static func stamp() -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "fr_FR")
        df.dateFormat = "yyyy-MM-dd-HHmm"
        return df.string(from: Date())
    }

    /// Met un élément à la corbeille (jamais de suppression définitive).
    static func trash(_ url: URL) throws {
        try FileManager.default.trashItem(at: url, resultingItemURL: nil)
    }
}
