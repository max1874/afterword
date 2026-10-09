import Foundation

/// Kinds and statuses, labelled exactly as on the web (`app/lib/kinds.ts`).
nonisolated enum Kind: String, Codable, CaseIterable, Identifiable, Hashable {
    case screen, book, comic, game

    var id: String { rawValue }

    var label: String {
        switch self {
        case .screen: "影视"
        case .book: "书"
        case .comic: "漫画"
        case .game: "游戏"
        }
    }

    var verb: String {
        switch self {
        case .screen: "看"
        case .book, .comic: "读"
        case .game: "玩"
        }
    }

    var creatorLabel: String {
        switch self {
        case .screen: "导演"
        case .book, .comic: "作者"
        case .game: "开发"
        }
    }
}

/// In the order a work goes through them, as everywhere they are listed: 想看, 在看, 看过.
nonisolated enum Status: String, Codable, CaseIterable, Identifiable, Hashable {
    case wish, doing, done

    var id: String { rawValue }

    /// 看过 / 在读 / 想玩…
    func label(for kind: Kind?) -> String {
        guard let kind else {
            return switch self {
            case .done: "已完成"
            case .doing: "进行中"
            case .wish: "计划中"
            }
        }
        return switch self {
        case .done: "\(kind.verb)过"
        case .doing: "在\(kind.verb)"
        case .wish: "想\(kind.verb)"
        }
    }
}

nonisolated struct Me: Decodable, Equatable {
    let id: String
    let handle: String
    let name: String
    let isAdmin: Bool
    /// Off when star ratings are turned off in settings; missing from older servers and caches.
    let ratings: Bool?
    /// The works chosen for the kind tiles on their home, by tile ("all", "comic"…); older servers omit it.
    let tiles: [String: String]?
    let today: String

    var usesRatings: Bool { ratings ?? true }
}

nonisolated struct KindStatusCount: Decodable, Hashable {
    let kind: Kind
    let status: Status
    let n: Int
}

nonisolated struct Profile: Decodable {
    let handle: String
    let name: String
    let ratings: Bool?
    let counts: [KindStatusCount]

    var usesRatings: Bool { ratings ?? true }

    func total(kind: Kind? = nil, status: Status? = nil) -> Int {
        counts.filter { (kind == nil || $0.kind == kind) && (status == nil || $0.status == status) }
            .reduce(0) { $0 + $1.n }
    }
}

/// A work in the catalog with one person's mark on it (the mark fields are nil when unmarked).
nonisolated struct MarkedItem: Decodable, Identifiable, Hashable {
    let id: String
    let kind: Kind
    let title: String
    let originalTitle: String?
    let year: Int?
    let creators: String?
    let summary: String?
    let source: String
    let sourceUrl: String?
    let cover: String?
    /// Landscape artwork (TMDB backdrop, Steam hero) when the server found some.
    let backdrop: String?
    /// Label and value pairs for 资料 (genres, episodes, publisher, platforms…); older servers omit it.
    let facts: [[String]]?
    let status: Status?
    let rating: Int?
    let comment: String?
    let markedOn: String?

    var sourceLabel: String {
        // Non-admin imports keep their source as `douban:<user id>`.
        let base = source.split(separator: ":").first.map(String.init) ?? source
        return ["bangumi": "Bangumi", "tmdb": "TMDB", "googlebooks": "Google Books", "douban": "豆瓣"][base] ?? source
    }
}

nonisolated struct MarksPage: Decodable {
    let page: Int
    let hasMore: Bool
    let yearCounts: [String: Int]
    let items: [MarkedItem]
}

/// The latest marks in each status, for the rows on a person's home.
nonisolated struct Shelves: Decodable {
    let doing: [MarkedItem]
    let done: [MarkedItem]
    let wish: [MarkedItem]
    /// Cover paths side by side on each kind tile, keyed by kind and "all"; older servers omit it.
    let tiles: [String: [String]]?

    subscript(status: Status) -> [MarkedItem] {
        switch status {
        case .doing: doing
        case .done: done
        case .wish: wish
        }
    }
}

nonisolated struct ItemResponse: Decodable {
    let mine: Bool
    let item: MarkedItem
}

nonisolated struct SavedItem: Decodable {
    let item: MarkedItem
}

nonisolated struct Candidate: Decodable, Identifiable, Hashable {
    let kind: Kind
    let title: String
    let originalTitle: String?
    let year: Int?
    let creators: String?
    let summary: String?
    let source: String
    let sourceId: String?
    let cover: String?
    let existingId: String?

    var id: String { "\(source):\(sourceId ?? title)" }
}

nonisolated struct SearchGroup: Decodable, Identifiable {
    let source: String
    let label: String
    let items: [Candidate]
    let error: String?

    var id: String { source }
}

nonisolated struct SearchResponse: Decodable {
    let groups: [SearchGroup]
}

nonisolated struct NewID: Decodable {
    let id: String
}

nonisolated struct ImportResult: Decodable {
    let added: Int
    let updated: Int
    let errors: [String]
}

nonisolated struct Passkey: Decodable, Identifiable, Hashable {
    let id: String
    let name: String?
    let createdAt: String
    let lastUsedAt: String?
}

nonisolated struct SessionInfo: Decodable, Identifiable, Hashable {
    let id: String
    let userAgent: String?
    let createdAt: String
    let lastSeenAt: String
    let current: Bool
}

nonisolated struct Invite: Decodable, Identifiable, Hashable {
    let code: String
    let createdAt: String
    let expiresAt: String
    let usedAt: String?
    let usedHandle: String?
    let url: String

    var id: String { code }
}

nonisolated struct AccountSettings: Decodable {
    let passkeys: [Passkey]
    let sessions: [SessionInfo]
    let recoveryLeft: Int
    let invites: [Invite]?
}

nonisolated struct SavedProfile: Decodable {
    let handle: String
    let name: String
}

nonisolated struct RecoveryCodes: Decodable {
    let codes: [String]
}

nonisolated struct CreatedInvite: Decodable {
    let code: String
    let url: String
}

/// Server times are UTC `YYYY-MM-DD HH:MM:SS`; shown as a local date.
nonisolated func shortDate(_ sqlTime: String?) -> String {
    guard let sqlTime else { return "" }
    let parser = DateFormatter()
    parser.locale = Locale(identifier: "en_US_POSIX")
    parser.timeZone = TimeZone(identifier: "UTC")
    parser.dateFormat = "yyyy-MM-dd HH:mm:ss"
    guard let date = parser.date(from: sqlTime) else { return String(sqlTime.prefix(10)) }
    return date.formatted(date: .abbreviated, time: .omitted)
}

/// `2026-10-08` as 10月8日.
nonisolated func monthDay(_ day: String?) -> String {
    guard let day, day.count >= 10, let month = Int(day.dropFirst(5).prefix(2)), let date = Int(day.dropFirst(8).prefix(2)) else { return "" }
    return "\(month)月\(date)日"
}
