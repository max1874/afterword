import SwiftUI
import UniformTypeIdentifiers

/// 搜索: finds a work among your marks as you type, and, on 搜索, wherever the sources
/// know it, to add and mark. Adding starts here, so there is no separate 记一笔 screen.
struct SearchView: View {
    @Environment(AppModel.self) private var model
    /// The kind searched for to add; remembered, since most additions are of one kind.
    @AppStorage("searchKind") private var kind: Kind = .screen
    @State private var query = ""
    @State private var mine: [MarkedItem] = []
    @State private var searched: (text: String, kind: Kind)?
    @State private var groups: [SearchGroup] = []
    @State private var searching = false
    @State private var picking: String?
    @State private var error: String?
    @State private var showManual = false
    @FocusState private var focused: Bool

    private var text: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        // The title and our own field over the list, not .searchable and a navigation title:
        // iOS 26 put a search tab's field at the bottom, iOS 27 hides it until the list is pulled
        // down, and activating it folds the title away. These stay where they are on every version.
        VStack(alignment: .leading, spacing: 0) {
            Text("搜索")
                .font(.largeTitle.bold())
                .padding(.horizontal, 16)
                // Where the other tabs' large titles sit, under an empty navigation bar.
                .padding(.top, 56)
                .padding(.bottom, 10)
            field
            List {
                if text.isEmpty {
                    start
                } else {
                    if !mine.isEmpty { mineSection }
                    addSection
                }
            }
            .listStyle(.plain)
            .scrollDismissesKeyboard(.immediately)
        }
        .background(Color.paper)
        .navigationTitle("搜索")
        .toolbarVisibility(.hidden, for: .navigationBar)
        // Opening the tab, or ＋ on the home page, is for typing straight away.
        .onAppear { if query.isEmpty { focused = true } }
        .onChange(of: model.tab) { _, tab in if tab == .search, query.isEmpty { focused = true } }
        .onChange(of: kind) { if searched != nil { Task { await search() } } }
        // Your own marks follow the typing; the sources are asked on 搜索, since they take seconds.
        .task(id: text) {
            guard !text.isEmpty else { mine = []; return }
            try? await Task.sleep(for: .milliseconds(250))
            await findMine(text)
        }
        #if DEBUG
        .task {
            if let preset = model.debugSearch {
                model.debugSearch = nil
                query = preset
                await search()
            }
        }
        #endif
        .sheet(isPresented: $showManual) {
            NavigationStack {
                ManualAddView(kind: kind) { id in
                    showManual = false
                    open(id)
                }
            }
        }
    }

    private var field: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Color.muted)
            TextField("作品名，中文、原名都可以", text: $query)
                .focused($focused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .onSubmit { Task { await search() } }
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Color.muted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("清除")
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 44)
        .background(Capsule().fill(Color.card))
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    private var start: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("搜你标记过的作品，或者从豆瓣、TMDB、Bangumi、Steam 找新的来标记。")
                .font(.subheadline)
                .foregroundStyle(Color.muted)
            Button { showManual = true } label: {
                Label("手动添加一部作品", systemImage: "square.and.pencil").font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 12)
        .listRowSeparator(.hidden)
    }

    private var mineSection: some View {
        Section {
            ForEach(mine) { item in
                NavigationLink(value: Route.item(handle: model.me?.handle ?? "", id: item.id)) {
                    HStack(spacing: 12) {
                        CoverImage(path: item.cover, title: item.title).frame(width: 44)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Text([item.status.map { "\($0.label(for: item.kind)) · \(monthDay(item.markedOn))" }, item.originalTitle].compactMap { $0 }.joined(separator: " · "))
                                .font(.footnote)
                                .foregroundStyle(Color.muted)
                                .lineLimit(1)
                        }
                    }
                }
            }
        } header: {
            header("我的标记")
        }
    }

    private var addSection: some View {
        Section {
            Picker("类型", selection: $kind) {
                ForEach(Kind.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .listRowSeparator(.hidden)
            if let error {
                Text(error).font(.footnote).foregroundStyle(Color.danger).listRowSeparator(.hidden)
            }
            if searching {
                HStack { Spacer(); ProgressView("正在找…"); Spacer() }
                    .padding(.vertical, 20)
                    .listRowSeparator(.hidden)
            } else if let searched, searched.text == text, searched.kind == kind {
                ForEach(groups.flatMap(\.items)) { candidate in row(candidate) }
                if groups.allSatisfy(\.items.isEmpty) {
                    Text("没有找到“\(text)”。试试原名，或者手动添加。")
                        .font(.footnote)
                        .foregroundStyle(Color.muted)
                        .listRowSeparator(.hidden)
                }
                let failed = groups.filter { $0.error != nil }.map(\.label)
                if !failed.isEmpty {
                    Text("\(failed.joined(separator: "、")) 这次没有连上。")
                        .font(.footnote)
                        .foregroundStyle(Color.muted)
                        .listRowSeparator(.hidden)
                }
                Button { showManual = true } label: {
                    Label("手动添加", systemImage: "square.and.pencil").font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.plain)
                .listRowSeparator(.hidden)
            } else {
                Button { Task { await search() } } label: {
                    Label("在\(kind.label)里找“\(text)”", systemImage: "magnifyingglass")
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.plain)
                .listRowSeparator(.hidden)
            }
        } header: {
            header("添加新作品")
        }
    }

    private func header(_ title: String) -> some View {
        Text(title)
            .font(.title3.bold())
            .foregroundStyle(Color.ink)
            .textCase(nil)
            .padding(.top, 8)
    }

    private func row(_ candidate: Candidate) -> some View {
        HStack(spacing: 12) {
            CoverImage(path: candidate.cover, title: candidate.title).frame(width: 52)
            VStack(alignment: .leading, spacing: 3) {
                Text(candidate.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                let meta = [candidate.originalTitle, candidate.year.map(String.init), candidate.creators]
                    .compactMap { $0 }
                    .joined(separator: " · ")
                if !meta.isEmpty { Text(meta).font(.footnote).foregroundStyle(Color.muted).lineLimit(2) }
                Text(groups.first { $0.source == candidate.source }?.label ?? candidate.source)
                    .font(.caption2)
                    .foregroundStyle(Color.muted)
            }
            Spacer(minLength: 4)
            if let existing = candidate.existingId {
                Button("已标记") { open(existing) }
                    .font(.footnote.weight(.semibold))
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.muted)
            } else {
                Button { Task { await pick(candidate) } } label: {
                    Text(picking == candidate.id ? "…" : "标记")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.paper)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(Color.ink))
                }
                .buttonStyle(.plain)
                .disabled(picking != nil)
            }
        }
    }

    private func open(_ id: String) {
        guard let me = model.me else { return }
        model.searchPath.append(.item(handle: me.handle, id: id))
    }

    private func findMine(_ text: String) async {
        guard let me = model.me else { return }
        var components = URLComponents()
        components.queryItems = [URLQueryItem(name: "q", value: text)]
        let found: MarksPage? = try? await model.api.api("GET", "users/\(me.handle)/marks?\(components.percentEncodedQuery ?? "")")
        // A slower answer for earlier typing must not replace the current one.
        if text == self.text, let found { mine = Array(found.items.prefix(8)) }
    }

    private func search() async {
        let text = text
        guard !text.isEmpty else { return }
        let kind = kind
        searching = true
        error = nil
        defer { searching = false }
        do {
            var components = URLComponents()
            components.queryItems = [URLQueryItem(name: "kind", value: kind.rawValue), URLQueryItem(name: "q", value: text)]
            let response: SearchResponse = try await model.api.api("GET", "search?\(components.percentEncodedQuery ?? "")")
            groups = response.groups
            searched = (text, kind)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func pick(_ candidate: Candidate) async {
        picking = candidate.id
        error = nil
        defer { picking = nil }
        do {
            let created: NewID = try await model.api.api("POST", "items/pick", body: [
                "kind": candidate.kind.rawValue,
                "source": candidate.source,
                "source_id": candidate.sourceId ?? "",
                "q": searched?.text ?? text,
            ])
            open(created.id)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ManualAddView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State var kind: Kind
    let onAdded: (String) -> Void

    @State private var title = ""
    @State private var originalTitle = ""
    @State private var year = ""
    @State private var creators = ""
    @State private var coverURL = ""
    @State private var summary = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            Picker("类型", selection: $kind) {
                ForEach(Kind.allCases) { Text($0.label).tag($0) }
            }
            Section {
                TextField("标题", text: $title)
                TextField("原名", text: $originalTitle)
                TextField("年份", text: $year).keyboardType(.numberPad)
                TextField("作者 / 导演 / 开发", text: $creators)
                TextField("封面图片链接", text: $coverURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            Section("简介") {
                TextEditor(text: $summary).frame(minHeight: 90)
            }
            if let error {
                Text(error).foregroundStyle(Color.danger)
            }
        }
        .navigationTitle("手动添加")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("添加并标记") { Task { await submit() } }.disabled(busy || title.isEmpty)
            }
        }
    }

    private func submit() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            let created: NewID = try await model.api.api("POST", "items", body: [
                "kind": kind.rawValue,
                "title": title,
                "original_title": originalTitle,
                "year": year,
                "creators": creators,
                "cover_url": coverURL,
                "summary": summary,
            ])
            onAdded(created.id)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Imports a JSON array of marks in batches, like the web's import page.
struct ImportView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var rows: [Any]?
    @State private var fileName: String?
    @State private var fileError: String?
    @State private var choosing = false
    @State private var running = false
    @State private var done = 0
    @State private var added = 0
    @State private var updated = 0
    @State private var errors: [String] = []

    private let batchSize = 20

    var body: some View {
        Form {
            Section {
                Button(fileName ?? "选择 JSON 文件") { choosing = true }.disabled(running)
                if let fileError { Text(fileError).foregroundStyle(Color.danger) }
            } footer: {
                Text("内容是标记的数组，每条包含 kind、status、title、marked_on，以及可选的 original_title、year、creators、cover_url、rating、comment、source、source_id、source_url。同一来源的条目按 source_id 匹配，重复导入只会更新标记。")
            }
            if let rows {
                Section {
                    Text("共 \(rows.count) 条")
                    if running || done > 0 {
                        ProgressView(value: Double(done), total: Double(max(rows.count, 1)))
                        Text("已处理 \(done) 条：新增 \(added)，更新 \(updated)\(errors.isEmpty ? "" : "，\(errors.count) 条有问题")")
                            .font(.footnote)
                    }
                    Button(running ? "导入中…" : "开始导入") { Task { await run(rows) } }
                        .disabled(running || done == rows.count)
                }
            }
            if !errors.isEmpty {
                Section("有问题的条目") {
                    ForEach(Array(errors.enumerated()), id: \.offset) { Text($0.element).font(.footnote) }
                }
            }
        }
        .navigationTitle("导入")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(done > 0 && !running ? "完成" : "取消") { dismiss() } }
        }
        .fileImporter(isPresented: $choosing, allowedContentTypes: [.json]) { result in
            read(result)
        }
        .interactiveDismissDisabled(running)
    }

    private func read(_ result: Result<URL, Error>) {
        rows = nil
        fileError = nil
        done = 0; added = 0; updated = 0; errors = []
        do {
            let url = try result.get()
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let value = try JSONSerialization.jsonObject(with: Data(contentsOf: url))
            guard let array = value as? [Any] else { throw APIError(status: 0, message: "文件内容需要是一个数组") }
            rows = array
            fileName = url.lastPathComponent
        } catch {
            fileError = error.localizedDescription
        }
    }

    private func run(_ rows: [Any]) async {
        running = true
        defer {
            running = false
            model.marksVersion += 1
        }
        for start in stride(from: done, to: rows.count, by: batchSize) {
            let batch = Array(rows[start..<min(start + batchSize, rows.count)])
            do {
                let result: ImportResult = try await model.api.api("POST", "import", body: batch)
                added += result.added
                updated += result.updated
                errors += result.errors
            } catch {
                errors.append("第 \(start + 1)–\(start + batch.count) 条：\(error.localizedDescription)")
            }
            done = start + batch.count
        }
    }
}
