import Foundation
import Security
import UIKit

struct APIError: LocalizedError {
    let status: Int
    let message: String

    var errorDescription: String? { message }
}

/// The site's JSON API (`/api/v1`) and passkey endpoint, authenticated with a
/// bearer token kept in the Keychain.
@Observable
final class APIClient {
    /// Production, unless a debug run passes `-AfterwordServer http://localhost:5199`.
    let server: URL
    private(set) var token: String?

    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    init() {
        #if DEBUG
        let override = UserDefaults.standard.string(forKey: "AfterwordServer").flatMap(URL.init(string:))
        server = override ?? URL(string: "https://afterword.max1874.com")!
        #else
        server = URL(string: "https://afterword.max1874.com")!
        #endif
        token = Keychain.read(account: server.host() ?? "")
    }

    var isSignedIn: Bool { token != nil }

    func setToken(_ token: String?) {
        self.token = token
        Keychain.write(token, account: server.host() ?? "")
        if token == nil { responses.clear() }
    }

    /// A site path (`/covers/…`, `/@max`) or absolute URL as a URL on this server.
    func url(for path: String) -> URL? {
        if path.hasPrefix("http://") || path.hasPrefix("https://") { return URL(string: path) }
        return URL(string: path, relativeTo: server)?.absoluteURL
    }

    func api<T: Decodable>(_ method: String, _ path: String, body: Any? = nil, as type: T.Type = T.self) async throws -> T {
        let data = try await send(method, "/api/v1/\(path)", body: body)
        let value = try decoder.decode(T.self, from: data)
        if method == "GET" { responses.store(data, for: path) }
        return value
    }

    /// The last response to a GET, so screens can show it at once while they refresh:
    /// every request crosses the Pacific to Cloudflare and takes about a second.
    func cached<T: Decodable>(_ path: String, as type: T.Type = T.self) -> T? {
        responses.data(for: path).flatMap { try? decoder.decode(T.self, from: $0) }
    }

    private let responses = ResponseCache()

    func api(_ method: String, _ path: String, body: Any? = nil) async throws {
        _ = try await send(method, "/api/v1/\(path)", body: body)
    }

    /// The passkey endpoint the web uses; `client: "app"` returns tokens in the body.
    func passkey(_ body: [String: Any]) async throws -> [String: Any] {
        var body = body
        body["client"] = "app"
        let data = try await send("POST", "/auth/passkey", body: body)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    /// Covers are immutable, so they stay on disk across launches.
    private let imageSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = URLCache(memoryCapacity: 32 << 20, diskCapacity: 400 << 20)
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        return URLSession(configuration: configuration)
    }()

    /// Raw bytes with the session attached, for covers behind sign-in.
    func data(from url: URL) async throws -> Data {
        var request = URLRequest(url: url)
        if let token, url.host() == server.host() { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await imageSession.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return data
    }

    private func send(_ method: String, _ path: String, body: Any?) async throws -> Data {
        // Callers escape their own path segments and queries.
        guard let url = URL(string: path, relativeTo: server)?.absoluteURL else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        // Header values are Latin-1; settings pages turn this into "iPhone · 后记 App".
        request.setValue("Afterword-iOS/\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? "") (\(UIDevice.current.model); iOS \(UIDevice.current.systemVersion))", forHTTPHeaderField: "User-Agent")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            if status == 401, token != nil, path.hasPrefix("/api/v1/") { setToken(nil) }
            throw APIError(status: status, message: message ?? "请求失败（HTTP \(status)）")
        }
        return data
    }
}

/// GET responses by path, in memory and in the Caches directory.
final class ResponseCache {
    private var memory: [String: Data] = [:]
    private let directory = URL.cachesDirectory.appending(path: "api", directoryHint: .isDirectory)

    func data(for path: String) -> Data? {
        if let data = memory[path] { return data }
        let data = try? Data(contentsOf: file(for: path))
        memory[path] = data
        return data
    }

    func store(_ data: Data, for path: String) {
        memory[path] = data
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: file(for: path), options: .atomic)
    }

    func clear() {
        memory = [:]
        try? FileManager.default.removeItem(at: directory)
    }

    private func file(for path: String) -> URL {
        directory.appending(path: Data(path.utf8).base64URL)
    }
}

enum Keychain {
    private static let service = "com.max1874.afterword.session"

    static func read(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ value: String?, account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        guard let value else { return }
        var item = query
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }
}
