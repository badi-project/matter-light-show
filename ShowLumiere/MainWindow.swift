import AppKit
import SwiftUI

/// La fenêtre du show. Elle n'existe que quand on l'ouvre : fermée, la page se déconnecte du serveur
/// et l'icône disparaît du Dock (l'app reste dans la barre des menus).
@MainActor
final class MainWindowController: NSObject, NSWindowDelegate {
    static let shared = MainWindowController()

    private var window: NSWindow?
    private var web: WebController?

    var isOpen: Bool { window != nil }

    func show() {
        NSApp.setActivationPolicy(.regular)
        if window == nil { buildWindow() }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func buildWindow() {
        let controller = WebController(server: ServerManager.shared)
        web = controller
        let root = MainContentView(server: ServerManager.shared, web: controller, migration: MigrationManager.shared)
        let hosting = NSHostingView(rootView: root)

        let w = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        w.title = Paths.displayName
        w.contentView = hosting
        w.isReleasedWhenClosed = false
        w.minSize = NSSize(width: 520, height: 560)
        w.delegate = self
        if !w.setFrameUsingName("ShowLumiereMainWindow") { w.center() }
        w.setFrameAutosaveName("ShowLumiereMainWindow")
        window = w
    }

    func windowWillClose(_ notification: Notification) {
        web?.teardown()
        web = nil
        window?.contentView = nil
        window = nil
        DispatchQueue.main.async {
            NSApp.setActivationPolicy(.accessory) // plus d'icône dans le Dock
        }
    }

    // MARK: - menu Présentation

    func reloadPage() { web?.reload() }
    func zoomIn() { web?.zoom(by: 0.1) }
    func zoomOut() { web?.zoom(by: -0.1) }
    func zoomReset() { web?.resetZoom() }
    func sendToPage(_ payload: [String: Any]) { web?.sendToPage(payload) }
}
