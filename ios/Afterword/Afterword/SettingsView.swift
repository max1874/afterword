import SwiftUI

/// Profile, passkeys, devices, recovery codes and invites, as on the web's settings page.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var settings: AccountSettings?
    @State private var name = ""
    @State private var handle = ""
    @State private var profileMessage: String?
    @State private var error: String?
    @State private var busy = false
    @State private var confirm: Confirm?

    enum Confirm: Identifiable {
        case regenerate, signOutOthers, signOut
        var id: Self { self }
    }

    var body: some View {
        Form {
            profileSection
            if let settings {
                passkeySection(settings)
                sessionSection(settings)
                recoverySection(settings)
                if let invites = settings.invites { inviteSection(invites) }
            }
            if let error {
                Text(error).foregroundStyle(Color.danger)
            }
            Section {
                Button("退出登录", role: .destructive) { confirm = .signOut }
            }
        }
        .navigationTitle("设置")
        .refreshable { await load() }
        .task { await load() }
        .confirmationDialog(confirmTitle, isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible, presenting: confirm) { which in
            switch which {
            case .regenerate: Button("生成新的恢复码", role: .destructive) { Task { await regenerate() } }
            case .signOutOthers: Button("退出其他所有设备", role: .destructive) { Task { await perform { try await model.api.api("POST", "sessions/sign-out-others") } } }
            case .signOut: Button("退出登录", role: .destructive) { Task { await model.signOut() } }
            }
        }
    }

    private var confirmTitle: String {
        switch confirm {
        case .regenerate: "旧的恢复码会全部失效。"
        case .signOutOthers: "除了这台设备，其他设备都会退出登录。"
        case .signOut: "退出登录？"
        case nil: ""
        }
    }

    private var profileSection: some View {
        Section {
            LabeledContent("名字") {
                TextField("名字", text: $name).multilineTextAlignment(.trailing)
            }
            LabeledContent("用户名") {
                TextField("用户名", text: $handle)
                    .multilineTextAlignment(.trailing)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            Button("保存") { Task { await saveProfile() } }
                .disabled(busy || (name == model.me?.name && handle == model.me?.handle))
            if let profileMessage { Text(profileMessage).font(.footnote).foregroundStyle(Color.muted) }
        } header: {
            Text("个人资料")
        } footer: {
            Text("主页地址是 \(model.api.server.host() ?? "")/@\(model.me?.handle ?? "")，改用户名后旧地址会失效。")
        }
    }

    private func passkeySection(_ settings: AccountSettings) -> some View {
        Section("通行密钥") {
            ForEach(settings.passkeys) { passkey in
                VStack(alignment: .leading, spacing: 2) {
                    Text(passkey.name ?? "通行密钥")
                    Text("添加于 \(shortDate(passkey.createdAt))\(passkey.lastUsedAt.map { " · 上次使用 \(shortDate($0))" } ?? "")")
                        .font(.footnote)
                        .foregroundStyle(Color.muted)
                }
                .swipeActions {
                    if settings.passkeys.count > 1 {
                        Button("删除", role: .destructive) {
                            Task { await perform { try await model.api.api("DELETE", "passkeys/\(passkey.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? passkey.id)") } }
                        }
                    }
                }
            }
            Button("＋ 添加通行密钥") {
                Task {
                    await perform {
                        do { try await model.addPasskey() } catch PasskeyFailure.canceled {}
                    }
                }
            }
        }
    }

    private func sessionSection(_ settings: AccountSettings) -> some View {
        Section("登录的设备") {
            ForEach(settings.sessions) { session in
                VStack(alignment: .leading, spacing: 2) {
                    Text(deviceName(session.userAgent) + (session.current ? "（这台设备）" : ""))
                    Text("登录于 \(shortDate(session.createdAt)) · 最近 \(shortDate(session.lastSeenAt))")
                        .font(.footnote)
                        .foregroundStyle(Color.muted)
                }
                .swipeActions {
                    if !session.current {
                        Button("退出", role: .destructive) {
                            Task { await perform { try await model.api.api("DELETE", "sessions/\(session.id)") } }
                        }
                    }
                }
            }
            if settings.sessions.count > 1 {
                Button("退出其他所有设备", role: .destructive) { confirm = .signOutOthers }
            }
        }
    }

    private func recoverySection(_ settings: AccountSettings) -> some View {
        Section {
            Button("生成新的恢复码") { confirm = .regenerate }
        } header: {
            Text("恢复码")
        } footer: {
            Text("还剩 \(settings.recoveryLeft) 个可用。通行密钥所在的设备都丢了时，用恢复码加用户名登录。")
        }
    }

    private func inviteSection(_ invites: [Invite]) -> some View {
        Section {
            ForEach(invites) { invite in
                VStack(alignment: .leading, spacing: 4) {
                    if invite.usedAt != nil {
                        Text(invite.usedHandle.map { "@\($0) 已加入" } ?? "已使用").foregroundStyle(Color.muted)
                    } else {
                        ShareLink(item: invite.url) { Text(invite.url).font(.footnote.monospaced()).lineLimit(1) }
                        Text("\(shortDate(invite.expiresAt)) 前有效，只能用一次").font(.footnote).foregroundStyle(Color.muted)
                    }
                }
                .swipeActions {
                    if invite.usedAt == nil {
                        Button("撤销", role: .destructive) {
                            Task { await perform { try await model.api.api("DELETE", "invites/\(invite.code)") } }
                        }
                    }
                }
            }
            Button("生成邀请链接") {
                Task { await perform { let _: CreatedInvite = try await model.api.api("POST", "invites") } }
            }
        } header: {
            Text("邀请")
        } footer: {
            Text("每个链接 14 天内有效，只能注册一个账号。")
        }
    }

    /// Same wording as the web's settings page: "iPhone · Safari", "iPhone · 后记 App".
    private func deviceName(_ userAgent: String?) -> String {
        guard let ua = userAgent else { return "未知设备" }
        let system = ua.contains("iPhone") ? "iPhone" : ua.contains("iPad") ? "iPad" : ua.contains("Android") ? "Android"
            : ua.contains("Mac OS X") ? "Mac" : ua.contains("Windows") ? "Windows" : ua.contains("Linux") ? "Linux" : "未知系统"
        let browser = ua.hasPrefix("Afterword-iOS/") ? "后记 App" : ua.contains("Edg/") ? "Edge" : ua.contains("Firefox/") ? "Firefox"
            : ua.contains("Chrome/") ? "Chrome" : ua.contains("Safari/") ? "Safari" : "浏览器"
        return "\(system) · \(browser)"
    }

    private func load() async {
        if let me = model.me, name.isEmpty, handle.isEmpty {
            name = me.name
            handle = me.handle
        }
        if settings == nil { settings = model.api.cached("settings") }
        do {
            settings = try await model.api.api("GET", "settings")
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func perform(_ action: () async throws -> Void) async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await action()
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func saveProfile() async {
        await perform {
            let saved: SavedProfile = try await model.api.api("PATCH", "profile", body: ["name": name, "handle": handle])
            name = saved.name
            handle = saved.handle
            await model.loadMe()
            model.minePath = []
            profileMessage = "已保存"
        }
    }

    private func regenerate() async {
        await perform {
            let codes: RecoveryCodes = try await model.api.api("POST", "recovery-codes")
            model.freshRecoveryCodes = codes.codes
        }
    }
}
