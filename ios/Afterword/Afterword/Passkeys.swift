import AuthenticationServices
import UIKit

/// Passkeys through the system sheet, translated to the WebAuthn JSON the
/// server's `/auth/passkey` ceremonies expect. The relying party is the site's
/// domain, which lists this app in its apple-app-site-association.
@MainActor
final class Passkeys: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    static let relyingParty = "afterword.max1874.com"

    private var continuation: CheckedContinuation<ASAuthorization, Error>?

    /// `options` is the server's `PublicKeyCredentialRequestOptionsJSON`.
    func assert(options: [String: Any]) async throws -> [String: Any] {
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: Self.relyingParty)
        let request = provider.createCredentialAssertionRequest(challenge: try challenge(options))
        request.userVerificationPreference = .required
        let authorization = try await perform(request)
        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw PasskeyFailure.unexpected
        }
        let id = credential.credentialID.base64URL
        return [
            "id": id,
            "rawId": id,
            "type": "public-key",
            "authenticatorAttachment": "platform",
            "clientExtensionResults": [String: Any](),
            "response": [
                "clientDataJSON": credential.rawClientDataJSON.base64URL,
                "authenticatorData": credential.rawAuthenticatorData.base64URL,
                "signature": credential.signature.base64URL,
                "userHandle": credential.userID.base64URL,
            ],
        ]
    }

    /// `options` is the server's `PublicKeyCredentialCreationOptionsJSON`.
    func register(options: [String: Any]) async throws -> [String: Any] {
        guard let user = options["user"] as? [String: Any],
              let name = user["name"] as? String,
              let userID = (user["id"] as? String).flatMap(Data.init(base64URL:))
        else { throw PasskeyFailure.unexpected }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: Self.relyingParty)
        let request = provider.createCredentialRegistrationRequest(challenge: try challenge(options), name: name, userID: userID)
        request.userVerificationPreference = .required
        request.excludedCredentials = ((options["excludeCredentials"] as? [[String: Any]]) ?? [])
            .compactMap { ($0["id"] as? String).flatMap(Data.init(base64URL:)) }
            .map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
        let authorization = try await perform(request)
        guard let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
              let attestation = credential.rawAttestationObject
        else { throw PasskeyFailure.unexpected }
        let id = credential.credentialID.base64URL
        return [
            "id": id,
            "rawId": id,
            "type": "public-key",
            "authenticatorAttachment": "platform",
            "clientExtensionResults": [String: Any](),
            "response": [
                "clientDataJSON": credential.rawClientDataJSON.base64URL,
                "attestationObject": attestation.base64URL,
                "transports": ["internal", "hybrid"],
            ],
        ]
    }

    private func challenge(_ options: [String: Any]) throws -> Data {
        guard let value = options["challenge"] as? String, let data = Data(base64URL: value) else { throw PasskeyFailure.unexpected }
        return data
    }

    private func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        MainActor.assumeIsolated {
            continuation?.resume(returning: authorization)
            continuation = nil
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        MainActor.assumeIsolated {
            let canceled = (error as? ASAuthorizationError)?.code == .canceled
            continuation?.resume(throwing: canceled ? PasskeyFailure.canceled : error)
            continuation = nil
        }
    }

    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            if let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) { return window }
            return ASPresentationAnchor(windowScene: scenes.first!)
        }
    }
}

enum PasskeyFailure: LocalizedError {
    case canceled
    case unexpected

    var errorDescription: String? {
        switch self {
        case .canceled: "已取消"
        case .unexpected: "通行密钥返回了意外的结果"
        }
    }
}

extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    init?(base64URL value: String) {
        var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        self.init(base64Encoded: base64)
    }
}
