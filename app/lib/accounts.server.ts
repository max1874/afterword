import { env } from "cloudflare:workers";
import { data } from "react-router";

import type { TileKey } from "./db.server";
import { isKind } from "./kinds";
import { base64url, sha256Hex, sqlTime } from "./session.server";

export type User = {
  id: string;
  handle: string;
  name: string;
  is_admin: number;
  created_at: string;
  /** 0 when the person turned star ratings off; missing before migration 0005. */
  ratings?: number;
  /** JSON of the works chosen for the kind tiles on their home, by tile; missing before migration 0009. */
  tiles?: string | null;
};

/** Whether this person rates what they mark; on unless they turned it off in settings. */
export const usesRatings = (user: Pick<User, "ratings"> | null | undefined) => user?.ratings !== 0;

export async function saveRatings(userId: string, on: boolean) {
  await env.DB.prepare("UPDATE users SET ratings = ? WHERE id = ?").bind(on ? 1 : 0, userId).run();
}

/** The works chosen for this person's kind tiles, by tile ("all", "screen", …). */
export function chosenTiles(user: Pick<User, "tiles"> | null | undefined): Partial<Record<TileKey, string>> {
  try {
    const value = JSON.parse(user?.tiles ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** Shows `itemId` on one of this person's kind tiles, or with null goes back to the newest mark. */
export async function saveTile(user: Pick<User, "id" | "tiles">, key: TileKey, itemId: string | null) {
  const tiles = { ...chosenTiles(user), [key]: itemId ?? undefined };
  await env.DB.prepare("UPDATE users SET tiles = ? WHERE id = ?").bind(JSON.stringify(tiles), user.id).run();
}

export const isTileKey = (value: unknown): value is TileKey => value === "all" || isKind(value);

export type Passkey = {
  id: string;
  user_id: string;
  // D1 returns BLOBs as byte arrays.
  public_key: number[] | ArrayBuffer;
  counter: number;
  transports: string | null;
  name: string;
  created_at: string;
  last_used_at: string | null;
};

const INVITE_DAYS = 14;
const RECOVERY_CODE_COUNT = 8;

export const HANDLE_PATTERN = /^[a-z0-9_]{2,20}$/;

/** Lower-cased handle if it is valid, else an error to show. */
export function checkHandle(raw: string): { handle: string } | { error: string } {
  const handle = raw.trim().replace(/^@/, "").toLowerCase();
  if (!HANDLE_PATTERN.test(handle)) return { error: "用户名需要 2–20 个字符，只能用小写字母、数字和下划线" };
  return { handle };
}

export function checkName(raw: string): { name: string } | { error: string } {
  const name = raw.trim();
  if (!name || name.length > 40) return { error: "名字需要 1–40 个字符" };
  return { name };
}

export function newUserId() {
  return crypto.randomUUID().replaceAll("-", "");
}

export async function findUserByHandle(handle: string) {
  return env.DB.prepare("SELECT * FROM users WHERE handle = ?").bind(handle).first<User>();
}

/** The user a `/@handle` path segment names; anything else is a 404. */
export async function profileFromParam(param: string) {
  const user = param.startsWith("@") ? await findUserByHandle(param.slice(1).toLowerCase()) : null;
  if (!user) throw data(null, { status: 404 });
  return user;
}

export async function getUser(id: string) {
  return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<User>();
}

/** Where old links without a handle land: the first admin's page. */
export async function firstAdmin() {
  return env.DB.prepare("SELECT * FROM users WHERE is_admin = 1 ORDER BY created_at, id LIMIT 1").first<User>();
}

export async function handleTaken(handle: string, exceptUserId?: string) {
  const row = await env.DB.prepare("SELECT id FROM users WHERE handle = ?").bind(handle).first<{ id: string }>();
  return Boolean(row && row.id !== exceptUserId);
}

/** Validates and saves a new handle and name. */
export async function saveProfile(
  userId: string,
  fields: { get(name: string): unknown },
): Promise<{ saved: { handle: string; name: string } } | { error: string }> {
  const handle = checkHandle(String(fields.get("handle") ?? ""));
  if ("error" in handle) return handle;
  const name = checkName(String(fields.get("name") ?? ""));
  if ("error" in name) return name;
  if (await handleTaken(handle.handle, userId)) return { error: "这个用户名已经有人用了" };
  try {
    await env.DB.prepare("UPDATE users SET handle = ?, name = ? WHERE id = ?")
      .bind(handle.handle, name.name, userId)
      .run();
  } catch (error) {
    // Someone took the handle between the check and the update.
    if (!String(error).includes("UNIQUE")) throw error;
    return { error: "这个用户名已经有人用了" };
  }
  return { saved: { handle: handle.handle, name: name.name } };
}

// Passkeys

export async function listPasskeys(userId: string) {
  const { results } = await env.DB.prepare(
    "SELECT id, name, transports, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at",
  )
    .bind(userId)
    .all<Omit<Passkey, "user_id" | "public_key" | "counter">>();
  return results;
}

export async function getPasskey(id: string) {
  return env.DB.prepare("SELECT * FROM passkeys WHERE id = ?").bind(id).first<Passkey>();
}

export function insertPasskeyStatement(
  userId: string,
  credential: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] },
  name: string,
) {
  return env.DB.prepare(
    "INSERT INTO passkeys (id, user_id, public_key, counter, transports, name) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(
    credential.id,
    userId,
    credential.publicKey,
    credential.counter,
    credential.transports?.join(",") ?? null,
    name,
  );
}

export async function touchPasskey(id: string, counter: number) {
  await env.DB.prepare("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?")
    .bind(counter, sqlTime(Date.now()), id)
    .run();
}

/** Deletes a passkey unless it is the person's last one. */
export async function deletePasskey(userId: string, id: string) {
  const result = await env.DB.prepare(
    `DELETE FROM passkeys WHERE id = ? AND user_id = ?
       AND (SELECT COUNT(*) FROM passkeys WHERE user_id = ?) > 1`,
  )
    .bind(id, userId, userId)
    .run();
  return result.meta.changes > 0;
}

export async function passkeyCount(userId: string) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// Names for common passkey providers, by AAGUID; anything else is just "通行密钥".
const PROVIDERS: Record<string, string> = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud 钥匙串",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud 钥匙串",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google 密码管理器",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Mac 上的 Chrome",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
};

export function passkeyName(aaguid: string) {
  return PROVIDERS[aaguid] ?? "通行密钥";
}

// Recovery codes

// Crockford base32 without look-alike letters; 10 characters carry 50 bits.
const CODE_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function normalizeCode(code: string) {
  return code.toLowerCase().replace(/[^0-9a-z]/g, "");
}

async function hashCode(userId: string, code: string) {
  return sha256Hex(`${userId}:${normalizeCode(code)}`);
}

/** New recovery codes for the user, replacing any old ones; returned once to show. */
export async function recoveryCodeStatements(userId: string) {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const chars = [...crypto.getRandomValues(new Uint8Array(10))].map((b) => CODE_ALPHABET[b % 32]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
  const statements = [
    env.DB.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(userId),
    ...(await Promise.all(
      codes.map(async (code) =>
        env.DB.prepare("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)").bind(
          userId,
          await hashCode(userId, code),
        ),
      ),
    )),
  ];
  return { codes, statements };
}

/** Spends a recovery code; true when it was valid and unused. */
export async function spendRecoveryCode(userId: string, code: string) {
  const result = await env.DB.prepare(
    "UPDATE recovery_codes SET used_at = datetime('now') WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",
  )
    .bind(userId, await hashCode(userId, code))
    .run();
  return result.meta.changes > 0;
}

export async function unusedRecoveryCodes(userId: string) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL",
  )
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// Invites

export type Invite = {
  code: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_handle: string | null;
};

export async function createInvite(createdBy: string) {
  const code = base64url(crypto.getRandomValues(new Uint8Array(12)));
  await env.DB.prepare("INSERT INTO invites (code, created_by, expires_at) VALUES (?, ?, ?)")
    .bind(code, createdBy, sqlTime(Date.now() + INVITE_DAYS * 24 * 3600_000))
    .run();
  return code;
}

export async function listInvites(createdBy: string) {
  const { results } = await env.DB.prepare(
    `SELECT i.code, i.created_at, i.expires_at, i.used_at, u.handle AS used_handle
     FROM invites i LEFT JOIN users u ON u.id = i.used_by
     WHERE i.created_by = ? ORDER BY i.created_at DESC LIMIT 50`,
  )
    .bind(createdBy)
    .all<Invite>();
  return results;
}

export async function revokeInvite(createdBy: string, code: string) {
  await env.DB.prepare("DELETE FROM invites WHERE code = ? AND created_by = ? AND used_at IS NULL")
    .bind(code, createdBy)
    .run();
}

/** An invite that can still be used, or null. */
export async function openInvite(code: string) {
  return env.DB.prepare(
    "SELECT code FROM invites WHERE code = ? AND used_at IS NULL AND expires_at > datetime('now')",
  )
    .bind(code)
    .first<{ code: string }>();
}

// Sessions

export async function listSessions(userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT id, user_agent, created_at, last_seen_at FROM sessions
     WHERE user_id = ? AND expires_at > datetime('now') ORDER BY last_seen_at DESC`,
  )
    .bind(userId)
    .all<{ id: string; user_agent: string | null; created_at: string; last_seen_at: string }>();
  return results;
}

export async function deleteSession(userId: string, id: string) {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").bind(id, userId).run();
}

export async function deleteOtherSessions(userId: string, keepId: string) {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(userId, keepId).run();
}
