import AppKit

/// Point d'entrée : une app AppKit classique (icône dans la barre des menus + fenêtre à la demande).
@main
struct ShowLumiereMain {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        withExtendedLifetime(delegate) {
            app.run()
        }
    }
}
