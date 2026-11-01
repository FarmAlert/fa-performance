import "server-only";
import webpush from "web-push";
import { getServiceClient } from "./serviceClient";
import { isQuietHours, lagosDate, lagosInstant, DAILY_REMINDER_CAP } from "../perf/app-core";

// ---------------------------------------------------------------------------
// Farm Alert Performance App — notifications (spec 7).
//
// Every notification is stored (perf_notifications, the app's in-app
// inbox and the audit trail), then pushed with Web Push when it's allowed:
//   - never between 20:00 and 07:00 Lagos (reminders in that window are
//     dropped entirely; event messages are kept in-app and not pushed);
//   - at most 6 reminder pushes per person per day — past that, reminders
//     are kept in-app only;
//   - dedupe_key makes every scheduled reminder fire at most once, however
//     often the 15-minute job runs.
//
// Push uses the browser's Web Push service with VAPID keys
// (PERF_PUSH_VAPID_PUBLIC_KEY / PERF_PUSH_VAPID_PRIVATE_KEY /
// PERF_PUSH_VAPID_SUBJECT). Unset = no pushes, in-app only, never an error
// (same optional-integration convention as RESEND_API_KEY).
// ---------------------------------------------------------------------------

let vapidReady = null;
function pushConfigured() {
  if (vapidReady !== null) return vapidReady;
  const pub = process.env.PERF_PUSH_VAPID_PUBLIC_KEY;
  const priv = process.env.PERF_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.PERF_PUSH_VAPID_SUBJECT || "mailto:tech@farmalert.com.ng";
  if (!pub || !priv) {
    vapidReady = false;
    return false;
  }
  try {
    webpush.setVapidDetails(subject, pub, priv);
    vapidReady = true;
  } catch (err) {
    console.error("[perf-app] invalid VAPID configuration: " + err.message);
    vapidReady = false;
  }
  return vapidReady;
}

export function pushPublicKey() {
  return pushConfigured() ? process.env.PERF_PUSH_VAPID_PUBLIC_KEY : null;
}

async function remindersPushedToday(staffId) {
  const today = lagosDate();
  const { count, error } = await getServiceClient()
    .from("perf_notifications")
    .select("id", { count: "exact", head: true })
    .eq("staff_id", staffId)
    .eq("is_reminder", true)
    .eq("pushed", true)
    .gte("created_at", lagosInstant(today, "00:00").toISOString());
  if (error) throw error;
  return count || 0;
}

async function sendPush(staffId, payload) {
  if (!pushConfigured()) return false;
  const sb = getServiceClient();
  const { data: subs, error } = await sb.from("perf_push_subscriptions").select("id, endpoint, keys").eq("staff_id", staffId);
  if (error) throw error;
  let delivered = false;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 60 * 60, timeout: 8000 });
      delivered = true;
    } catch (err) {
      // 404/410: the browser dropped this subscription — forget it.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await sb.from("perf_push_subscriptions").delete().eq("id", s.id);
      } else {
        console.error("[perf-app] push to " + staffId + " failed: " + (err.statusCode || "") + " " + err.message);
      }
    }
  }
  return delivered;
}

// opts: { kind, title, body, url, reminder, dedupeKey }
// Returns { stored, pushed }. Never throws — a failed notification must not
// fail the action that triggered it (an idea is still saved if its
// acknowledgement push fails); errors are logged.
export async function notify(staffId, { kind, title, body, url = "/", reminder = false, dedupeKey = null }) {
  try {
    const quiet = isQuietHours();
    if (reminder && quiet) return { stored: false, pushed: false };

    let canPush = !quiet;
    if (reminder && canPush) canPush = (await remindersPushedToday(staffId)) < DAILY_REMINDER_CAP;

    const sb = getServiceClient();
    const { data, error } = await sb
      .from("perf_notifications")
      .insert({ staff_id: staffId, kind, is_reminder: reminder, title: String(title).slice(0, 140), body: String(body).slice(0, 500), url, dedupe_key: dedupeKey })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return { stored: false, pushed: false }; // already sent
      throw error;
    }

    let pushed = false;
    if (canPush) {
      pushed = await sendPush(staffId, { title, body, url, tag: kind });
      if (pushed) await sb.from("perf_notifications").update({ pushed: true }).eq("id", data.id);
    }
    return { stored: true, pushed };
  } catch (err) {
    console.error("[perf-app] notify(" + kind + ") for " + staffId + " failed: " + err.message);
    return { stored: false, pushed: false };
  }
}

// ---------------------------------------------------------------------------
// Device registration (spec 9 register_device).
// ---------------------------------------------------------------------------

export async function registerPushSubscription(staffId, { endpoint, keys, platform }) {
  if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) throw new Error("Invalid push endpoint.");
  if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") throw new Error("Invalid push keys.");
  const { error } = await getServiceClient()
    .from("perf_push_subscriptions")
    .upsert(
      { staff_id: staffId, endpoint, keys: { p256dh: keys.p256dh.slice(0, 200), auth: keys.auth.slice(0, 100) }, platform: String(platform || "web").slice(0, 40), last_seen: new Date().toISOString() },
      { onConflict: "endpoint" }
    );
  if (error) throw error;
  return { ok: true };
}

// Exit / sign-out: forget every device for this person (spec 10.2 —
// devices are removed at exit).
export async function removePushSubscriptions(staffId) {
  const { error } = await getServiceClient().from("perf_push_subscriptions").delete().eq("staff_id", staffId);
  if (error) console.error("[perf-app] couldn't remove push subscriptions: " + error.message);
}

export async function listNotifications(staffId, limit = 30) {
  const { data, error } = await getServiceClient()
    .from("perf_notifications")
    .select("id, kind, title, body, url, read_at, created_at")
    .eq("staff_id", staffId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, url: n.url, read: !!n.read_at, at: n.created_at }));
}

export async function markNotificationsRead(staffId) {
  const { error } = await getServiceClient().from("perf_notifications").update({ read_at: new Date().toISOString() }).eq("staff_id", staffId).is("read_at", null);
  if (error) throw error;
  return { ok: true };
}
