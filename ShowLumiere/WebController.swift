import AppKit
import WebKit

/// Évite qu'un WKUserContentController garde le contrôleur en vie (sinon la page resterait connectée au serveur).
@MainActor
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

/// La page du show (http://127.0.0.1:8321) dans un WKWebView : boîtes de dialogue, import / export, micro, liens externes.
@MainActor
final class WebController: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    let webView: WKWebView
    @Published private(set) var hasLoadedOnce = false

    private let server: ServerManager
    private var observerId: UUID?
    private var lastLoad = Date.distantPast

    private static let bridgeScript = """
    window.ShowLumiereApp = {
      isApp: true,
      post: function (message) { window.webkit.messageHandlers.showlumiere.postMessage(message); },
      createShow: function (prompt) { window.webkit.messageHandlers.showlumiere.postMessage({ action: 'createShow', prompt: prompt || '' }); },
      openLog: function () { window.webkit.messageHandlers.showlumiere.postMessage({ action: 'openLog' }); }
    };
    """

    init(server: ServerManager) {
        self.server = server
        let config = WKWebViewConfiguration()
        let content = WKUserContentController()
        config.userContentController = content
        config.websiteDataStore = WKWebsiteDataStore.default()
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        content.add(WeakScriptHandler(self), name: "showlumiere")
        content.addUserScript(WKUserScript(source: WebController.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isInspectable = true // clic droit › Inspecter l'élément (utile pour dépanner)
        observerId = server.addObserver { [weak self] in
            self?.serverChanged()
        }
        serverChanged()
    }

    /// Arrête la page (et sa connexion au serveur) quand la fenêtre se ferme.
    func teardown() {
        if let id = observerId { server.removeObserver(id) }
        observerId = nil
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "showlumiere")
        webView.loadHTMLString("", baseURL: nil)
    }

    private func serverChanged() {
        guard server.phase == .running, !hasLoadedOnce, !webView.isLoading else { return }
        if Date().timeIntervalSince(lastLoad) < 1.5 { return }
        load()
    }

    func load() {
        lastLoad = Date()
        webView.load(URLRequest(url: Paths.baseURL))
    }

    func reload() {
        if webView.url == nil { load() } else { webView.reload() }
    }

    func zoom(by delta: CGFloat) {
        webView.pageZoom = min(3.0, max(0.5, webView.pageZoom + delta))
    }

    func resetZoom() {
        webView.pageZoom = 1.0
    }

    /// Envoie un message à la page : window.addEventListener('showlumiere-app', e => e.detail)
    func sendToPage(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('showlumiere-app', { detail: \(json) }));", completionHandler: nil)
    }

    // MARK: - pont JavaScript (étape 2 : « ✨ Créer un show »)

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "createShow":
            AppActions.shared.createShowRequested(prompt: body["prompt"] as? String)
        case "openLog":
            AppActions.shared.openLog()
        default:
            AppLog.write("Message inconnu de la page : \(action)")
        }
    }

    // MARK: - navigation

    private func isInternal(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return (host == "127.0.0.1" || host == "localhost") && (url.port == nil || url.port == Paths.port)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        let scheme = (url.scheme ?? "").lowercased()
        if isInternal(url) || scheme == "about" || scheme == "blob" || scheme == "data" {
            decisionHandler(.allow)
            return
        }
        if scheme == "showlumiere" {
            AppActions.shared.handle(url: url)
        } else if scheme == "http" || scheme == "https" || scheme == "mailto" {
            NSWorkspace.shared.open(url) // les liens externes s'ouvrent dans le navigateur
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hasLoadedOnce = true
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        noteLoadFailure(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        noteLoadFailure(error)
    }

    private func noteLoadFailure(_ error: Error) {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        if ns.domain == "WebKitErrorDomain" && ns.code == 102 { return } // navigation interrompue (lien externe, téléchargement)
        AppLog.write("Chargement de la page impossible : \(error.localizedDescription)")
        // le prochain changement d'état du serveur (toutes les 2 s) relance le chargement
    }

    // MARK: - fenêtres de dialogue de la page (alert, confirm, prompt) : indispensables, sinon confirm() répond « non »

    private func present(_ alert: NSAlert, completion: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window = webView.window {
            alert.beginSheetModal(for: window, completionHandler: completion)
        } else {
            completion(alert.runModal())
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = Paths.displayName
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        present(alert) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = Paths.displayName
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Annuler")
        present(alert) { response in completionHandler(response == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = Paths.displayName
        alert.informativeText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Annuler")
        present(alert) { response in completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    /// « Importer » un show (.json) : le sélecteur de fichier de la page.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        if let window = webView.window {
            panel.beginSheetModal(for: window) { result in
                completionHandler(result == .OK ? panel.urls : nil)
            }
        } else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
        }
    }

    /// Micro (calage du tempo) : accordé seulement à la page locale du show.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let local = (origin.host == "127.0.0.1" || origin.host == "localhost") && origin.port == Paths.port
        decisionHandler(local && type == .microphone ? .grant : .deny)
    }

    /// Liens qui s'ouvrent dans une nouvelle fenêtre (target="_blank") : navigateur du Mac.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isInternal(url) {
                webView.load(navigationAction.request)
            } else if url.scheme == "showlumiere" {
                AppActions.shared.handle(url: url)
            } else {
                NSWorkspace.shared.open(url)
            }
        }
        return nil
    }

    // MARK: - « Exporter » un show : téléchargement

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.canCreateDirectories = true
        let finish: (NSApplication.ModalResponse) -> Void = { result in
            guard result == .OK, let url = panel.url else {
                completionHandler(nil)
                return
            }
            // le téléchargement exige un fichier qui n'existe pas : l'ancien (déjà confirmé « remplacer ») va à la corbeille
            if FileManager.default.fileExists(atPath: url.path) { try? Files.trash(url) }
            completionHandler(url)
        }
        if let window = webView.window {
            panel.beginSheetModal(for: window, completionHandler: finish)
        } else {
            finish(panel.runModal())
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        showAlert("Téléchargement impossible", error.localizedDescription, style: .warning)
    }
}
