import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var model
    @State private var busy = false
    @State private var error: String?
    @State private var sheet: Sheet?

    enum Sheet: String, Identifiable {
        case recovery, join
        var id: String { rawValue }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            Text("后记").font(.system(size: 48, weight: .semibold))
            Text("看过、读过、玩过的，都记在这里。")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Color.muted)
                .padding(.top, 8)
            Spacer()
            Text("后记用通行密钥登录：Face ID、Touch ID，或者用别的设备扫码。")
                .font(.subheadline)
                .foregroundStyle(Color.muted)
                .padding(.bottom, 16)
            if let error {
                Text(error).font(.subheadline).foregroundStyle(Color.danger).padding(.bottom, 12)
            }
            Button {
                Task { await signIn() }
            } label: {
                Text(busy ? "等待通行密钥…" : "用通行密钥登录")
                    .foregroundStyle(Color.accentInk)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(busy)
            HStack {
                Button("设备丢了？用恢复码登录") { sheet = .recovery }
                Spacer()
                Button("有邀请") { sheet = .join }
            }
            .font(.subheadline)
            .padding(.top, 16)
        }
        .padding(24)
        .background(Color.paper)
        .foregroundStyle(Color.ink)
        .sheet(item: $sheet) { sheet in
            NavigationStack {
                switch sheet {
                case .recovery: RecoverySignInView()
                case .join: JoinView()
                }
            }
        }
    }

    private func signIn() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await model.signInWithPasskey()
        } catch PasskeyFailure.canceled {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct RecoverySignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var handle = ""
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                TextField("用户名", text: $handle)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("恢复码，形如 xxxxx-xxxxx", text: $code)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
            } footer: {
                Text("每个恢复码只能用一次。登录后记得给这台设备添加通行密钥。")
            }
            if let error {
                Text(error).foregroundStyle(Color.danger)
            }
        }
        .navigationTitle("用恢复码登录")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("登录") { Task { await submit() } }
                    .disabled(busy || handle.isEmpty || code.isEmpty)
            }
        }
    }

    private func submit() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await model.signInWithRecoveryCode(handle: handle, code: code)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct JoinView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var invite = ""
    @State private var handle = ""
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                TextField("邀请链接或邀请码", text: $invite)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } footer: {
                Text("目前只接受邀请注册。")
            }
            Section {
                TextField("用户名，用在主页地址 /@用户名", text: $handle)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("名字，显示在主页上", text: $name)
            } footer: {
                Text("会用这台设备的 Face ID 或 Touch ID 创建通行密钥，不需要密码。")
            }
            if let error {
                Text(error).foregroundStyle(Color.danger)
            }
        }
        .navigationTitle("加入后记")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button(busy ? "创建中…" : "加入") { Task { await submit() } }
                    .disabled(busy || inviteCode.isEmpty || handle.isEmpty || name.isEmpty)
            }
        }
    }

    /// Accepts the whole `…/join/<code>` link as well as the bare code.
    private var inviteCode: String {
        let trimmed = invite.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.components(separatedBy: "/join/").last?.components(separatedBy: CharacterSet(charactersIn: "?#/")).first ?? ""
    }

    private func submit() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            model.freshRecoveryCodes = try await model.join(invite: inviteCode, handle: handle, name: name)
            dismiss()
        } catch PasskeyFailure.canceled {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Freshly made recovery codes, shown once.
struct RecoveryCodesView: View {
    let codes: [String]
    let handle: String
    let onDone: () -> Void

    var body: some View {
        let text = "后记 @\(handle) 的恢复码（每个只能用一次）\n\n\(codes.joined(separator: "\n"))\n"
        VStack(alignment: .leading, spacing: 20) {
            Text("保存恢复码").font(.title2.weight(.semibold))
            Text("通行密钥所在的设备都丢了时，用其中一个恢复码加用户名登录。每个只能用一次，这里只显示这一次。")
                .font(.subheadline)
                .foregroundStyle(Color.muted)
            LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)], spacing: 10) {
                ForEach(codes, id: \.self) { code in
                    Text(code).font(.body.monospaced()).textSelection(.enabled)
                }
            }
            HStack {
                ShareLink(item: text) { Label("保存或分享", systemImage: "square.and.arrow.up") }
                Spacer()
                Button("复制") { UIPasteboard.general.string = text }
            }
            Spacer()
            Button(action: onDone) {
                Text("我已经保存好了").foregroundStyle(Color.accentInk).frame(maxWidth: .infinity).padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(24)
        .foregroundStyle(Color.ink)
        .background(Color.paper)
        .interactiveDismissDisabled()
    }
}
