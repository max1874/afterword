import SwiftUI

/// One work as someone marked it; on your own page, also the form to mark it.
struct ItemView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let handle: String
    let id: String

    @State private var item: MarkedItem?
    @State private var mine = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            if let item {
                content(item)
            } else if let error {
                ContentUnavailableView("没有这条标记", systemImage: "questionmark.square.dashed", description: Text(error))
                    .padding(.top, 80)
            } else {
                ProgressView().padding(.top, 80)
            }
        }
        .background(Color.paper)
        .foregroundStyle(Color.ink)
        .navigationTitle(item?.title ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: "\(handle)/\(id)") { await load() }
    }

    private func content(_ item: MarkedItem) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            CoverImage(path: item.cover, title: item.title)
                .frame(width: 150)
            Text(item.title)
                .font(.system(size: 28, weight: .semibold))
                .padding(.top, 20)
                .textSelection(.enabled)
            if let original = item.originalTitle {
                Text(original).font(.title3.weight(.semibold)).foregroundStyle(Color.muted).padding(.top, 6)
            }
            meta(item).padding(.top, 10)

            if let status = item.status {
                VStack(alignment: .leading, spacing: 8) {
                    if !mine { Text(ownerName).font(.subheadline.weight(.semibold)) }
                    HStack(spacing: 10) {
                        Text(item.markedOn ?? "").foregroundStyle(Color.muted)
                        Text(status.label(for: item.kind))
                        Stars(rating: item.rating)
                    }
                    .font(.subheadline)
                    if let comment = item.comment {
                        Text(comment).textSelection(.enabled).padding(.top, 4)
                    }
                }
                .padding(.leading, 16)
                .overlay(alignment: .leading) { Rectangle().fill(Color.accent).frame(width: 2) }
                .padding(.top, 28)
            }

            if let summary = item.summary {
                DisclosureGroup("简介") {
                    Text(summary).foregroundStyle(Color.muted).padding(.top, 8).frame(maxWidth: .infinity, alignment: .leading)
                }
                .tint(Color.ink)
                .padding(.top, 28)
            }

            if mine {
                MarkEditor(item: item, today: model.me?.today ?? "") { saved in
                    self.item = saved
                    model.knownItems["\(handle)/\(id)"] = saved
                    model.marksVersion += 1
                } onDelete: {
                    model.knownItems["\(handle)/\(id)"] = nil
                    model.marksVersion += 1
                    dismiss()
                }
                .padding(.top, 32)
            } else if let me = model.me {
                NavigationLink("我的标记", value: Route.item(handle: me.handle, id: item.id))
                    .font(.subheadline)
                    .padding(.top, 28)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @State private var ownerName = ""

    private var itemPath: String { "users/\(handle)/items/\(id)" }

    private func meta(_ item: MarkedItem) -> some View {
        let parts = [item.kind.label, item.year.map(String.init), item.creators.map { "\(item.kind.creatorLabel) \($0)" }]
            .compactMap { $0 }
        return HStack(spacing: 0) {
            Text(parts.joined(separator: " · "))
            if let link = item.sourceUrl.flatMap(URL.init(string:)) {
                Text(" · ")
                Link(item.sourceLabel, destination: link).underline()
            }
        }
        .font(.subheadline)
        .foregroundStyle(Color.muted)
    }

    private func load() async {
        if item == nil, let known = model.knownItems["\(handle)/\(id)"] ?? model.api.cached(itemPath).map({ (r: ItemResponse) in r.item }) {
            item = known
            mine = model.me?.handle == handle
        }
        do {
            let response: ItemResponse = try await model.api.api("GET", itemPath)
            item = response.item
            mine = response.mine
            if !mine, ownerName.isEmpty {
                ownerName = (model.api.cached("users/\(handle)") as Profile?)?.name ?? ""
                let profile: Profile? = try? await model.api.api("GET", "users/\(handle)")
                ownerName = profile?.name ?? "@\(handle)"
            }
        } catch is CancellationError {
        } catch let failure as APIError where failure.status == 404 {
            item = nil
            error = failure.localizedDescription
        } catch {
            if item == nil { self.error = error.localizedDescription }
        }
    }
}

/// Status, rating, date and comment, like the web's mark form.
struct MarkEditor: View {
    @Environment(AppModel.self) private var model
    let item: MarkedItem
    let today: String
    let onSave: (MarkedItem) -> Void
    let onDelete: () -> Void

    @State private var status: Status = .done
    @State private var rating: Int?
    @State private var date = Date()
    @State private var comment = ""
    @State private var saving = false
    @State private var confirmDelete = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(item.status == nil ? "标记这部作品" : "修改标记").font(.title3.weight(.semibold))
            Picker("状态", selection: $status) {
                ForEach(Status.allCases) { s in Text(s.label(for: item.kind)).tag(s) }
            }
            .pickerStyle(.segmented)
            if status != .wish {
                StarInput(rating: $rating)
            }
            DatePicker("日期", selection: $date, displayedComponents: .date)
                .environment(\.locale, Locale(identifier: "zh_CN"))
            ZStack(alignment: .topLeading) {
                if comment.isEmpty {
                    Text("写点什么，或者留白。").foregroundStyle(Color.muted).padding(.top, 8).padding(.leading, 5)
                }
                TextEditor(text: $comment)
                    .frame(minHeight: 110)
                    .scrollContentBackground(.hidden)
            }
            .padding(6)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.paper))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.line))
            if let error {
                Text(error).font(.subheadline).foregroundStyle(Color.danger)
            }
            Button {
                Task { await save() }
            } label: {
                Text(saving ? "保存中…" : "保存").foregroundStyle(Color.accentInk).padding(.horizontal, 12).padding(.vertical, 4)
            }
            .buttonStyle(.borderedProminent)
            .disabled(saving)
            if item.status != nil {
                Divider().overlay(Color.line)
                Button("删除这条标记", role: .destructive) { confirmDelete = true }
                    .font(.subheadline)
                    .confirmationDialog("删除这条标记？", isPresented: $confirmDelete, titleVisibility: .visible) {
                        Button("删除", role: .destructive) { Task { await delete() } }
                    }
            }
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.card))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.line))
        .onAppear(perform: reset)
        .onChange(of: item) { reset() }
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private func reset() {
        status = item.status ?? .done
        rating = item.rating
        date = Self.dayFormatter.date(from: item.markedOn ?? today) ?? Date()
        comment = item.comment ?? ""
    }

    private func save() async {
        saving = true
        error = nil
        defer { saving = false }
        var body: [String: Any] = [
            "status": status.rawValue,
            "marked_on": Self.dayFormatter.string(from: date),
            "comment": comment,
        ]
        if status != .wish, let rating { body["rating"] = rating }
        do {
            let saved: SavedItem = try await model.api.api("PUT", "marks/\(item.id)", body: body)
            onSave(saved.item)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func delete() async {
        do {
            try await model.api.api("DELETE", "marks/\(item.id)")
            onDelete()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
