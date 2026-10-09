import SwiftUI

@main
struct AfterwordApp: App {
    @State private var model: AppModel

    init() {
        let model = AppModel()
        #if DEBUG
        // For runs against a dev server: `-AfterwordToken <token> -AfterwordTab search -AfterwordSearch <query>
        // -AfterwordOpen /@max/items/<id> -AfterwordSheet artwork`.
        let defaults = UserDefaults.standard
        if let token = defaults.string(forKey: "AfterwordToken") { model.api.setToken(token) }
        switch defaults.string(forKey: "AfterwordTab") {
        case "search": model.tab = .search
        case "library": model.tab = .library
        case "me": model.tab = .me
        default: break
        }
        model.debugSearch = defaults.string(forKey: "AfterwordSearch")
        model.debugSheet = defaults.string(forKey: "AfterwordSheet")
        if let path = defaults.string(forKey: "AfterwordOpen"), let url = model.api.url(for: path) { model.open(url) }
        #endif
        _model = State(initialValue: model)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(Color.ink)
                .onOpenURL { model.open($0) }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { model.open(url) }
                }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model

    private static var searchRole: TabRole {
        if #available(iOS 27.0, *) { .prominent } else { .search }
    }

    var body: some View {
        @Bindable var model = model
        Group {
            if !model.signedIn {
                SignInView()
            } else if let me = model.me {
                TabView(selection: $model.tab) {
                    Tab("首页", systemImage: "house", value: .home) {
                        NavigationStack(path: $model.homePath) {
                            HomeView(handle: me.handle).appRoutes()
                        }
                    }
                    Tab("资料库", systemImage: "books.vertical", value: .library) {
                        NavigationStack(path: $model.libraryPath) {
                            LibraryView(handle: me.handle).appRoutes()
                        }
                    }
                    Tab("我的", systemImage: "person.crop.circle", value: .me) {
                        NavigationStack { MeView() }
                    }
                    // Finds a work among your marks, or anywhere to add it: adding starts with a search.
                    // Its own circle beside the bar: iOS 26 gives that to the search role, iOS 27 only
                    // to the new prominent role and folds a search tab into the bar like any other.
                    Tab("搜索", systemImage: "magnifyingglass", value: .search, role: Self.searchRole) {
                        NavigationStack(path: $model.searchPath) {
                            SearchView().appRoutes()
                        }
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

extension View {
    /// Where links inside the tabs lead.
    func appRoutes() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .profile(let handle): HomeView(handle: handle)
            case .library(let handle, let kind, let status): LibraryView(handle: handle, kind: kind, status: status)
            case .item(let handle, let id): ItemView(handle: handle, id: id)
            }
        }
    }

    /// Whose page this is, under the title, on someone else's pages.
    @ViewBuilder func ownerSubtitle(_ text: String?) -> some View {
        if let text { navigationSubtitle(text) } else { self }
    }
}
