import { cookies } from "next/headers";
import { authenticateAppRequest, APP_SESSION_COOKIE } from "@/lib/perf/app-auth";
import { removePushSubscriptions } from "@/lib/db/perf-app-notify";

// Sign out: clears the session cookie and forgets this person's push
// devices, so a shared or handed-back phone stops getting their reminders.
export const runtime = "nodejs";

export async function POST(request) {
  if (request.headers.get("x-perf-app") !== "1") return Response.json({ error: "Forbidden." }, { status: 403 });
  const auth = await authenticateAppRequest(request);
  if (auth.staff) await removePushSubscriptions(auth.staff.id);
  const jar = await cookies();
  jar.delete(APP_SESSION_COOKIE);
  return Response.json({ ok: true });
}
