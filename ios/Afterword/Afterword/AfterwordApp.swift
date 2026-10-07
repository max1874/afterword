import SwiftUI

@main
struct AfterwordApp: App {
    @State private var model: AppModel

    init() {
        let model = AppModel()
        #if DEBUG
        // For runs against a dev server: `-AfterwordToken <token> -AfterwordTab add -AfterwordOpen /@max/items/<id>`.
        let defaults = UserDefaults.standard
        if let token = defaults.string(forKey: "AfterwordToken") { model.api.setToken(token) }
        switch defaults.string(forKey: "AfterwordTab") {
        case "add": model.tab = .add
        case "settings": model.tab = .settings
        default: break
        }
        model.debugSearch = defaults.string(forKey: "AfterwordSearch")
        if let path = defaults.string(forKey: "AfterwordOpen"), let url = model.api.url(for: path) { model.open(url) }
        #endif
        _model = State(initialValue: model)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(.seal)
                .onOpenURL { model.open($0) }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { model.open(url) }
                }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Group {
            if !model.signedIn {
                SignInView()
            } else if let me = model.me {
                TabView(selection: $model.tab) {
                    Tab("我的", systemImage: "books.vertical", value: .mine) {
                        NavigationStack(path: $model.minePath) {
                            ProfileView(handle: me.handle)
                                .navigationDestination(for: Route.self) { route in
                                    switch route {
                                    case .profile(let handle): ProfileView(handle: handle)
                                    case .item(let handle, let id): ItemView(handle: handle, id: id)
                                    }
                                }
                        }
                    }
                    Tab("记一笔", systemImage: "plus.circle", value: .add) {
                        NavigationStack { AddView() }
                    }
                    Tab("设置", systemImage: "gearshape", value: .settings) {
                        NavigationStack { SettingsView() }
                    }
                }
            } else if let error = model.loadError {
                ContentUnavailableView {
                    Label("连不上后记", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error)
                } actions: {
                    Button("重试") { Task { await model.loadMe() } }
                }
                .background(Color.paper)
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.paper)
            }
        }
        .task(id: model.signedIn) { await model.loadMe() }
        .sheet(isPresented: Binding(get: { model.freshRecoveryCodes != nil && model.me != nil }, set: { if !$0 { model.freshRecoveryCodes = nil } })) {
            RecoveryCodesView(codes: model.freshRecoveryCodes ?? [], handle: model.me?.handle ?? "") {
                model.freshRecoveryCodes = nil
            }
        }
    }
}
