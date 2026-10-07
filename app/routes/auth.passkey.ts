import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { env } from "cloudflare:workers";

import type { Route } from "./+types/auth.passkey";
import {
  checkHandle,
  checkName,
  firstAdmin,
  getPasskey,
  getUser,
  handleTaken,
  insertPasskeyStatement,
  listPasskeys,
  newUserId,
  openInvite,
  passkeyCount,
  passkeyName,
  recoveryCodeStatements,
  touchPasskey,
} from "~/lib/accounts.server";
import { safeNext } from "~/lib/format";
import { createSession, getViewer, saveCeremony, takeCeremony, type Ceremony } from "~/lib/session.server";

/**
 * JSON endpoint for every passkey ceremony. Each `*-options` step returns
 * WebAuthn options and remembers the challenge in a signed cookie; the
 * matching `*-verify` step checks the browser's response against it.
 */

type Body = {
  step?: string;
  handle?: string;
  name?: string;
  password?: string;
  invite?: string;
  next?: string;
  response?: RegistrationResponseJSON & AuthenticationResponseJSON;
};

function fail(error: string, status = 400, extra?: Record<string, unknown>, cookies: string[] = []) {
  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return Response.json({ error, ...extra }, { status, headers });
}

function ok(body: unknown, cookies: string[] = []) {
  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return Response.json(body, { headers });
}

function relyingParty(request: Request) {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin };
}

const encoder = new TextEncoder();

async function checkOwnerPassword(password: string) {
  const expected = env.OWNER_PASSWORD;
  if (!expected) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(password)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function registrationOptions(
  request: Request,
  user: { id: string; handle: string; name: string },
  ceremony: Omit<Extract<Ceremony, { userId: string }>, "challenge">,
) {
  const { rpID } = relyingParty(request);
  const existing = await listPasskeys(user.id);
  const options = await generateRegistrationOptions({
    rpName: "后记",
    rpID,
    userName: user.handle,
    userDisplayName: user.name,
    userID: encoder.encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports?.split(",") })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  return ok(options, [await saveCeremony({ ...ceremony, challenge: options.challenge } as Ceremony)]);
}

async function verifyRegistration(request: Request, ceremony: Ceremony, response: RegistrationResponseJSON) {
  const { rpID, origin } = relyingParty(request);
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
    return result.verified ? result.registrationInfo : null;
  } catch (error) {
    console.warn("registration failed", error);
    return null;
  }
}

/** Fields for a new account or the owner's first setup, validated. */
async function profileFields(body: Body, userId?: string) {
  const handle = checkHandle(body.handle ?? "");
  if ("error" in handle) return handle;
  const name = checkName(body.name ?? "");
  if ("error" in name) return name;
  if (await handleTaken(handle.handle, userId)) return { error: "这个用户名已经有人用了" };
  return { handle: handle.handle, name: name.name };
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return fail("Method not allowed", 405);
  const body = (await request.json().catch(() => ({}))) as Body;

  switch (body.step) {
    case "login-options": {
      const { rpID } = relyingParty(request);
      const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
      return ok(options, [await saveCeremony({ purpose: "login", challenge: options.challenge })]);
    }

    case "login-verify": {
      const { ceremony, clear } = await takeCeremony(request);
      if (ceremony?.purpose !== "login" || !body.response) return fail("登录请求过期了，请再试一次", 400, {}, [clear]);
      const passkey = await getPasskey(body.response.id);
      if (!passkey) {
        // Lets the browser hide a passkey whose account no longer has it.
        return fail("后记里没有这个通行密钥", 400, { unknownCredential: true }, [clear]);
      }
      const { rpID, origin } = relyingParty(request);
      let verified = false;
      let newCounter = passkey.counter;
      try {
        const result = await verifyAuthenticationResponse({
          response: body.response,
          expectedChallenge: ceremony.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: false,
          credential: {
            id: passkey.id,
            publicKey: new Uint8Array(passkey.public_key),
            counter: passkey.counter,
            transports: passkey.transports?.split(","),
          },
        });
        verified = result.verified;
        newCounter = result.authenticationInfo.newCounter;
      } catch (error) {
        console.warn("authentication failed", error);
      }
      if (!verified) return fail("通行密钥验证失败", 401, {}, [clear]);
      await touchPasskey(passkey.id, newCounter);
      const user = await getUser(passkey.user_id);
      const next = safeNext(body.next ?? null);
      return ok({ next: next === "/" ? `/@${user!.handle}` : next }, [
        clear,
        await createSession(request, passkey.user_id),
      ]);
    }

    case "setup-options": {
      const admin = await firstAdmin();
      if (!admin || (await passkeyCount(admin.id)) > 0) return fail("已经设置过了，请直接登录", 409);
      if (!(await checkOwnerPassword(body.password ?? ""))) return fail("密码不对", 401);
      const fields = await profileFields(body, admin.id);
      if ("error" in fields) return fail(fields.error);
      return registrationOptions(
        request,
        { id: admin.id, ...fields },
        { purpose: "setup", userId: admin.id, ...fields },
      );
    }

    case "join-options": {
      if (!body.invite || !(await openInvite(body.invite))) return fail("邀请链接无效或已经用过了", 410);
      const fields = await profileFields(body);
      if ("error" in fields) return fail(fields.error);
      const userId = newUserId();
      return registrationOptions(
        request,
        { id: userId, ...fields },
        { purpose: "join", userId, invite: body.invite, ...fields },
      );
    }

    case "add-options": {
      const viewer = await getViewer(request);
      if (!viewer) return fail("请先登录", 401);
      return registrationOptions(request, viewer, { purpose: "add", userId: viewer.id });
    }

    case "setup-verify":
    case "join-verify":
    case "add-verify": {
      const purpose = body.step.slice(0, -"-verify".length);
      const { ceremony, clear } = await takeCeremony(request);
      if (ceremony?.purpose !== purpose || !body.response) return fail("请求过期了，请再试一次", 400, {}, [clear]);
      const info = await verifyRegistration(request, ceremony, body.response);
      if (!info) return fail("通行密钥没有创建成功", 400, {}, [clear]);
      const passkey = insertPasskeyStatement(ceremony.userId, info.credential, passkeyName(info.aaguid));

      if (ceremony.purpose === "add") {
        const viewer = await getViewer(request);
        if (viewer?.id !== ceremony.userId) return fail("请先登录", 401, {}, [clear]);
        await passkey.run();
        return ok({ ok: true }, [clear]);
      }

      const { codes, statements } = await recoveryCodeStatements(ceremony.userId);

      if (ceremony.purpose === "setup") {
        if ((await passkeyCount(ceremony.userId)) > 0) return fail("已经设置过了，请直接登录", 409, {}, [clear]);
        await env.DB.batch([
          env.DB.prepare("UPDATE users SET handle = ?, name = ? WHERE id = ?").bind(
            ceremony.handle,
            ceremony.name,
            ceremony.userId,
          ),
          passkey,
          ...statements,
        ]);
      } else {
        // Claim the invite first so it cannot be used twice, and give it back if the account fails.
        const claim = await env.DB.prepare(
          "UPDATE invites SET used_at = datetime('now') WHERE code = ? AND used_at IS NULL AND expires_at > datetime('now')",
        )
          .bind(ceremony.invite)
          .run();
        if (claim.meta.changes === 0) return fail("邀请链接无效或已经用过了", 410, {}, [clear]);
        try {
          await env.DB.batch([
            env.DB.prepare("INSERT INTO users (id, handle, name) VALUES (?, ?, ?)").bind(
              ceremony.userId,
              ceremony.handle,
              ceremony.name,
            ),
            passkey,
            ...statements,
            env.DB.prepare("UPDATE invites SET used_by = ? WHERE code = ?").bind(ceremony.userId, ceremony.invite),
          ]);
        } catch (error) {
          await env.DB.prepare("UPDATE invites SET used_at = NULL WHERE code = ?").bind(ceremony.invite).run();
          const taken = String(error).includes("UNIQUE") && String(error).includes("handle");
          return fail(taken ? "这个用户名已经有人用了" : "注册没有成功，请再试一次", 400, {}, [clear]);
        }
      }

      return ok({ codes, next: `/@${ceremony.handle}` }, [clear, await createSession(request, ceremony.userId)]);
    }

    default:
      return fail("Unknown step");
  }
}
