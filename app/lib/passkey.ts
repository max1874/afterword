import {
  sendSignal,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  WebAuthnError,
} from "@simplewebauthn/browser";

/** Browser side of the passkey ceremonies served by /auth/passkey. */

export class PasskeyError extends Error {
  constructor(
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function post<T>(step: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/auth/passkey", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step, ...payload }),
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new PasskeyError(data.error ?? `HTTP ${res.status}`, data);
  return data as T;
}

/** A readable message for anything a ceremony throws. */
export function passkeyMessage(error: unknown) {
  if (error instanceof PasskeyError) return error.message;
  if (error instanceof WebAuthnError) {
    if (error.code === "ERROR_CEREMONY_ABORTED") return null;
    if (error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return "这台设备上已经有这个账号的通行密钥了";
  }
  if (error instanceof Error && error.name === "NotAllowedError") return "已取消，或者超时了";
  if (error instanceof Error && error.name === "AbortError") return null;
  return error instanceof Error ? error.message : String(error);
}

export type Registered = { codes?: string[]; next?: string; ok?: true };

/** Creates a passkey: for the owner's first setup, an invited sign-up, or another device. */
type Options<T extends (...args: never) => unknown> = { options: Parameters<T>[0]["optionsJSON"]; ceremony: string };

export async function registerPasskey(kind: "setup" | "join" | "add", fields: Record<string, unknown> = {}) {
  const { options, ceremony } = await post<Options<typeof startRegistration>>(`${kind}-options`, fields);
  const response = await startRegistration({ optionsJSON: options });
  return post<Registered>(`${kind}-verify`, { response, ceremony });
}

/**
 * Signs in with a passkey. With `autofill`, waits for the person to pick one
 * from the username field's suggestions instead of opening a dialog.
 */
export async function signIn(next: string, autofill = false) {
  const { options, ceremony } = await post<Options<typeof startAuthentication>>("login-options");
  const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill: autofill });
  try {
    return await post<{ next: string }>("login-verify", { response, next, ceremony });
  } catch (error) {
    if (error instanceof PasskeyError && error.detail.unknownCredential) {
      await signal({ signalName: "unknownCredential", rpID: location.hostname, credentialID: response.id });
    }
    throw error;
  }
}

export function cancelPending() {
  WebAuthnAbortService.cancelCeremony();
}

type Signal =
  | { signalName: "unknownCredential"; rpID: string; credentialID: string }
  | { signalName: "allAcceptedCredentials"; rpID: string; userID: string; allAcceptedCredentialIDs: string[] }
  | { signalName: "currentUserDetails"; rpID: string; userID: string; name: string; displayName: string };

/**
 * Tells the passkey provider what changed (a deleted passkey, a new name) so
 * it stops offering stale entries. Browsers without the Signal API ignore it.
 */
export async function signal(opts: Signal) {
  try {
    await sendSignal(opts as Parameters<typeof sendSignal>[0]);
  } catch {
    // Unsupported or refused; nothing to do.
  }
}

/** WebAuthn user handle for signals: the user id's UTF-8 bytes, base64url. */
export function userHandle(userId: string) {
  const bytes = new TextEncoder().encode(userId);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
