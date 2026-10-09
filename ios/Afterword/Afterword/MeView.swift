import SwiftUI

/// 我的: who you are and what you have marked, the everyday actions, and the account
/// settings one level down (账号与安全), like other apps' Me tab.
struct MeView: View {
    @Environment(AppModel.self) private var model
    @State private var profile: Profile?
    @State private var showImport = false
    @State private var confirmSignOut = false
    @State private var error: String?

    var body: some View {
        List {
            if let me = model.me {
                Section {
                    // Read here, not inside the row, so the numbers update when they arrive.
                    MeHeader(me: me, profile: profile)
                }
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 8, trailing: 4))

                Section {
                    if let page = model.api.url(for: "/@\(me.handle)") {
                        ShareLink(item: page) { Label("分享我的主页", systemImage: "square.and.arrow.up") }
                    }
                    Button { showImport = true } label: { Label("导入标记", systemImage: "tray.and.arrow.down") }
                }

                Section {
                    Toggle(isOn: Binding(get: { me.usesRatings }, set: { on in Task { await saveRatings(on) } })) {
                        Label("星级评分", systemImage: "star")
                    }
                    // The app's ink tint would make the switch white on white in dark mode.
                    .tint(Color(uiColor: .systemGreen))
                } footer: {
                    Text("关掉后，你的页面和标记表单都不再显示星级；已有的评分会保留。")
                }

                Section {
                    NavigationLink { AccountView() } label: { Label("账号与安全", systemImage: "lock.shield") }
                    if me.isAdmin {
                        NavigationLink { InvitesView() } label: { Label("邀请朋友", systemImage: "person.badge.plus") }
                    }
                }

                if let error {
                    Text(error).foregroundStyle(Color.danger)
                }

                Section {
                    Button("退出登录", role: .destructive) { confirmSignOut = true }
                        .frame(maxWidth: .infinity)
                } footer: {
                    Text("后记 \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")")
                        .frame(maxWidth: .infinity)
                        .padding(.top, 8)
                }
            }
        }
        .foregroundStyle(Color.ink)
        .navigationTitle("我的")
        .refreshable { await load() }
        .task(id: "\(model.me?.handle ?? "")|\(model.marksVersion)") { await load() }
        .sheet(isPresented: $showImport) {
            NavigationStack { ImportView() }
        }
        .confirmationDialog("退出登录？", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) { Task { await model.signOut() } }
        }
    }

    private func load() async {
        guard let me = model.me else { return }
        if profile == nil { profile = model.api.cached("users/\(me.handle)") }
        do {
            let fetched: Profile = try await model.api.api("GET", "users/\(me.handle)")
            profile = fetched
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func saveRatings(_ on: Bool) async {
        error = nil
        do {
            try await model.api.api("PATCH", "preferences", body: ["ratings": on])
            await model.loadMe()
            model.marksVersion += 1
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// The avatar, name and handle, then how many works of each kind are done; each number opens them in the library.
private struct MeHeader: View {
    @Environment(AppModel.self) private var model
    let me: Me
    let profile: Profile?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                Avatar(name: me.name, size: 60)
                VStack(alignment: .leading, spacing: 2) {
                    Text(me.name).font(.title2.bold())
                    Text("@\(me.handle)").font(.subheadline).foregroundStyle(Color.muted)
                }
            }
            HStack(spacing: 0) {
                ForEach(Kind.allCases) { kind in
                    Button {
                        // Opens what these numbers count, in the library.
                        model.libraryPath = [.library(handle: me.handle, kind: kind, status: .done)]
                        model.tab = .library
                    } label: {
                        VStack(spacing: 3) {
                            Text("\(profile?.total(kind: kind, status: .done) ?? 0)")
                                .font(.title2.bold())
                                .monospacedDigit()
                            Text("\(kind.label) · \(Status.done.label(for: kind))")
                                .font(.caption)
                                .foregroundStyle(Color.muted)
                        }
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 14)
            .background(RoundedRectangle(cornerRadius: 16).fill(Color.card))
        }
    }
}

/// A round initial, as on the web's header.
struct Avatar: View {
    let name: String
    let size: CGFloat

    var body: some View {
        Circle()
            .fill(Color.ink)
            .frame(width: size, height: size)
            .overlay {
                Text(name.first.map { String($0).uppercased() } ?? "")
                    .font(.system(size: size * 0.42, weight: .semibold))
                    .foregroundStyle(Color.paper)
            }
    }
}

/// 账号与安全: name and handle, passkeys, signed-in devices and recovery codes.
struct AccountView: View {
    @Environment(AppModel.self) private var model
    @State private var settings: AccountSettings?
    @State private var name = ""
    @State private var handle = ""
    @State private var profileMessage: String?
    @State private var error: String?
    @State private var busy = false
    @State private var confirm: Confirm?

    enum Confirm: Identifiable {
        case regenerate, signOutOthers
        var id: Self { self }
    }

    var body: some View {
        Form {
            profileSection
            if let settings {
                passkeySection(settings)
                sessionSection(settings)
                recoverySection(settings)
            }
            if let error {
                Text(error).foregroundStyle(Color.danger)
            }
        }
        .navigationTitle("账号与安全")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .confirmationDialog(confirmTitle, isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible, presenting: confirm) { which in
            switch which {
            case .regenerate: Button("生成新的恢复码", role: .destructive) { Task { await regenerate() } }
            case .signOutOthers: Button("退出其他所有设备", role: .destructive) { Task { await perform { try await model.api.api("POST", "sessions/sign-out-others") } } }
            }
        }
    }

    private var confirmTitle: String {
        switch confirm {
        case .regenerate: "旧的恢复码会全部失效。"
        case .signOutOthers: "除了这台设备，其他设备都会退出登录。"
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
            model.homePath = []
            model.libraryPath = []
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

/// 邀请朋友: one-time links that each create one account; admins only.
struct InvitesView: View {
    @Environment(AppModel.self) private var model
    @State private var settings: AccountSettings?
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        Form {
            if let invites = settings?.invites { inviteSection(invites) }
            if let error {
                Text(error).foregroundStyle(Color.danger)
            }
        }
        .navigationTitle("邀请朋友")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
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

    private func load() async {
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
}
