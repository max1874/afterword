import SwiftUI
import UniformTypeIdentifiers

/// 记一笔: search the sources, pick a result, or add a work by hand.
struct AddView: View {
    @Environment(AppModel.self) private var model
    @State private var kind: Kind = .screen
    @State private var query = ""
    @State private var searched = ""
    @State private var groups: [SearchGroup] = []
    @State private var searching = false
    @State private var picking: String?
    @State private var error: String?
    @State private var opened: Route?
    @State private var showManual = false
    @State private var showImport = false

    var body: some View {
        List {
            Section {
                Picker("类型", selection: $kind) {
                    ForEach(Kind.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            if let error {
                Text(error).foregroundStyle(Color.seal).listRowBackground(Color.clear)
            }
            if searching {
                HStack { Spacer(); ProgressView("搜索中…"); Spacer() }.listRowBackground(Color.clear)
            } else if !searched.isEmpty {
                ForEach(groups) { group in
                    Section {
                        ForEach(group.items) { candidate in row(candidate) }
                    } header: {
                        HStack {
                            Text(group.label).foregroundStyle(Color.ink)
                            if let failure = group.error {
                                Text("搜索失败（\(failure)）").foregroundStyle(Color.seal)
                            } else {
                                Text("\(group.items.count) 条")
                            }
                        }
                    }
                }
                if groups.allSatisfy(\.items.isEmpty) {
                    Text("没有搜到“\(searched)”。试试原名，或者手动添加。")
                        .foregroundStyle(Color.muted)
                        .listRowBackground(Color.clear)
                }
            }
            Section {
                Button("搜不到？手动添加") { showManual = true }
                Button("有一批旧标记？从文件导入") { showImport = true }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Color.paper)
        .navigationTitle("记一笔")
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "作品名，中文、原名都可以")
        .onSubmit(of: .search) { Task { await search() } }
        .onChange(of: kind) { if !searched.isEmpty { Task { await search() } } }
        #if DEBUG
        .task {
            if let preset = model.debugSearch {
                model.debugSearch = nil
                query = preset
                await search()
            }
        }
        #endif
        .navigationDestination(item: $opened) { route in
            if case .item(let handle, let id) = route { ItemView(handle: handle, id: id) }
        }
        .sheet(isPresented: $showManual) {
            NavigationStack {
                ManualAddView(kind: kind) { id in
                    showManual = false
                    open(id)
                }
            }
        }
        .sheet(isPresented: $showImport) {
            NavigationStack { ImportView() }
        }
    }

    private func row(_ candidate: Candidate) -> some View {
        HStack(alignment: .top, spacing: 12) {
            CoverImage(path: candidate.cover, title: candidate.title).frame(width: 56)
            VStack(alignment: .leading, spacing: 3) {
                Text(candidate.title).font(.headline)
                let meta = [candidate.originalTitle, candidate.year.map(String.init), candidate.creators.map { "\(candidate.kind.creatorLabel) \($0)" }]
                    .compactMap { $0 }
                    .joined(separator: " · ")
                if !meta.isEmpty { Text(meta).font(.footnote).foregroundStyle(Color.muted) }
                if let summary = candidate.summary {
                    Text(summary).font(.footnote).foregroundStyle(Color.muted).lineLimit(2)
                }
            }
            Spacer(minLength: 4)
            if let existing = candidate.existingId {
                Button("已标记") { open(existing) }
                    .font(.footnote)
                    .buttonStyle(.borderless)
                    .foregroundStyle(Color.muted)
                    .frame(maxHeight: .infinity)
            } else {
                Button(picking == candidate.id ? "标记中…" : "标记") { Task { await pick(candidate) } }
                    .font(.footnote)
                    .buttonStyle(.bordered)
                    .disabled(picking != nil)
                    .frame(maxHeight: .infinity)
            }
        }
        .listRowBackground(Color.card)
    }

    private func open(_ id: String) {
        guard let me = model.me else { return }
        opened = .item(handle: me.handle, id: id)
    }

    private func search() async {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        searching = true
        error = nil
        defer { searching = false }
        do {
            var components = URLComponents()
            components.queryItems = [URLQueryItem(name: "kind", value: kind.rawValue), URLQueryItem(name: "q", value: text)]
            let response: SearchResponse = try await model.api.api("GET", "search?\(components.percentEncodedQuery ?? "")")
            groups = response.groups
            searched = text
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
                "q": searched,
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
                Text(error).foregroundStyle(Color.seal)
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
                if let fileError { Text(fileError).foregroundStyle(Color.seal) }
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
