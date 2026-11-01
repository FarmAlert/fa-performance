import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { runTick } from "@/lib/perf/app-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Farm Alert Performance scheduled jobs (build spec 6.3 and 7) — one
// tick, called every 15 minutes by the VPS crontab (same as
// VetXpress's frequent pollers; .github/workflows/tick.yml is the
// manual fallback). lib/perf/app-jobs.js decides from Lagos time which jobs
// are due and guards each against running twice. `?job=<name>` forces one
// job (build_day_plans, evaluate_auto_tasks, reminders, rebuild_scores,
// mark_incomplete, lock_month) for testing on staging.
const FORCEABLE = new Set(["build_day_plans", "evaluate_auto_tasks", "reminders", "rebuild_scores", "mark_incomplete", "lock_month"]);

export async function POST(request) {
  if (!isAuthorizedCronRequest(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const job = new URL(request.url).searchParams.get("job");
  if (job && !FORCEABLE.has(job)) return Response.json({ error: "Unknown job." }, { status: 400 });
  try {
    const result = await runTick(new Date(), { force: job || undefined });
    return Response.json(result);
  } catch (err) {
    console.error("[cron/tick] tick failed: " + err.message);
    return Response.json({ error: "Tick failed." }, { status: 500 });
  }
}

export async function GET(request) {
  return POST(request);
}
