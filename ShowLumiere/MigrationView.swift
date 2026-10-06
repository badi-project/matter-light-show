import SwiftUI

/// L'assistant « Reprendre mes données de l'ancien Show lumière ». Il s'affiche par-dessus la fenêtre du show.
struct MigrationView: View {
    @ObservedObject var migration: MigrationManager

    var body: some View {
        ZStack {
            Color(nsColor: .windowBackgroundColor)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    content
                }
                .padding(32)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch migration.step {
        case .intro:
            intro
        case .working:
            working
        case .verify:
            verify
        case .done(let text):
            done(text)
        case .rolledBack(let text):
            rolledBack(text)
        case .failed(let text):
            failed(text)
        }
    }

    // MARK: - 1. présentation

    private var intro: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Reprendre mes données de l'ancien Show lumière")
                .font(.title.bold())
                .fixedSize(horizontal: false, vertical: true)
            Text("Cette app remplace l'ancien Show lumière (le service qui démarre avec le Mac et la petite app). Tes lampes, tes appairages Hue et IKEA, tes shows et tes musiques sont repris tels quels : rien à réappairer.")
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 8) {
                Text("Ce que je vais faire, dans l'ordre :").font(.headline)
                bullet("1", "Mettre l'ancien Show lumière en pause (rien n'est supprimé).")
                bullet("2", "Faire une sauvegarde complète de tes données dans un fichier .zip, et la vérifier.")
                bullet("3", "Copier tes données dans la nouvelle app. L'ancien dossier « show-lumiere-matter » n'est jamais modifié.")
                bullet("4", "Démarrer le nouveau serveur et chercher tes lampes (21 d'habitude).")
                bullet("5", "Te laisser décider : si tout va bien, l'ancien démarrage automatique et l'ancienne app vont à la corbeille. Sinon, un clic remet tout comme avant.")
            }

            GroupBox {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("À copier :").foregroundStyle(.secondary)
                        Text(migration.dataSizeText.isEmpty ? "—" : migration.dataSizeText).bold()
                    }
                    Text("Dossier de la sauvegarde :").foregroundStyle(.secondary)
                    if let folder = migration.backupFolder {
                        Text(folder.path)
                            .font(.system(.body, design: .monospaced))
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text("Aucun disque T7 détecté : branche-le, ou choisis un autre dossier.")
                            .foregroundStyle(.orange)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Button("Choisir un autre dossier…") { migration.chooseBackupFolder() }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(4)
            }

            GroupBox {
                VStack(alignment: .leading, spacing: 6) {
                    Text("macOS peut te poser des questions pendant la migration").font(.headline)
                    Text("Clique « Autoriser » (ou « OK ») à chaque fois : accès au disque amovible (le T7), réseau local (pour retrouver les lampes), Bluetooth, et contrôle de Musique ou Spotify. Sans ces autorisations, certaines fonctions ne marcheraient pas.")
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(4)
            }

            HStack {
                Button("Plus tard") { migration.hide() }
                Spacer()
                Button("Commencer la migration") { migration.startMigration() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(migration.backupFolder == nil)
            }
        }
    }

    private func bullet(_ number: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(number).bold().frame(width: 16, alignment: .trailing)
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - 2. en cours

    private var working: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Migration en cours…").font(.title.bold())
            Text("Ne ferme pas l'app et ne débranche pas le T7 pendant ce temps (quelques dizaines de secondes).")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(migration.items) { item in
                row(item)
            }
        }
    }

    private func row(_ item: MigrationManager.Item) -> some View {
        HStack(alignment: .top, spacing: 10) {
            icon(for: item.state)
                .frame(width: 20, height: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.body.weight(.medium))
                if !item.detail.isEmpty {
                    Text(item.detail)
                        .font(.callout)
                        .foregroundStyle(item.state == .failed ? Color.red : Color.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    @ViewBuilder
    private func icon(for state: MigrationManager.ItemState) -> some View {
        switch state {
        case .waiting:
            Image(systemName: "circle").foregroundStyle(.secondary)
        case .running:
            ProgressView().controlSize(.small)
        case .done:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .failed:
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        }
    }

    // MARK: - 3. vérification : c'est toi qui décides

    private var verify: some View {
        let report = migration.liveReport
        return VStack(alignment: .leading, spacing: 16) {
            Text("Tout est copié. Vérifions ensemble.").font(.title.bold())

            GroupBox {
                VStack(alignment: .leading, spacing: 8) {
                    statusLine(ok: report.serverRunning,
                               good: "Le nouveau serveur tourne" + (report.version.map { " (version \($0))" } ?? ""),
                               bad: "Le serveur démarre…")
                    statusLine(ok: report.matterReady,
                               good: "Matter est prêt (Hue, IKEA)",
                               bad: report.matterError ?? "Matter n'est pas encore prêt")
                    statusLine(ok: report.lampsTotal > 0,
                               good: "\(report.lampsTotal) lampes trouvées, \(report.lampsReachable) joignables",
                               bad: "Aucune lampe trouvée pour l'instant")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(4)
            }

            if let backup = migration.backupFile {
                Text("Sauvegarde : \(backup.path)")
                    .font(.callout).foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if !(report.serverRunning && report.matterReady && report.lampsTotal > 0) {
                Text("Je n'ai pas (encore) trouvé toutes tes lampes. Laisse une minute à Matter ; si rien ne vient, choisis « Non, revenir à l'ancienne version » : tout sera remis comme avant.")
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text("Clique « Voir le show » pour contrôler comme d'habitude (lampes, musique, téléphone). Pour revenir à cet écran : icône de la barre des menus › « Terminer la migration ».")
                .fixedSize(horizontal: false, vertical: true)

            Text("« Oui » met à la corbeille l'ancien démarrage automatique et l'ancienne app « Show lumière.app ». L'ancien dossier « show-lumiere-matter » reste intact.")
                .font(.callout).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if migration.finalizing {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Un instant…")
                }
            } else {
                HStack {
                    Button("Non, revenir à l'ancienne version", role: .destructive) { migration.rollback() }
                    Spacer()
                    Button("Voir le show") { migration.hide() }
                    Button("Oui, tout fonctionne") { migration.confirmSuccess() }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                }
            }
        }
    }

    private func statusLine(ok: Bool, good: String, bad: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: ok ? "checkmark.circle.fill" : "clock")
                .foregroundStyle(ok ? Color.green : Color.orange)
            Text(ok ? good : bad).fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - 4. fin

    private func done(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 44)).foregroundStyle(.green)
            Text("Migration terminée").font(.title.bold())
            Text(text).fixedSize(horizontal: false, vertical: true)
            Text("Pour que Show lumière se lance tout seul avec le Mac : icône de la barre des menus › « Ouvrir au démarrage du Mac ».")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button("Ouvrir le show") { migration.hide() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
    }

    private func rolledBack(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: "arrow.uturn.backward.circle.fill").font(.system(size: 44)).foregroundStyle(.blue)
            Text("Retour à l'ancienne version").font(.title.bold())
            Text(text).fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Fermer") { migration.hide() }
                Button("Recommencer la migration") { migration.resetToIntro() }
                    .buttonStyle(.borderedProminent)
            }
        }
    }

    private func failed(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 44)).foregroundStyle(.orange)
            Text("La migration s'est arrêtée").font(.title.bold())
            Text(text).fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Voir le journal") { AppActions.shared.openAppLog() }
                Button("Fermer") { migration.hide() }
                Button("Réessayer") { migration.resetToIntro() }
                    .buttonStyle(.borderedProminent)
            }
        }
    }
}
