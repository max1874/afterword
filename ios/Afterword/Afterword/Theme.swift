import SwiftUI
import UIKit

/// The web's palette (`app/app.css`), light and dark.
extension Color {
    static let paper = Color(light: 0xF5F0E6, dark: 0x191714)
    static let card = Color(light: 0xFBF8F2, dark: 0x221F1B)
    static let ink = Color(light: 0x2A2521, dark: 0xE9E2D6)
    static let muted = Color(light: 0x857A6E, dark: 0x9A8F82)
    static let line = Color(light: 0xE2D9CA, dark: 0x36312B)
    static let seal = Color(light: 0xB5402C, dark: 0xD0624B)
    static let sealInk = Color(light: 0xFBF8F2, dark: 0x191714)

    init(light: UInt32, dark: UInt32) {
        func color(_ hex: UInt32) -> UIColor {
            UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: 1
            )
        }
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? color(dark) : color(light) })
    }
}

/// A cover at the web's 2:3 ratio, loaded with the session so proxied search previews work.
struct CoverImage: View {
    @Environment(AppModel.self) private var model
    let path: String?
    let title: String

    @State private var image: UIImage?

    var body: some View {
        Rectangle()
            .fill(Color.line.opacity(0.6))
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
            .clipShape(RoundedRectangle(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.line, lineWidth: 0.5))
            .task(id: path) { await load() }
    }

    private func load() async {
        guard let path, let url = model.api.url(for: path) else { image = nil; return }
        if let cached = CoverCache.shared.object(forKey: url as NSURL) { image = cached; return }
        guard let data = try? await model.api.data(from: url), let loaded = UIImage(data: data) else { return }
        CoverCache.shared.setObject(loaded, forKey: url as NSURL)
        image = loaded
    }
}

enum CoverCache {
    static let shared: NSCache<NSURL, UIImage> = {
        let cache = NSCache<NSURL, UIImage>()
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
                        .foregroundStyle(i <= rating ? Color.seal : Color.line)
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
                        .foregroundStyle(i <= (rating ?? 0) ? Color.seal : Color.muted)
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
