import SwiftUI

/// A person's marks, newest first, grouped by year, with the web's filters.
struct ProfileView: View {
    @Environment(AppModel.self) private var model
    let handle: String

    @State private var profile: Profile?
    @State private var kind: Kind?
    @State private var status: Status?
    @State private var items: [MarkedItem] = []
    @State private var yearCounts: [String: Int] = [:]
    @State private var page = 0
    @State private var hasMore = true
    @State private var loading = false
    @State private var error: String?

    private var mine: Bool { model.me?.handle == handle }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: []) {
                header
                filters
                if let error, items.isEmpty {
                    ContentUnavailableView("没有加载出来", systemImage: "exclamationmark.triangle", description: Text(error))
                } else if items.isEmpty && !hasMore {
                    empty
                }
                ForEach(years, id: \.self) { year in
                    yearSection(year)
                }
                footer
            }
            .padding(.horizontal, 16)
        }
        .background(Color.paper)
        .foregroundStyle(Color.ink)
        .navigationTitle("@\(handle)")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await reload() }
        .task(id: "\(handle)|\(kind?.rawValue ?? "")|\(status?.rawValue ?? "")|\(model.marksVersion)") { await reload() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(profile.map { joinText($0.name, "的后记") } ?? " ")
                .font(.system(size: 28, weight: .semibold))
            if let profile {
                Text("看过 \(profile.total(kind: .screen, status: .done)) 部影视 · 读过 \(profile.total(kind: .book, status: .done)) 本书 · 读过 \(profile.total(kind: .comic, status: .done)) 部漫画 · 玩过 \(profile.total(kind: .game, status: .done)) 款游戏")
                    .font(.headline)
                    .foregroundStyle(Color.muted)
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(Color.line).frame(height: 1) }
        .padding(.bottom, 20)
    }

    private var filters: some View {
        VStack(alignment: .leading, spacing: 12) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 20) {
                    kindButton(nil, "全部", count: nil)
                    ForEach(Kind.allCases) { k in
                        kindButton(k, k.label, count: profile?.total(kind: k))
                    }
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip(nil, "全部")
                    ForEach(Status.allCases) { s in
                        chip(s, "\(s.label(for: kind)) \(profile?.total(kind: kind, status: s) ?? 0)")
                    }
                }
            }
        }
        .padding(.bottom, 24)
    }

    private func kindButton(_ value: Kind?, _ label: String, count: Int?) -> some View {
        Button {
            kind = value
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(label).font(.title3.weight(.semibold))
                if let count { Text("\(count)").font(.caption2).foregroundStyle(Color.muted).baselineOffset(8) }
            }
            .foregroundStyle(kind == value ? Color.ink : Color.muted)
            .padding(.bottom, 4)
            .overlay(alignment: .bottom) {
                if kind == value { Rectangle().fill(Color.accent).frame(height: 2) }
            }
        }
        .buttonStyle(.plain)
    }

    private func chip(_ value: Status?, _ label: String) -> some View {
        Button {
            status = value
        } label: {
            Text(label)
                .font(.subheadline)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .foregroundStyle(status == value ? Color.paper : Color.muted)
                .background(Capsule().fill(status == value ? Color.ink : Color.clear))
                .overlay(Capsule().stroke(status == value ? Color.ink : Color.line))
        }
        .buttonStyle(.plain)
    }

    private var empty: some View {
        VStack(spacing: 12) {
            Text("这里还空着。").font(.title3).foregroundStyle(Color.muted)
            if mine && kind == nil && status == nil {
                Button("记下第一部作品") { model.tab = .add }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }

    private var years: [String] {
        var seen: [String] = []
        for item in items {
            let year = String((item.markedOn ?? "").prefix(4))
            if seen.last != year { seen.append(year) }
        }
        return seen
    }

    private func yearSection(_ year: String) -> some View {
        let group = items.filter { ($0.markedOn ?? "").hasPrefix(year) }
        return VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(year).font(.system(size: 28, weight: .semibold))
                Text("\(yearCounts[year] ?? group.count) 条").font(.subheadline).foregroundStyle(Color.muted)
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 14, alignment: .top), count: 3), spacing: 22) {
                ForEach(group) { item in
                    NavigationLink(value: Route.item(handle: handle, id: item.id)) {
                        card(item)
                    }
                    .buttonStyle(.plain)
                    .onAppear { prefetch(after: item) }
                }
            }
        }
        .padding(.bottom, 36)
    }

    private func card(_ item: MarkedItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            CoverImage(path: item.cover, title: item.title)
            // Two lines reserved so the meta line aligns across a row.
            Text(item.title)
                .font(.footnote.weight(.semibold))
                .lineLimit(2, reservesSpace: true)
            HStack(spacing: 4) {
                Text(String((item.markedOn ?? "").dropFirst(5)))
                if status == nil, let s = item.status { Text("· \(s.label(for: item.kind))") }
                Stars(rating: item.rating)
            }
            .font(.caption2)
            .foregroundStyle(Color.muted)
            .lineLimit(1)
        }
        .contentShape(Rectangle())
    }

    /// Starts the next page a couple of screens before the end, not at the spinner.
    private func prefetch(after item: MarkedItem) {
        guard hasMore, !loading, let index = items.lastIndex(where: { $0.id == item.id }), index >= items.count - 18 else { return }
        Task { await loadMore() }
    }

    @ViewBuilder private var footer: some View {
        if hasMore {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
                .onAppear { Task { await loadMore() } }
        }
    }

    private func reload() async {
        error = nil
        // Show what this screen had last time straight away; the network takes about a second.
        if shownFilter != filterKey {
            if profile == nil { profile = model.api.cached("users/\(handle)") }
            if let cachedFirst: MarksPage = model.api.cached(pagePath(1)) {
                show(cachedFirst)
            } else {
                items = []
                page = 0
                hasMore = true
            }
            shownFilter = filterKey
        }
        do {
            async let fetchedProfile: Profile = model.api.api("GET", "users/\(handle)")
            let first = try await fetchPage(1)
            profile = try await fetchedProfile
            remember(first.items)
            // Keep the later pages already loaded when the first page has not changed.
            if page > 1, first.items.map(\.id) == Array(items.prefix(first.items.count)).map(\.id) {
                items.replaceSubrange(0..<first.items.count, with: first.items)
                yearCounts = first.yearCounts
            } else {
                show(first)
            }
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
            if items.isEmpty { hasMore = false }
        }
    }

    /// The filter the items on screen belong to; another one starts from its own cache.
    @State private var shownFilter = ""
    private var filterKey: String { "\(handle)|\(kind?.rawValue ?? "")|\(status?.rawValue ?? "")" }

    private func show(_ first: MarksPage) {
        items = first.items
        yearCounts = first.yearCounts
        page = 1
        hasMore = first.hasMore
        remember(first.items)
    }

    /// Item pages open with what the list already knows, then refresh.
    private func remember(_ marked: [MarkedItem]) {
        for item in marked { model.knownItems["\(handle)/\(item.id)"] = item }
    }

    private func loadMore() async {
        guard !loading, hasMore, page > 0 else { return }
        loading = true
        defer { loading = false }
        do {
            let next = try await fetchPage(page + 1)
            remember(next.items)
            let known = Set(items.map(\.id))
            items += next.items.filter { !known.contains($0.id) }
            page = next.page
            hasMore = next.hasMore
        } catch {
            self.error = error.localizedDescription
            hasMore = false
        }
    }

    private func fetchPage(_ page: Int) async throws -> MarksPage {
        try await model.api.api("GET", pagePath(page))
    }

    private func pagePath(_ page: Int) -> String {
        var query = [URLQueryItem(name: "page", value: String(page))]
        if let kind { query.append(URLQueryItem(name: "kind", value: kind.rawValue)) }
        if let status { query.append(URLQueryItem(name: "status", value: status.rawValue)) }
        var components = URLComponents()
        components.queryItems = query
        return "users/\(handle)/marks?\(components.percentEncodedQuery ?? "")"
    }
}
