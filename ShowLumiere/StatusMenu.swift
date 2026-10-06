import AppKit

/// Icône ampoule dans la barre des menus : état du show, morceau en cours, et les actions courantes.
@MainActor
final class StatusMenuController: NSObject, NSMenuDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private var observerId: UUID?

    override init() {
        super.init()
        menu.delegate = self
        menu.autoenablesItems = false
        statusItem.menu = menu
        statusItem.button?.toolTip = Paths.displayName
        updateIcon()
        observerId = ServerManager.shared.addObserver { [weak self] in
            self?.updateIcon()
        }
    }

    // MARK: - icône

    private func updateIcon() {
        let server = ServerManager.shared
        let symbol: String
        switch server.phase {
        case .running:
            symbol = server.status?.standby == true ? "lightbulb" : "lightbulb.fill"
        case .failed, .legacyServiceRunning, .portBusy:
            symbol = "exclamationmark.triangle.fill"
        default:
            symbol = "lightbulb"
        }
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: Paths.displayName)
        image?.isTemplate = true
        statusItem.button?.image = image
    }

    // MARK: - menu (reconstruit à chaque ouverture)

    func menuNeedsUpdate(_ menu: NSMenu) {
        rebuild()
    }

    @discardableResult
    private func addItem(_ title: String, action: Selector? = nil, key: String = "", enabled: Bool = true, checked: Bool = false) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        item.isEnabled = enabled && action != nil
        item.state = checked ? .on : .off
        menu.addItem(item)
        return item
    }

    private func rebuild() {
        let server = ServerManager.shared
        menu.removeAllItems()

        addItem(server.headline)
        if let line = server.musicLine { addItem(line) }
        if let line = server.showLine { addItem(line) }
        if let line = server.lampsLine { addItem(line) }
        if let line = server.versionLine { addItem(line) }
        menu.addItem(.separator())

        let running = server.phase == .running
        let standby = server.status?.standby == true

        addItem("Ouvrir la fenêtre", action: #selector(openWindow), key: "o")
        addItem(standby ? "Démarrer le show" : "Arrêter le show", action: #selector(togglePower), enabled: running)
        addItem("Synchro musique", action: #selector(toggleSync), enabled: running, checked: server.status?.sync?.enabled == true)
        addItem("✨ Créer un show (bientôt)")
        if let title = MigrationManager.shared.menuTitle {
            menu.addItem(.separator())
            addItem(title, action: #selector(openMigration))
        }
        menu.addItem(.separator())

        addItem("Redémarrer le serveur", action: #selector(restartServer), enabled: server.hasProcess)
        addItem("Ouvrir au démarrage du Mac", action: #selector(toggleLogin), checked: LoginItem.isEnabled)
        addItem("Voir le journal", action: #selector(openLog))
        menu.addItem(.separator())
        addItem("Quitter Show lumière", action: #selector(quit), key: "q")
    }

    // MARK: - actions

    @objc private func openWindow() {
        MainWindowController.shared.show()
    }

    @objc private func togglePower() {
        let standby = ServerManager.shared.status?.standby == true
        Task { await ServerManager.shared.setStandby(!standby) }
    }

    @objc private func toggleSync() {
        let on = ServerManager.shared.status?.sync?.enabled == true
        Task { await ServerManager.shared.setSync(!on) }
    }

    @objc private func openMigration() {
        MigrationManager.shared.show()
    }

    @objc private func restartServer() {
        Task { await ServerManager.shared.restart() }
    }

    @objc private func toggleLogin() {
        do {
            if LoginItem.isEnabled {
                try LoginItem.set(false)
            } else {
                try LoginItem.set(true)
                if LoginItem.status == .requiresApproval {
                    showAlert("Une autorisation est nécessaire", "Ouvre Réglages Système › Général › Ouverture et extensions, et active « Show lumière » dans la liste « Ouvrir à la connexion ».")
                }
            }
        } catch {
            showAlert("Impossible de changer ce réglage", error.localizedDescription, style: .warning)
        }
    }

    @objc private func openLog() {
        AppActions.shared.openLog()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}
