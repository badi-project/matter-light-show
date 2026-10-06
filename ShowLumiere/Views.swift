import SwiftUI
import WebKit

struct WebViewRepresentable: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

/// Contenu de la fenêtre : la page du show, et par-dessus, si besoin, l'assistant de migration
/// ou un écran d'attente / d'erreur clair.
struct MainContentView: View {
    @ObservedObject var server: ServerManager
    @ObservedObject var web: WebController
    @ObservedObject var migration: MigrationManager

    var body: some View {
        ZStack {
            WebViewRepresentable(webView: web.webView)
            if migration.isVisible {
                MigrationView(migration: migration)
            } else if let kind = overlayKind {
                StatusOverlay(kind: kind)
            }
        }
        .frame(minWidth: 520, minHeight: 560)
    }

    private var overlayKind: StatusOverlay.Kind? {
        switch server.phase {
        case .running:
            return web.hasLoadedOnce ? nil : .loading("Chargement de l'interface…")
        case .installing, .starting:
            return web.hasLoadedOnce ? nil : .loading("Démarrage du serveur…")
        case .restarting:
            return web.hasLoadedOnce ? nil : .loading("Redémarrage du serveur…")
        case .idle:
            return .loading("Démarrage…")
        case .waitingForMigration:
            return .waitingMigration
        case .failed(let message):
            return .failed(message)
        case .legacyServiceRunning:
            return .legacy
        case .portBusy(let message):
            return .portBusy(message)
        }
    }
}

struct StatusOverlay: View {
    enum Kind {
        case loading(String)
        case failed(String)
        case legacy
        case portBusy(String)
        case waitingMigration
    }

    let kind: Kind

    var body: some View {
        ZStack {
            Color(nsColor: .windowBackgroundColor)
            VStack(spacing: 16) {
                content
            }
            .padding(32)
            .frame(maxWidth: 560)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch kind {
        case .loading(let text):
            ProgressView().controlSize(.large)
            Text(text).font(.title3)
        case .failed(let message):
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 40)).foregroundStyle(.orange)
            Text("Le serveur a un problème").font(.title2.bold())
            Text(message).multilineTextAlignment(.center).foregroundStyle(.secondary)
            HStack {
                Button("Voir le journal") { AppActions.shared.openLog() }
                Button("Réessayer maintenant") { AppActions.shared.retryStart() }.buttonStyle(.borderedProminent)
            }
        case .legacy:
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 40)).foregroundStyle(.orange)
            Text("L'ancien Show lumière tourne encore").font(.title2.bold())
            if MigrationManager.shared.needsMigration {
                Text("Il utilise déjà le port 8321 et tes appairages. Je peux le mettre en pause, sauvegarder tes données et les reprendre ici, sans rien réappairer.")
                    .multilineTextAlignment(.center).foregroundStyle(.secondary)
                Button("Reprendre mes données…") { MigrationManager.shared.show() }.buttonStyle(.borderedProminent)
            } else {
                Text("Il utilise le port 8321. Je peux l'arrêter (sans le supprimer) pour que cette app prenne le relais.")
                    .multilineTextAlignment(.center).foregroundStyle(.secondary)
                Button("Arrêter l'ancien service et continuer") { MigrationManager.shared.stopLegacyAndStart() }.buttonStyle(.borderedProminent)
            }
        case .portBusy(let message):
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 40)).foregroundStyle(.orange)
            Text("Le port 8321 est occupé").font(.title2.bold())
            Text(message).multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("Réessayer") { AppActions.shared.retryStart() }.buttonStyle(.borderedProminent)
        case .waitingMigration:
            Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 40)).foregroundStyle(.secondary)
            Text("Migration en attente").font(.title2.bold())
            Text("Je n'ai pas encore repris tes données de l'ancien Show lumière. Tant que ce n'est pas fait, le serveur ne démarre pas (pour ne rien réappairer par erreur).")
                .multilineTextAlignment(.center).foregroundStyle(.secondary)
            Button("Reprendre mes données…") { MigrationManager.shared.show() }.buttonStyle(.borderedProminent)
        }
    }
}
