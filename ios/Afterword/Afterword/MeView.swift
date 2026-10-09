import PhotosUI
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
                    MeHeader(me: me, profile: profile, error: $error)
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

/// The avatar, name and handle with 编辑资料, then how many works of each kind are done;
/// each number opens them in the library. Like Instagram's or 小红书's profile header, the
/// avatar carries no badge: editing has its own button, and tapping the avatar is a shortcut.
private struct MeHeader: View {
    @Environment(AppModel.self) private var model
    let me: Me
    let profile: Profile?
    @Binding var error: String?

    @State private var editing = false
    @State private var avatarMenu = false
    @State private var uploading = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                Button { avatarMenu = true } label: {
                    Avatar(name: me.name, path: me.avatar, size: 64)
                        .overlay { if uploading { Circle().fill(.black.opacity(0.35)).overlay(ProgressView().tint(.white)) } }
                }
                .buttonStyle(.plain)
                .disabled(uploading)
                .accessibilityLabel("更换头像")
                VStack(alignment: .leading, spacing: 2) {
                    Text(me.name).font(.title2.bold()).lineLimit(1)
                    Text("@\(me.handle)").font(.subheadline).foregroundStyle(Color.muted)
                }
                Spacer(minLength: 8)
                Button("编辑资料") { editing = true }
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    // The colour of the list's rows: Color.card is the grey of the page behind them.
                    .background(Capsule().fill(Color(uiColor: .secondarySystemGroupedBackground)))
                    .buttonStyle(.plain)
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
            .background(RoundedRectangle(cornerRadius: 16).fill(Color(uiColor: .secondarySystemGroupedBackground)))
        }
        .avatarMenu(isPresented: $avatarMenu, uploading: $uploading, error: $error)
        .sheet(isPresented: $editing) { NavigationStack { EditProfileView() } }
        #if DEBUG
        .onAppear {
            if model.debugSheet == "editProfile" {
                model.debugSheet = nil
                editing = true
            }
        }
        #endif
    }
}

/// 编辑资料: the photo large with 更换头像 under it, then name and handle, like the edit
/// pages of Instagram and Apple's own contact card.
struct EditProfileView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var handle = ""
    @State private var avatarMenu = false
    @State private var uploading = false
    @State private var saving = false
    @State private var error: String?

    private var changed: Bool { name != model.me?.name || handle != model.me?.handle }

    var body: some View {
        Form {
            Section {
                VStack(spacing: 10) {
                    Button { avatarMenu = true } label: {
                        Avatar(name: model.me?.name ?? name, path: model.me?.avatar, size: 96)
                            .overlay { if uploading { Circle().fill(.black.opacity(0.35)).overlay(ProgressView().tint(.white)) } }
                    }
                    .buttonStyle(.plain)
                    Button(model.me?.avatar == nil ? "添加头像" : "更换头像") { avatarMenu = true }
                        .font(.subheadline.weight(.medium))
                        .buttonStyle(.plain)
                        .foregroundStyle(Color.ink)
                }
                .disabled(uploading)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
            }
            .listRowBackground(Color.clear)

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
            } footer: {
                Text("主页地址是 \(model.api.server.host() ?? "")/@\(model.me?.handle ?? "")，改用户名后旧地址会失效。")
            }

            if let error {
                Text(error).foregroundStyle(Color.danger)
            }
        }
        .navigationTitle("编辑资料")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("保存") { Task { await save() } }.disabled(saving || !changed || name.isEmpty || handle.isEmpty)
            }
        }
        .avatarMenu(isPresented: $avatarMenu, uploading: $uploading, error: $error)
        .onAppear {
            if let me = model.me, name.isEmpty, handle.isEmpty {
                name = me.name
                handle = me.handle
            }
        }
    }

    private func save() async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            let _: SavedProfile = try await model.api.api("PATCH", "profile", body: ["name": name, "handle": handle])
            await model.loadMe()
            model.homePath = []
            model.libraryPath = []
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

extension View {
    /// 从相册选择 / 移除头像, and the upload once a photo is picked.
    func avatarMenu(isPresented: Binding<Bool>, uploading: Binding<Bool>, error: Binding<String?>) -> some View {
        modifier(AvatarMenu(isPresented: isPresented, uploading: uploading, error: error))
    }
}

private struct AvatarMenu: ViewModifier {
    @Environment(AppModel.self) private var model
    @Binding var isPresented: Bool
    @Binding var uploading: Bool
    @Binding var error: String?

    @State private var picking = false
    @State private var photo: PhotosPickerItem?

    func body(content: Content) -> some View {
        content
            .confirmationDialog("头像", isPresented: $isPresented) {
                Button("从相册选择") { picking = true }
                if model.me?.avatar != nil {
                    Button("移除头像", role: .destructive) { Task { await remove() } }
                }
            }
            .photosPicker(isPresented: $picking, selection: $photo, matching: .images)
            .onChange(of: photo) { _, item in
                guard let item else { return }
                Task { await upload(item) }
            }
    }

    /// A square crop of the photo, 512px, as JPEG: small enough to load at once everywhere.
    private func upload(_ item: PhotosPickerItem) async {
        uploading = true
        error = nil
        defer {
            uploading = false
            photo = nil
        }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), let picked = UIImage(data: data) else {
                throw APIError(status: 0, message: "读不出这张照片")
            }
            let side = min(picked.size.width, picked.size.height)
            let crop = CGRect(x: (picked.size.width - side) / 2, y: (picked.size.height - side) / 2, width: side, height: side)
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let square = UIGraphicsImageRenderer(size: CGSize(width: 512, height: 512), format: format).image { _ in
                picked.draw(in: CGRect(x: -crop.minX * 512 / side, y: -crop.minY * 512 / side, width: picked.size.width * 512 / side, height: picked.size.height * 512 / side))
            }
            guard let jpeg = square.jpegData(compressionQuality: 0.85) else { throw APIError(status: 0, message: "照片转换失败") }
            try await model.api.upload("PUT", "avatar", data: jpeg, contentType: "image/jpeg")
            await model.loadMe()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func remove() async {
        uploading = true
        error = nil
        defer { uploading = false }
        do {
            try await model.api.api("DELETE", "avatar")
            await model.loadMe()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// A person's photo, or the initial of their name, as on the web's header.
struct Avatar: View {
    @Environment(AppModel.self) private var model
    let name: String
    let path: String?
    let size: CGFloat

    @State private var image: UIImage?

    var body: some View {
        Circle()
            .fill(Color.ink)
            .frame(width: size, height: size)
            .overlay {
                if path != nil, let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Text(name.first.map { String($0).uppercased() } ?? "")
                        .font(.system(size: size * 0.42, weight: .semibold))
                        .foregroundStyle(Color.paper)
                }
            }
            .clipShape(Circle())
            .task(id: path) { image = await CoverImage.image(for: path, api: model.api, maxPixels: 300) }
    }
}

/// 账号与安全: passkeys, signed-in devices and recovery codes. Name, handle and photo are in 编辑资料.
struct AccountView: View {
    @Environment(AppModel.self) private var model
    @State private var settings: AccountSettings?
    @State private var error: String?
    @State private var busy = false
    @State private var confirm: Confirm?

    enum Confirm: Identifiable {
        case regenerate, signOutOthers
        var id: Self { self }
    }

    var body: some View {
        Form {
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

    private func regenerate() async {
        await perform {
            let codes: RecoveryCodes = try await model.api.api("POST", "recovery-codes")
            model.freshRecoveryCodes = codes.codes
        }
    }
}
