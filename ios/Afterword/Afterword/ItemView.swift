import SwiftUI

/// One work as someone marked it, under its landscape artwork or over a blur of its cover;
/// on your own page, also the way to mark it.
struct ItemView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let handle: String
    let id: String

    @State private var item: MarkedItem?
    @State private var mine = false
    @State private var error: String?
    @State private var editing = false
    @State private var summaryExpanded = false
    @State private var rateError: String?
    /// Opens the form once for an item just picked from search, which has no mark yet.
    @State private var offeredEditor = false

    var body: some View {
        ScrollView {
            if let item {
                content(item)
                    .background(alignment: .top) {
                        if item.backdrop != nil {
                            // About 16:10 across the phone, so the artwork is not cropped to a sliver.
                            ArtworkBackdrop(path: item.backdrop)
                                .frame(height: 400)
                                .padding(.top, -150)
                        } else {
                            CoverBackdrop(path: item.cover)
                                .frame(height: 560)
                                .padding(.top, -200)
                        }
                    }
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
        .toolbar {
            // The title is on the page in large type already.
            ToolbarItem(placement: .principal) { Text("") }
            if let item {
                ToolbarItem(placement: .topBarTrailing) { moreMenu(item) }
            }
        }
        .sheet(isPresented: $editing) {
            if let item {
                NavigationStack {
                    MarkEditor(item: item, today: model.me?.today ?? "") { saved in
                        editing = false
                        self.item = saved
                        model.knownItems["\(handle)/\(id)"] = saved
                        model.marksVersion += 1
                    } onDelete: {
                        editing = false
                        model.knownItems["\(handle)/\(id)"] = nil
                        model.marksVersion += 1
                        dismiss()
                    }
                }
            }
        }
        .task(id: "\(handle)/\(id)") { await load() }
    }

    private func content(_ item: MarkedItem) -> some View {
        VStack(spacing: 0) {
            if item.backdrop != nil {
                // The artwork above shows through here.
                Color.clear.frame(height: 200)
            } else {
                CoverImage(path: item.cover, title: item.title)
                    .frame(width: 186)
                    .shadow(color: .black.opacity(0.25), radius: 18, y: 12)
                    .padding(.top, 12)
            }
            Text(item.title)
                .font(.title2.bold())
                .multilineTextAlignment(.center)
                .textSelection(.enabled)
                .padding(.top, 22)
            Text([item.originalTitle, item.kind.label, item.year.map(String.init)].compactMap { $0 }.joined(separator: " · "))
                .font(.subheadline)
                .foregroundStyle(Color.muted)
                .multilineTextAlignment(.center)
                .padding(.top, 6)
            if let creators = item.creators {
                Text("\(item.kind.creatorLabel) \(creators)")
                    .font(.subheadline)
                    .foregroundStyle(Color.muted)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .padding(.top, 2)
            }

            markRow(item).padding(.top, 20)
            if mine { quickStatus(item).padding(.top, 10) }

            if mine, item.status != nil, item.status != .wish, model.me?.usesRatings ?? true {
                StarInput(rating: Binding(get: { item.rating }, set: { rating in Task { await rate(item, rating) } }))
                    .padding(.top, 16)
                if let rateError {
                    Text(rateError).font(.footnote).foregroundStyle(Color.danger).padding(.top, 6)
                }
            } else if !mine, ownerRatings, item.rating != nil {
                Stars(rating: item.rating).scaleEffect(1.4).padding(.top, 14)
            }

            VStack(alignment: .leading, spacing: 26) {
                if let comment = item.comment {
                    section(mine ? "我的短评" : "短评") {
                        Text(comment)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                            .background(RoundedRectangle(cornerRadius: 14).fill(Color.card))
                    }
                }
                if let summary = item.summary {
                    // Same rule as the web: short intros are shown whole, without 更多.
                    let folded = !summaryExpanded && (summary.count > 120 || summary.split(separator: "\n").count > 4)
                    section("简介") {
                        Text(summary)
                            .font(.subheadline)
                            .foregroundStyle(Color.muted)
                            .lineSpacing(3)
                            .lineLimit(folded ? 5 : nil)
                            .textSelection(.enabled)
                        if folded {
                            Button("更多") { withAnimation { summaryExpanded = true } }
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.ink)
                        }
                    }
                }
                if let facts = item.facts?.filter({ $0.count == 2 }), !facts.isEmpty {
                    section("资料") {
                        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 20, verticalSpacing: 8) {
                            ForEach(facts, id: \.self) { row in
                                GridRow {
                                    Text(row[0]).foregroundStyle(Color.muted)
                                    Text(row[1]).textSelection(.enabled)
                                }
                            }
                        }
                        .font(.subheadline)
                    }
                }
                if !mine, let me = model.me {
                    NavigationLink(value: Route.item(handle: me.handle, id: item.id)) {
                        Label("我的标记", systemImage: "bookmark").font(.subheadline.weight(.semibold))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 30)
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 32)
    }

    private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.title3.bold())
            content()
        }
    }

    /// Your own mark is a big button to the form; someone else's is a label.
    @ViewBuilder private func markRow(_ item: MarkedItem) -> some View {
        if mine {
            Button { editing = true } label: {
                Label(
                    item.status.map { "\($0.label(for: item.kind)) · \(monthDay(item.markedOn))" } ?? "标记这部作品",
                    systemImage: item.status == nil ? "plus" : "checkmark"
                )
                .font(.headline)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .foregroundStyle(Color.paper)
                .background(Capsule().fill(Color.ink))
            }
            .buttonStyle(.plain)
        } else if let status = item.status {
            Text("\(ownerName) \(status.label(for: item.kind)) · \(monthDay(item.markedOn))")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 18)
                .frame(height: 40)
                .background(Capsule().fill(.regularMaterial))
        }
    }

    /// 看过 / 在看 / 想看 as round buttons, like Infuse's row under Resume: one tap changes the status.
    private func quickStatus(_ item: MarkedItem) -> some View {
        HStack(spacing: 8) {
            ForEach(Status.allCases, id: \.self) { status in
                let on = item.status == status
                Button {
                    Task { await save(item, status: status) }
                } label: {
                    Label(status.label(for: item.kind), systemImage: Self.statusSymbols[status]!)
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 40)
                        .foregroundStyle(on ? Color.paper : Color.ink)
                        .background(Capsule().fill(on ? Color.ink : Color.card))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private static let statusSymbols: [Status: String] = [.done: "checkmark", .doing: "play.fill", .wish: "bookmark"]

    private func moreMenu(_ item: MarkedItem) -> some View {
        Menu {
            if mine {
                Button(item.status == nil ? "标记" : "修改标记", systemImage: "pencil") { editing = true }
            }
            if let link = item.sourceUrl.flatMap(URL.init(string:)) {
                Link(destination: link) { Label("在\(item.sourceLabel)打开", systemImage: "safari") }
            }
            if let page = model.api.url(for: "/@\(handle)/items/\(item.id)") {
                ShareLink(item: page)
            }
        } label: {
            Image(systemName: "ellipsis")
        }
    }

    @State private var ownerName = ""
    @State private var ownerRatings = true

    private var itemPath: String { "users/\(handle)/items/\(id)" }

    /// Stars on your own page save straight away, keeping the rest of the mark.
    private func rate(_ item: MarkedItem, _ rating: Int?) async {
        guard let status = item.status else { return }
        await save(item, status: status, rating: rating, markedOn: item.markedOn)
    }

    /// A new status from the round buttons starts today; the rating stays unless it is now 想看.
    private func save(_ item: MarkedItem, status: Status) async {
        let markedOn = item.status == status ? item.markedOn : model.me?.today
        await save(item, status: status, rating: status == .wish ? nil : item.rating, markedOn: markedOn)
    }

    private func save(_ item: MarkedItem, status: Status, rating: Int?, markedOn: String?) async {
        rateError = nil
        var body: [String: Any] = ["status": status.rawValue, "marked_on": markedOn ?? "", "comment": item.comment ?? ""]
        if let rating { body["rating"] = rating }
        do {
            let saved: SavedItem = try await model.api.api("PUT", "marks/\(item.id)", body: body)
            self.item = saved.item
            model.knownItems["\(handle)/\(id)"] = saved.item
            model.marksVersion += 1
        } catch {
            rateError = error.localizedDescription
        }
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
            if mine, response.item.status == nil, !offeredEditor {
                offeredEditor = true
                editing = true
            }
            if !mine, ownerName.isEmpty {
                let cached: Profile? = model.api.cached("users/\(handle)")
                ownerName = cached?.name ?? ""
                ownerRatings = cached?.usesRatings ?? true
                let profile: Profile? = try? await model.api.api("GET", "users/\(handle)")
                ownerName = profile?.name ?? "@\(handle)"
                ownerRatings = profile?.usesRatings ?? ownerRatings
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

/// Status, rating, date and comment, like the web's mark form; shown as a sheet.
struct MarkEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
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
        Form {
            Section {
                Picker("状态", selection: $status) {
                    ForEach(Status.allCases) { s in Text(s.label(for: item.kind)).tag(s) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
            }
            Section {
                // With ratings off the saved rating is kept and sent back unchanged.
                if status != .wish, model.me?.usesRatings ?? true {
                    LabeledContent("评分") { StarInput(rating: $rating) }
                }
                DatePicker("日期", selection: $date, displayedComponents: .date)
                    .environment(\.locale, Locale(identifier: "zh_CN"))
            }
            Section("短评") {
                TextField("写点什么，或者留白。", text: $comment, axis: .vertical)
                    .lineLimit(4...12)
            }
            if let error {
                Section { Text(error).foregroundStyle(Color.danger) }
            }
            if item.status != nil {
                Section {
                    Button("删除这条标记", role: .destructive) { confirmDelete = true }
                        .confirmationDialog("删除这条标记？", isPresented: $confirmDelete, titleVisibility: .visible) {
                            Button("删除", role: .destructive) { Task { await delete() } }
                        }
                }
            }
        }
        .navigationTitle(item.status == nil ? "标记这部作品" : "修改标记")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("取消", role: .cancel) { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(saving ? "保存中…" : "保存") { Task { await save() } }
                    .disabled(saving)
            }
        }
        .onAppear(perform: reset)
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

/// Landscape artwork across the top of an item page, fading into it.
struct ArtworkBackdrop: View {
    @Environment(AppModel.self) private var model
    let path: String?

    @State private var image: UIImage?

    var body: some View {
        Color.clear
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill().transition(.opacity)
                }
            }
            .clipped()
            .overlay(LinearGradient(colors: [.clear, Color.paper], startPoint: UnitPoint(x: 0.5, y: 0.5), endPoint: .bottom))
            .task(id: path) {
                let loaded = await CoverImage.image(for: path, api: model.api, maxPixels: 1400)
                withAnimation(.easeOut(duration: 0.25)) { image = loaded }
            }
    }
}
