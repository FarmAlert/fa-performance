import "server-only";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Signed session token for the Performance App: an HMAC-SHA256-signed
// {staffId, exp, aud} value, verified with a timing-safe comparison.
// Deliberately not a Supabase session: a stolen token only works against
// this app's endpoints and expires. Signed with PERF_APP_SESSION_SECRET,
// a secret of this app's own (not shared with VetXpress's widget), so a
// token from one system can never be replayed against the other.
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — a work day

function getSecret() {
  const secret = process.env.PERF_APP_SESSION_SECRET;
  if (!secret) {
    throw new Error("PERF_APP_SESSION_SECRET is not configured (check .env) — required to sign Performance App sessions.");
  }
  return secret;
}

// `aud` separates the Performance App's 30-day session (lib/perf/app-auth.js,
// httpOnly cookie) from this widget's 12-hour token: each verifier only
// accepts its own audience, so neither can be replayed against the other.
export function issueWidgetToken(staffId, { ttlMs = TOKEN_TTL_MS, aud } = {}) {
  const payload = JSON.stringify(aud ? { staffId, exp: Date.now() + ttlMs, aud } : { staffId, exp: Date.now() + ttlMs });
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");
  return payloadB64 + "." + sig;
}

// Returns the staffId, or null if the token is missing, malformed, tampered
// with, or expired. Timing-safe signature comparison.
export function verifyWidgetToken(token, { aud } = {}) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;

  let expectedSig;
  try {
    expectedSig = crypto.createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");
  } catch {
    return null;
  }

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload || typeof payload.staffId !== "string" || typeof payload.exp !== "number") return null;
  if (Date.now() > payload.exp) return null;
  if ((payload.aud || null) !== (aud || null)) return null;

  return payload.staffId;
}
