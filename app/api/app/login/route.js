import { cookies } from "next/headers";
import {
  verifyStaffCredentials,
  isPerfWidgetLoginLocked,
  recordFailedPerfWidgetLogin,
  clearPerfWidgetLoginAttempts,
  PerfStaffAuthError,
} from "@/lib/db/perf-staff";
import { issueAppSession, sessionCookieOptions, APP_SESSION_COOKIE } from "@/lib/perf/app-auth";

// Performance App sign-in (spec 8.3 screen 01). Same staff logins, same
// wrong-password lockout as the WordPress widget (lib/db/perf-staff.js);
// on success the 30-day session goes into an httpOnly cookie, never into
// page JavaScript.
export const runtime = "nodejs";

export async function POST(request) {
  if (request.headers.get("x-perf-app") !== "1") return Response.json({ error: "Forbidden." }, { status: 403 });
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 254) : "";
  const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
  if (!email || !password) return Response.json({ error: "Enter your work email and password." }, { status: 400 });

  if (await isPerfWidgetLoginLocked(email)) {
    return Response.json({ error: "Too many wrong passwords. Try again in 30 minutes, or ask HR to reset your password." }, { status: 429 });
  }

  try {
    const staff = await verifyStaffCredentials(email, password);
    await clearPerfWidgetLoginAttempts(email);
    const jar = await cookies();
    jar.set(APP_SESSION_COOKIE, issueAppSession(staff.id), sessionCookieOptions());
    return Response.json({ ok: true, mustChangePassword: !!staff.mustChangePassword });
  } catch (err) {
    if (err instanceof PerfStaffAuthError) {
      await recordFailedPerfWidgetLogin(email);
      const msg = /inactive/i.test(err.message)
        ? "Your account is disabled. Ask HR."
        : /No staff account/i.test(err.message)
          ? "Ask HR to link your Employee record."
          : "Wrong email or password.";
      return Response.json({ error: msg }, { status: 401 });
    }
    console.error("[api/app/login] failed: " + err.message);
    return Response.json({ error: "Couldn't sign you in. Please try again." }, { status: 500 });
  }
}
