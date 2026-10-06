import Darwin
import Foundation

// MARK: - modèles (tout est facultatif : le serveur peut être plus ancien ou plus récent que l'app)

struct PingInfo: Decodable {
    var ok: Bool?
    var version: String?
    var service: String?
    var standby: Bool?
    var pid: Int?
    var pages: Int?
}

struct AppStatus: Decodable {
    struct Matter: Decodable {
        var ready: Bool?
        var error: String?
        var nodes: Int?
    }
    struct Lamps: Decodable {
        var total: Int?
        var reachable: Int?
    }
    struct Sync: Decodable {
        var enabled: Bool?
        var choice: String?
    }
    struct Player: Decodable {
        var playing: Bool?
        var showId: String?
        var showName: String?
    }
    struct Music: Decodable {
        var playing: Bool?
        var status: String?
        var title: String?
        var artist: String?
        var source: String?
    }

    var version: String?
    var service: String?
    var pid: Int?
    var standby: Bool?
    var matter: Matter?
    var lamps: Lamps?
    var sync: Sync?
    var player: Player?
    var music: Music?
    var pages: Int?
}

// MARK: - le port 8321 est-il pris ?

enum Probe {
    static func portIsOpen(_ port: Int = Paths.port) -> Bool {
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(UInt16(port).bigEndian)
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        if fd < 0 { return false }
        defer { close(fd) }
        let result = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { generic in
                connect(fd, generic, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return result == 0
    }
}

// MARK: - appels au serveur local (127.0.0.1:8321)

enum APIError: LocalizedError {
    case badURL
    case invalidResponse
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "Adresse invalide."
        case .invalidResponse: return "Réponse inattendue du serveur."
        case .http(_, let message): return message
        }
    }
}

enum API {
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.connectionProxyDictionary = [:] // jamais de proxy pour 127.0.0.1
        config.timeoutIntervalForRequest = 4
        config.timeoutIntervalForResource = 10
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    static func get<T: Decodable>(_ path: String, as type: T.Type, timeout: TimeInterval = 3) async throws -> T {
        let data = try await request("GET", path, body: nil, timeout: timeout)
        return try JSONDecoder().decode(T.self, from: data)
    }

    @discardableResult
    static func post(_ path: String, _ body: [String: Any] = [:], timeout: TimeInterval = 6) async throws -> Data {
        try await request("POST", path, body: body, timeout: timeout)
    }

    private static func request(_ method: String, _ path: String, body: [String: Any]?, timeout: TimeInterval) async throws -> Data {
        guard let url = URL(string: "http://127.0.0.1:\(Paths.port)\(path)") else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = timeout
        if let body = body {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            var message = "Erreur \(http.statusCode)"
            if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let text = object["error"] as? String {
                message = text
            }
            throw APIError.http(http.statusCode, message)
        }
        return data
    }
}
