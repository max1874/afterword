import SwiftUI

/// What `GET items/:id/artwork` returns: every landscape image the sources have, best first.
nonisolated struct ArtworkChoices: Decodable {
    struct Choice: Decodable, Hashable {
        let url: String
        let thumb: String
        let source: String
    }

    let current: String?
    let choices: [Choice]
}

extension Kind {
    /// Only films, series and games have landscape artwork to choose from.
    var hasArtwork: Bool { self == .screen || self == .game }
}

/// 更换横图: an admin replaces a poor automatic pick with another image from TMDB,
/// Steam, IGDB or SteamGridDB, or goes back to the cover. Items are shared, so the
/// choice shows for everyone who marked it.
struct ArtworkPicker: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let item: MarkedItem
    let onChoose: () -> Void

    @State private var loaded: ArtworkChoices?
    @State private var saving: String??
    @State private var error: String?

    var body: some View {
        ScrollView {
            if let loaded {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 10)], spacing: 10) {
                    ForEach(loaded.choices, id: \.self) { choice in
                        Button { Task { await choose(choice.url) } } label: {
                            tile(choice, current: choice.url == loaded.current)
                        }
                        .buttonStyle(.plain)
                    }
                    Button { Task { await choose(nil) } } label: {
                        RoundedRectangle(cornerRadius: 14)
                            .strokeBorder(Color.muted.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [5]))
                            .aspectRatio(16 / 9, contentMode: .fit)
                            .overlay {
                                Text(saving == .some(nil) ? "保存中…" : "不用横图，显示封面")
                                    .font(.subheadline)
                                    .foregroundStyle(Color.muted)
                            }
                            .overlay {
                                if loaded.current == nil { RoundedRectangle(cornerRadius: 14).stroke(Color.ink, lineWidth: 3) }
                            }
                    }
                    .buttonStyle(.plain)
                }
                .disabled(saving != nil)
                .padding(16)
                if loaded.choices.isEmpty {
                    Text("各来源都没有找到这部作品的横图。").font(.subheadline).foregroundStyle(Color.muted)
                }
            } else if error == nil {
                ProgressView("正在找图…").padding(.top, 80)
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(Color.danger).padding()
            }
        }
        .background(Color.paper)
        .navigationTitle("更换横图")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("取消", role: .cancel) { dismiss() }
            }
        }
        .task { await load() }
    }

    private func tile(_ choice: ArtworkChoices.Choice, current: Bool) -> some View {
        Color.card
            .aspectRatio(16 / 9, contentMode: .fit)
            .overlay {
                AsyncImage(url: URL(string: choice.thumb)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    EmptyView()
                }
            }
            .overlay(alignment: .bottomLeading) {
                Text(saving == .some(choice.url) ? "保存中…" : current ? "当前 · \(choice.source)" : choice.source)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(.black.opacity(0.45)))
                    .padding(8)
            }
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay {
                if current { RoundedRectangle(cornerRadius: 14).stroke(Color.ink, lineWidth: 3) }
            }
            .contentShape(Rectangle())
    }

    private func load() async {
        do {
            loaded = try await model.api.api("GET", "items/\(item.id)/artwork")
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func choose(_ url: String?) async {
        saving = .some(url)
        error = nil
        defer { saving = nil }
        do {
            let body: [String: Any] = ["url": url.map { $0 as Any } ?? NSNull()]
            let _: SavedItem = try await model.api.api("PUT", "items/\(item.id)/artwork", body: body)
            onChoose()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
