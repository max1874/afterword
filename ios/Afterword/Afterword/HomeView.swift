import SwiftUI

/// A person's home, laid out like Infuse: wide cards for what is in progress, bright tiles
/// into the library by kind, then rows of recently done and planned.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    let handle: String

    @State private var profile: Profile?
    @State private var shelves: Shelves?
    @State private var error: String?

    private var mine: Bool { model.me?.handle == handle }
    private var shelvesPath: String { "users/\(handle)/shelves" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let shelves {
                    if Status.shelfOrder.allSatisfy({ shelves[$0].isEmpty }) {
                        empty
                    } else {
                        if !shelves.doing.isEmpty {
                            row("进行中", count: profile?.total(status: .doing), to: .library(handle: handle, kind: nil, status: .doing)) {
                                ForEach(shelves.doing) { item in
                                    NavigationLink(value: Route.item(handle: handle, id: item.id)) {
                                        WideCard(item: item).frame(width: 300)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        row("分类", to: .library(handle: handle, kind: nil, status: nil)) { kindTiles }
                        if !shelves.done.isEmpty {
                            row("最近完成", count: profile?.total(status: .done), to: .library(handle: handle, kind: nil, status: .done)) {
                                ForEach(shelves.done) { posterCard($0, status: .done) }
                            }
                        }
                        if !shelves.wish.isEmpty {
                            row("计划中", count: profile?.total(status: .wish), to: .library(handle: handle, kind: nil, status: .wish)) {
                                ForEach(shelves.wish) { posterCard($0, status: .wish) }
                            }
                        }
                    }
                } else if let error {
                    ContentUnavailableView("没有加载出来", systemImage: "exclamationmark.triangle", description: Text(error))
                        .padding(.top, 40)
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
            .padding(.bottom, 32)
        }
        .background(Color.paper)
        .foregroundStyle(Color.ink)
        .navigationTitle("首页")
        .ownerSubtitle(mine ? nil : "\(profile?.name ?? handle) · @\(handle)")
        .toolbar {
            if mine {
                // 记一笔: adding starts with a search, so this opens the search tab.
                ToolbarItem(placement: .topBarTrailing) {
                    Button { model.tab = .search } label: { Image(systemName: "plus") }
                        .accessibilityLabel("记一笔")
                }
            }
        }
        .refreshable { await load() }
        .task(id: "\(handle)|\(model.marksVersion)") { await load() }
    }

    /// A titled row that scrolls sideways, with 查看全部 on the right.
    private func row(_ title: String, count: Int? = nil, to route: Route, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.title2.bold())
                if let count {
                    Text("\(count)").font(.subheadline.weight(.medium)).foregroundStyle(Color.muted)
                }
                Spacer()
                NavigationLink(value: route) {
                    Text("查看全部 ›")
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.muted)
            }
            .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 12) { content() }
                    .scrollTargetLayout()
            }
            .contentMargins(.horizontal, 16, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            // Covers cast shadows past the row.
            .scrollClipDisabled()
        }
        .padding(.top, 26)
    }

    /// Tiles into the library by kind: the newest three covers whole, side by side, like Emby's
    /// collection mosaics. The tile is exactly three covers wide, so none is cropped.
    @ViewBuilder private var kindTiles: some View {
        ForEach([Kind?.none] + Kind.allCases.map { Optional($0) }, id: \.self) { kind in
            NavigationLink(value: Route.library(handle: handle, kind: kind, status: nil)) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 1) {
                        ForEach(shelves?.tiles?[kind?.rawValue ?? "all"] ?? [], id: \.self) { path in TileCover(path: path) }
                    }
                    .frame(width: 150, height: 75)
                    .background(Color.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    Text(kind?.label ?? "全部").font(.footnote.weight(.medium))
                }
            }
            .buttonStyle(.plain)
        }
    }

    private func posterCard(_ item: MarkedItem, status: Status) -> some View {
        NavigationLink(value: Route.item(handle: handle, id: item.id)) {
            VStack(alignment: .leading, spacing: 0) {
                CoverImage(path: item.cover, title: item.title)
                Text(item.title)
                    .font(.footnote)
                    .lineLimit(1)
                    .padding(.top, 7)
                Text("\(status == .done ? item.status?.label(for: item.kind) ?? "" : item.kind.label) · \(monthDay(item.markedOn))")
                    .font(.caption)
                    .foregroundStyle(Color.muted)
                    .lineLimit(1)
            }
            .frame(width: 104)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var empty: some View {
        VStack(spacing: 12) {
            Text("这里还空着。").font(.title3).foregroundStyle(Color.muted)
            if mine {
                Button("记下第一部作品") { model.tab = .search }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }

    private func load() async {
        error = nil
        // Show what this screen had last time straight away; the network takes about a second.
        if profile == nil { profile = model.api.cached("users/\(handle)") }
        if shelves == nil { shelves = model.api.cached(shelvesPath) }
        do {
            async let fetchedProfile: Profile = model.api.api("GET", "users/\(handle)")
            let fetched: Shelves = try await model.api.api("GET", shelvesPath)
            shelves = fetched
            profile = try await fetchedProfile
            // Item pages open with what the rows already know, then refresh.
            for status in Status.allCases {
                for item in fetched[status] { model.knownItems["\(handle)/\(item.id)"] = item }
            }
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// A 16:9 card for something in progress: landscape artwork when there is some, otherwise
/// the cover on the left over a wash of its own colours, with the title beside it.
struct WideCard: View {
    @Environment(AppModel.self) private var model
    let item: MarkedItem

    @State private var art: UIImage?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.card
                .aspectRatio(16 / 9, contentMode: .fit)
                .overlay {
                    if item.backdrop != nil {
                        if let art { Image(uiImage: art).resizable().scaledToFill() }
                    } else {
                        fallback
                    }
                }
                .overlay(alignment: .bottomTrailing) {
                    if let status = item.status {
                        Text(status.label(for: item.kind))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .glassEffect(.regular.tint(.black.opacity(0.25)), in: .capsule)
                            .padding(10)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.primary.opacity(0.12), lineWidth: 0.5))
            Text(item.title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .padding(.top, 8)
            Text("\(item.kind.label) · \(monthDay(item.markedOn)) 起")
                .font(.footnote)
                .foregroundStyle(Color.muted)
                .lineLimit(1)
        }
        .contentShape(Rectangle())
        .task(id: item.backdrop) {
            if let backdrop = item.backdrop { art = await CoverImage.image(for: backdrop, api: model.api, maxPixels: 1000) }
        }
    }

    private var fallback: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                CoverBackdrop(path: item.cover, fade: false)
                    .brightness(-0.12)
                LinearGradient(colors: [.black.opacity(0.05), .black.opacity(0.35)], startPoint: .leading, endPoint: .trailing)
                HStack(alignment: .top, spacing: 14) {
                    CoverImage(path: item.cover, title: item.title)
                        .frame(height: geo.size.height * 0.84)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.title)
                            .font(.headline.weight(.bold))
                            .lineLimit(3)
                        Text([item.originalTitle, item.kind.label, item.year.map(String.init)].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption)
                            .opacity(0.7)
                            .lineLimit(2)
                    }
                    .foregroundStyle(.white)
                    .padding(.top, 4)
                }
                .padding(geo.size.height * 0.08)
            }
        }
    }
}

extension Status {
    /// The order of the rows on a home page.
    static let shelfOrder: [Status] = [.doing, .done, .wish]
}

/// One cover on a kind tile, whole: three covers fill the tile exactly.
private struct TileCover: View {
    @Environment(AppModel.self) private var model
    let path: String

    @State private var image: UIImage?

    init(path: String) {
        self.path = path
        _image = State(initialValue: CoverCache.shared.object(forKey: path as NSString))
    }

    var body: some View {
        Color.card
            .overlay {
                if let image { Image(uiImage: image).resizable().scaledToFill() }
            }
            .clipped()
            .task(id: path) { image = await CoverImage.image(for: path, api: model.api) }
    }
}
