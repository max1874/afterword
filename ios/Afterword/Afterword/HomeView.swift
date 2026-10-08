import SwiftUI

/// A person's home: what they have done per kind, then rows of covers in progress, recently done and planned.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    let handle: String

    @State private var profile: Profile?
    @State private var kind: Kind?
    @State private var shelves: Shelves?
    @State private var error: String?
    /// The kind the shelves on screen belong to; another one starts from its own cache.
    @State private var shownKey = ""

    private var mine: Bool { model.me?.handle == handle }
    private var key: String { "\(handle)|\(kind?.rawValue ?? "")" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Picker("类型", selection: $kind) {
                    Text("全部").tag(Kind?.none)
                    ForEach(Kind.allCases) { Text($0.label).tag(Kind?.some($0)) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)

                stats.padding(.horizontal, 16).padding(.top, 16)

                if let shelves {
                    if Status.shelfOrder.allSatisfy({ shelves[$0].isEmpty }) {
                        empty
                    } else {
                        ForEach(Status.shelfOrder, id: \.self) { status in
                            if !shelves[status].isEmpty { shelf(status, shelves[status]) }
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
        .navigationTitle(kind?.label ?? "全部")
        .ownerSubtitle(mine ? nil : "\(profile?.name ?? handle) · @\(handle)")
        .refreshable { await load() }
        .task(id: "\(key)|\(model.marksVersion)") { await load() }
    }

    /// Done per kind; within one kind, its count per status.
    private var tiles: [(count: Int, label: String)] {
        let total = { (k: Kind?, s: Status?) in profile?.total(kind: k, status: s) ?? 0 }
        if let kind { return Status.allCases.map { (total(kind, $0), $0.label(for: kind)) } }
        return Kind.allCases.map { (total($0, .done), "\(Status.done.label(for: $0))的\($0.label)") }
    }

    private var stats: some View {
        HStack(spacing: 8) {
            ForEach(tiles, id: \.label) { tile in
                VStack(alignment: .leading, spacing: 1) {
                    Text(profile == nil ? "–" : "\(tile.count)")
                        .font(.system(size: 22, weight: .bold))
                        .contentTransition(.numericText())
                    Text(tile.label)
                        .font(.caption2)
                        .foregroundStyle(Color.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 14).fill(Color.card))
            }
        }
    }

    private func title(_ status: Status) -> String {
        // Like the web: 进行中 / 最近完成 / 计划中, or 在看 / 最近看过 / 想看 within one kind.
        if status == .done { return "最近\(kind.map { status.label(for: $0) } ?? "完成")" }
        return status.label(for: kind)
    }

    private func shelf(_ status: Status, _ items: [MarkedItem]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            NavigationLink(value: Route.library(handle: handle, kind: kind, status: status)) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(title(status)).font(.title2.bold())
                    Text("\(profile?.total(kind: kind, status: status) ?? items.count)")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.muted)
                    Image(systemName: "chevron.right")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.muted)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(items) { item in
                        NavigationLink(value: Route.item(handle: handle, id: item.id)) {
                            card(item)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .scrollTargetLayout()
            }
            .contentMargins(.horizontal, 16, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            // Covers cast shadows past the row.
            .scrollClipDisabled()
        }
        .padding(.top, 28)
    }

    private func card(_ item: MarkedItem) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            CoverImage(path: item.cover, title: item.title)
            Text(item.title)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .padding(.top, 8)
            Text("\(item.status?.label(for: item.kind) ?? "") · \(monthDay(item.markedOn))")
                .font(.caption2)
                .foregroundStyle(Color.muted)
                .lineLimit(1)
                .padding(.top, 2)
        }
        .frame(width: 104)
        .contentShape(Rectangle())
    }

    private var empty: some View {
        VStack(spacing: 12) {
            Text("这里还空着。").font(.title3).foregroundStyle(Color.muted)
            if mine && kind == nil {
                Button("记下第一部作品") { model.tab = .add }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }

    private var shelvesPath: String {
        kind.map { "users/\(handle)/shelves?kind=\($0.rawValue)" } ?? "users/\(handle)/shelves"
    }

    private func load() async {
        error = nil
        // Show what this screen had last time straight away; the network takes about a second.
        if shownKey != key {
            if profile == nil { profile = model.api.cached("users/\(handle)") }
            shelves = model.api.cached(shelvesPath)
            shownKey = key
        }
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

extension Status {
    /// The order of the rows on a home page.
    static let shelfOrder: [Status] = [.doing, .done, .wish]
}
