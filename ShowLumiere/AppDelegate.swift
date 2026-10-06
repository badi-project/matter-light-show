import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusMenu: StatusMenuController?

    // MARK: - lancement

    func applicationWillFinishLaunching(_ notification: Notification) {
        // une seule instance de l'app
        if let bundleId = Bundle.main.bundleIdentifier {
            let me = ProcessInfo.processInfo.processIdentifier
            let others = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).filter { $0.processIdentifier != me }
            if let other = others.first {
                _ = other.activate(options: [.activateIgnoringOtherApps])
                exit(0)
            }
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMainMenu()
        statusMenu = StatusMenuController()
        ServerManager.shared.onUserQuit = {
            NSApp.terminate(nil)
        }
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        AppLog.write("Show lumière (app \(version)) démarre.")

        let migration = MigrationManager.shared
        if migration.needsMigration {
            // l'ancienne installation existe et n'a pas encore été reprise : on ne démarre rien avant d'avoir décidé
            ServerManager.shared.markWaitingForMigration()
            migration.show()
        } else {
            ServerManager.shared.start()
            if !launchedAtLogin {
                MainWindowController.shared.show()
                migration.resumeIfPending() // une migration copiée mais pas encore confirmée
            }
        }
    }

    /// Ouverte automatiquement à l'ouverture de session : pas de fenêtre, seulement la barre des menus.
    private var launchedAtLogin: Bool {
        LoginItem.isEnabled && ProcessInfo.processInfo.systemUptime < 300
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls { AppActions.shared.handle(url: url) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        MainWindowController.shared.show()
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false // l'app continue dans la barre des menus
    }

    // MARK: - fermeture : le serveur s'arrête proprement (il referme Matter) avant l'app

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if MigrationManager.shared.isBusy {
            let alert = NSAlert()
            alert.messageText = "Une opération est en cours"
            alert.informativeText = "La migration n'est pas terminée. Si tu quittes maintenant, tes données copiées peuvent être incomplètes (rien n'est perdu : l'ancienne installation n'est pas modifiée)."
            alert.addButton(withTitle: "Continuer la migration")
            alert.addButton(withTitle: "Quitter quand même")
            if alert.runModal() == .alertFirstButtonReturn { return .terminateCancel }
        }
        guard ServerManager.shared.hasProcess else { return .terminateNow }
        Task {
            await ServerManager.shared.stop()
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    // MARK: - menus de l'app (nécessaires pour copier / coller dans la page)

    private func buildMainMenu() {
        let main = NSMenu()

        // Show lumière
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu(title: Paths.displayName)
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "À propos de Show lumière", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Masquer Show lumière", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quitter Show lumière", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        // Édition
        let editItem = NSMenuItem(title: "Édition", action: nil, keyEquivalent: "")
        main.addItem(editItem)
        let editMenu = NSMenu(title: "Édition")
        editItem.submenu = editMenu
        editMenu.addItem(withTitle: "Annuler", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Rétablir", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Couper", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copier", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Coller", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Tout sélectionner", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        // Présentation
        let viewItem = NSMenuItem(title: "Présentation", action: nil, keyEquivalent: "")
        main.addItem(viewItem)
        let viewMenu = NSMenu(title: "Présentation")
        viewItem.submenu = viewMenu
        addTargeted(viewMenu, "Recharger la page", #selector(reloadPage), "r")
        addTargeted(viewMenu, "Taille réelle", #selector(zoomReset), "0")
        addTargeted(viewMenu, "Agrandir", #selector(zoomIn), "+")
        addTargeted(viewMenu, "Réduire", #selector(zoomOut), "-")

        // Fenêtre
        let windowItem = NSMenuItem(title: "Fenêtre", action: nil, keyEquivalent: "")
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "Fenêtre")
        windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Fermer", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(withTitle: "Placer dans le Dock", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        NSApp.windowsMenu = windowMenu

        // Aide
        let helpItem = NSMenuItem(title: "Aide", action: nil, keyEquivalent: "")
        main.addItem(helpItem)
        let helpMenu = NSMenu(title: "Aide")
        helpItem.submenu = helpMenu
        addTargeted(helpMenu, "Voir le journal du serveur", #selector(openServerLog), "")
        addTargeted(helpMenu, "Voir le journal de l'app", #selector(openAppLog), "")

        NSApp.mainMenu = main
    }

    private func addTargeted(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String) {
        let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
        item.target = self
    }

    @objc private func reloadPage() { MainWindowController.shared.reloadPage() }
    @objc private func zoomIn() { MainWindowController.shared.zoomIn() }
    @objc private func zoomOut() { MainWindowController.shared.zoomOut() }
    @objc private func zoomReset() { MainWindowController.shared.zoomReset() }
    @objc private func openServerLog() { AppActions.shared.openLog() }
    @objc private func openAppLog() { AppActions.shared.openAppLog() }
}

/// Actions partagées par la barre des menus, la page (pont JavaScript) et le schéma d'URL showlumiere://
@MainActor
final class AppActions {
    static let shared = AppActions()

    func openLog() {
        revealLog(Paths.serverLog)
    }

    func openAppLog() {
        revealLog(Paths.appLog)
    }

    private func revealLog(_ url: URL) {
        let fm = FileManager.default
        try? fm.createDirectory(at: Paths.logsDir, withIntermediateDirectories: true)
        if !fm.fileExists(atPath: url.path) { fm.createFile(atPath: url.path, contents: nil) }
        NSWorkspace.shared.open(url)
    }

    func retryStart() {
        ServerManager.shared.start()
    }

    /// showlumiere://demarrer  (ouvre l'app et s'assure que le serveur tourne) · ouvrir · arreter
    func handle(url: URL) {
        let command = (url.host ?? url.path).trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased()
        AppLog.write("Lien reçu : \(url.absoluteString)")
        if MigrationManager.shared.needsMigration {
            MigrationManager.shared.show()
            return
        }
        switch command {
        case "arreter", "stop":
            Task { await ServerManager.shared.setStandby(true) }
        default:
            ServerManager.shared.start()
            MainWindowController.shared.show()
        }
    }

    /// Étape 2 (pas encore faite) : « ✨ Créer un show ». Le point d'entrée existe déjà : la page peut appeler
    /// window.ShowLumiereApp.createShow("…"), l'app répond par l'événement « showlumiere-app ».
    func createShowRequested(prompt: String?) {
        AppLog.write("Création de show demandée par la page (pas encore disponible).")
        MainWindowController.shared.sendToPage([
            "action": "createShow",
            "ok": false,
            "reason": "bientôt",
            "available": ShowCreator.isAvailable,
        ])
    }
}
