import Foundation
import Observation

/// Pages reachable by navigation and by universal links (`/@handle`, `/@handle/items/:id`).
enum Route: Hashable {
    case profile(String)
    case item(handle: String, id: String)

    init?(url: URL) {
        let parts = url.pathComponents.filter { $0 != "/" }
        guard let first = parts.first, first.hasPrefix("@"), first.count > 1 else { return nil }
        let handle = String(first.dropFirst()).lowercased()
        if parts.count == 1 { self = .profile(handle); return }
        if parts.count == 3, parts[1] == "items" { self = .item(handle: handle, id: parts[2]); return }
        return nil
    }
}

enum AppTab: Hashable {
    case mine, add, settings
}

/// Who is signed in, and the sign-in flows.
@Observable
final class AppModel {
    let api = APIClient()
    private let passkeys = Passkeys()

    var me: Me?
    var tab: AppTab = .mine
    var minePath: [Route] = []
    /// Bumped whenever marks change, so lists reload.
    var marksVersion = 0
    /// Marked items seen in lists, by `handle/id`, so item pages open without waiting.
    var knownItems: [String: MarkedItem] = [:]
    /// Recovery codes from joining or regenerating, shown once over everything.
    var freshRecoveryCodes: [String]?
    #if DEBUG
    /// A query the 记一笔 tab searches on launch, for runs without a keyboard.
    var debugSearch: String?
    #endif

    var signedIn: Bool { api.isSignedIn }

    var loadError: String?

    func loadMe() async {
        guard api.isSignedIn else { return }
        loadError = nil
        // Open on the last known account instead of a spinner; the request below confirms it.
        if me == nil { me = api.cached("me") }
        do {
            me = try await api.api("GET", "me")
        } catch {
            // A 401 already signed the app out; anything else gets a retry unless we can carry on.
            if me == nil { loadError = error.localizedDescription }
        }
    }

    func signInWithPasskey() async throws {
        let start = try await api.passkey(["step": "login-options"])
        guard let options = start["options"] as? [String: Any], let ceremony = start["ceremony"] as? String else {
            throw APIError(status: 0, message: "登录请求无效")
        }
        let response = try await passkeys.assert(options: options)
        let result = try await api.passkey(["step": "login-verify", "ceremony": ceremony, "response": response])
        try await finishSignIn(result["token"] as? String)
    }

    func signInWithRecoveryCode(handle: String, code: String) async throws {
        struct Result: Decodable { let token: String }
        let result: Result = try await api.api("POST", "auth/recovery", body: ["handle": handle, "code": code])
        try await finishSignIn(result.token)
        // Like the web, land where a passkey for this device can be added.
        tab = .settings
    }

    /// Creates an account from an invite; returns the new recovery codes to show once.
    func join(invite: String, handle: String, name: String) async throws -> [String] {
        let start = try await api.passkey(["step": "join-options", "invite": invite, "handle": handle, "name": name])
        guard let options = start["options"] as? [String: Any], let ceremony = start["ceremony"] as? String else {
            throw APIError(status: 0, message: "注册请求无效")
        }
        let response = try await passkeys.register(options: options)
        let result = try await api.passkey(["step": "join-verify", "ceremony": ceremony, "response": response])
        try await finishSignIn(result["token"] as? String)
        return result["codes"] as? [String] ?? []
    }

    func addPasskey() async throws {
        let start = try await api.passkey(["step": "add-options"])
        guard let options = start["options"] as? [String: Any], let ceremony = start["ceremony"] as? String else {
            throw APIError(status: 0, message: "请求无效")
        }
        let response = try await passkeys.register(options: options)
        _ = try await api.passkey(["step": "add-verify", "ceremony": ceremony, "response": response])
    }

    func signOut() async {
        try? await api.api("POST", "auth/logout")
        api.setToken(nil)
        me = nil
        knownItems = [:]
        minePath = []
        tab = .mine
    }

    func open(_ url: URL) {
        guard let route = Route(url: url) else { return }
        tab = .mine
        minePath.append(route)
    }

    private func finishSignIn(_ token: String?) async throws {
        guard let token else { throw APIError(status: 0, message: "登录没有成功") }
        api.setToken(token)
        me = try await api.api("GET", "me")
    }
}
