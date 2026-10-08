import ImageIO
import SwiftUI
import UIKit

/// iOS's own semantic colours, matching the web's Apple neutrals (`app/app.css`):
/// the covers are the only colour, and everything follows light and dark mode.
extension Color {
    static let paper = Color(uiColor: .systemBackground)
    static let card = Color(uiColor: .secondarySystemBackground)
    static let ink = Color(uiColor: .label)
    static let muted = Color(uiColor: .secondaryLabel)
    static let line = Color(uiColor: .separator)
    static let accent = Color(uiColor: .label)
    static let accentInk = Color(uiColor: .systemBackground)
    static let danger = Color(uiColor: .systemRed)
}

/// A cover at the web's 2:3 ratio, loaded with the session so proxied search previews work.
struct CoverImage: View {
    @Environment(AppModel.self) private var model
    let path: String?
    let title: String

    @State private var image: UIImage?

    init(path: String?, title: String) {
        self.path = path
        self.title = title
        // Already decoded covers show on the first frame instead of after a task hop.
        _image = State(initialValue: path.flatMap { CoverCache.shared.object(forKey: $0 as NSString) })
    }

    var body: some View {
        Rectangle()
            .fill(Color.card)
            .aspectRatio(2 / 3, contentMode: .fit)
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Text(title)
                        .font(.caption)
                        .foregroundStyle(Color.muted)
                        .multilineTextAlignment(.center)
                        .padding(6)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.black.opacity(0.08), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.14), radius: 7, y: 4)
            .task(id: path) { image = await Self.image(for: path, api: model.api) }
    }

    /// The cover for a path, decoded once and kept in memory.
    static func image(for path: String?, api: APIClient) async -> UIImage? {
        guard let path, let url = api.url(for: path) else { return nil }
        if let cached = CoverCache.shared.object(forKey: path as NSString) { return cached }
        guard let data = try? await api.data(from: url), let loaded = await thumbnail(data) else { return nil }
        CoverCache.shared.setObject(loaded, forKey: path as NSString)
        return loaded
    }

    /// Decoded and scaled down off the main thread; covers are up to 1024px tall and
    /// decoding them while scrolling drops frames.
    @concurrent
    private static func thumbnail(_ data: Data) async -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: 600,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }
}

/// A cover blurred into a wash of its colours, fading into the page; behind the top of item pages.
struct CoverBackdrop: View {
    @Environment(AppModel.self) private var model
    let path: String?

    @State private var image: UIImage?

    init(path: String?) {
        self.path = path
        _image = State(initialValue: path.flatMap { CoverCache.shared.object(forKey: $0 as NSString) })
    }

    var body: some View {
        Color.clear
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .blur(radius: 50)
                        .saturation(1.4)
                        .opacity(0.55)
                        .transition(.opacity)
                }
            }
            .clipped()
            .overlay(LinearGradient(colors: [.clear, Color.paper], startPoint: UnitPoint(x: 0.5, y: 0.35), endPoint: .bottom))
            .task(id: path) {
                let loaded = await CoverImage.image(for: path, api: model.api)
                withAnimation(.easeOut(duration: 0.25)) { image = loaded }
            }
    }
}

enum CoverCache {
    static let shared: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 300
        return cache
    }()
}

struct Stars: View {
    let rating: Int?

    var body: some View {
        if let rating, rating > 0 {
            HStack(spacing: 1) {
                ForEach(1...5, id: \.self) { i in
                    Image(systemName: i <= rating ? "star.fill" : "star")
                        .font(.system(size: 10))
                        .foregroundStyle(i <= rating ? Color.accent : Color.line)
                }
            }
            .accessibilityLabel("\(rating) 星")
        }
    }
}

struct StarInput: View {
    @Binding var rating: Int?

    var body: some View {
        HStack(spacing: 6) {
            ForEach(1...5, id: \.self) { i in
                Button {
                    rating = rating == i ? nil : i
                } label: {
                    Image(systemName: i <= (rating ?? 0) ? "star.fill" : "star")
                        .font(.title2)
                        .foregroundStyle(i <= (rating ?? 0) ? Color.accent : Color.muted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(i) 星")
            }
        }
    }
}

/// Joins Chinese with a Latin name the way the web does: a space only next to Latin text.
func joinText(_ a: String, _ b: String) -> String {
    let latin = a.last.map { $0.isASCII && ($0.isLetter || $0.isNumber) } ?? false
    return latin ? "\(a) \(b)" : a + b
}
