import "server-only";
import { getServiceClient } from "@/lib/db/serviceClient";
import { getStaffById } from "@/lib/db/perf-staff";
import { buildAllDayPlans, evaluateAllAutoTasks, addSystemTask } from "@/lib/db/perf-app-tasks";
import { rebuildScores, markIncomplete, lockMonth, monthLabel } from "@/lib/db/perf-app-scores";
import { notify } from "@/lib/db/perf-app-notify";
import { ratingsDue } from "@/lib/db/perf-app-team";
import { lagosParts, lagosDate, monthOf, addMonths, timeToMinutes, formatTime12, formatNaira, monthPhase, RATING_DUE_DAY } from "@/lib/perf/app-core";

// ---------------------------------------------------------------------------
// Farm Alert Performance App — the scheduled jobs from spec 6.3 and 7,
// driven by ONE endpoint (app/api/cron/perf-app) called every 15 minutes.
// Each tick works out from Lagos time what is due:
//
//   05:00+          build_day_plans     once a day
//   every tick      evaluate_auto_tasks 05:00–22:00
//   every tick      reminders           07:00–20:00 (quiet hours respected)
//   00:30+          rebuild_scores      once a day, this month + last if open
//   Day 1, 06:00+   open_rating_tasks   once a month
//   Day 4, 00:00+   mark_incomplete     (= "Day 3, 23:59") once a month
//   Day 6, 00:00+   lock_month          (= "Day 5, 23:59") once a month
//
// perf_job_runs (job, run_key) is the once-only guard, so overlapping or
// retried ticks never double-run a job. One endpoint instead of seven
// because Vercel Hobby's cron slots are used up (CLAUDE.md Addendum C) —
// the VPS crontab calls it, same as cart-recovery-reminders.
// ---------------------------------------------------------------------------

async function runOnce(job, runKey, fn) {
  const sb = getServiceClient();
  const { error } = await sb.from("perf_job_runs").insert({ job, run_key: runKey });
  if (error) {
    if (error.code === "23505") return { job, skipped: "already ran" };
    throw error;
  }
  try {
    const result = await fn();
    await sb.from("perf_job_runs").update({ finished_at: new Date().toISOString(), result }).eq("job", job).eq("run_key", runKey);
    return { job, ...result };
  } catch (err) {
    // Release the guard so the next tick retries (CLAUDE.md Section 10).
    await sb.from("perf_job_runs").delete().eq("job", job).eq("run_key", runKey);
    throw err;
  }
}

async function safe(name, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error("[perf-app jobs] " + name + " failed: " + err.message);
    return { job: name, error: err.message };
  }
}

function firstName(staff) {
  return String(staff.name || "").split(" ")[0];
}

async function remindersTick(today, now) {
  const p = lagosParts(now);
  const mins = p.minutes;
  if (mins < 7 * 60 || mins >= 20 * 60) return { job: "reminders", skipped: "quiet hours" };
  const sb = getServiceClient();
  const { data: tasks, error } = await sb
    .from("perf_daily_tasks")
    .select("id, staff_id, title, due_time, status, source, progress, target, template_id, reminded_due_at, reminded_overdue_at, template:perf_task_templates(auto_rule:perf_auto_rules(key, measure))")
    .eq("task_date", today)
    .neq("status", "cancelled");
  if (error) throw error;

  const byStaff = new Map();
  (tasks || []).forEach((t) => {
    if (!byStaff.has(t.staff_id)) byStaff.set(t.staff_id, []);
    byStaff.get(t.staff_id).push(t);
  });
  const staffCache = new Map();
  const getStaff = async (id) => {
    if (!staffCache.has(id)) staffCache.set(id, await getStaffById(id));
    return staffCache.get(id);
  };
  let sent = 0;

  for (const [staffId, list] of byStaff) {
    const staff = await getStaff(staffId);
    if (!staff?.active) continue;
    const muted = new Set(staff.mutedTemplateIds || []);
    const open = list.filter((t) => t.status === "open").sort((a, b) => String(a.due_time || "99").localeCompare(String(b.due_time || "99")));

    // 07:30 — good morning summary.
    if (mins >= 7 * 60 + 30 && mins < 10 * 60 && list.length) {
      const first = open.find((t) => t.due_time);
      const r = await notify(staffId, {
        kind: "morning",
        title: "Good morning " + firstName(staff),
        body: list.length + (list.length === 1 ? " task" : " tasks") + " today." + (first ? " First: " + first.title + " at " + formatTime12(first.due_time) + "." : ""),
        url: "/",
        reminder: true,
        dedupeKey: "morning:" + today + ":" + staffId,
      });
      if (r.stored) sent++;
    }

    for (const t of open) {
      const due = timeToMinutes(t.due_time);
      if (due === null) continue;
      const isReport = t.template?.auto_rule?.key === "daily_report_sent";
      if (muted.has(t.template_id) && !isReport) continue;
      const money = t.template?.auto_rule?.measure === "sum";
      // 30 minutes before due.
      if (!t.reminded_due_at && mins >= due - 30 && mins < due) {
        const progress = money && t.target ? " " + formatNaira(t.progress || 0) + " confirmed so far." : t.target ? " " + (t.progress || 0) + " of " + t.target + " so far." : "";
        const r = await notify(staffId, { kind: "due_soon", title: "Due at " + formatTime12(t.due_time), body: t.title + "." + progress, url: "/?view=task&id=" + t.id, reminder: true, dedupeKey: "due:" + t.id });
        await sb.from("perf_daily_tasks").update({ reminded_due_at: now.toISOString() }).eq("id", t.id);
        if (r.stored) sent++;
      }
      // Overdue (the report has its own 17:30 reminder below).
      if (!isReport && !t.reminded_overdue_at && mins >= due) {
        const r = await notify(staffId, { kind: "overdue", title: "Overdue", body: t.title + " (due " + formatTime12(t.due_time) + ").", url: "/?view=task&id=" + t.id, reminder: true, dedupeKey: "overdue:" + t.id });
        await sb.from("perf_daily_tasks").update({ reminded_overdue_at: now.toISOString(), overdue: true }).eq("id", t.id);
        if (r.stored) sent++;
      }
    }
  }

  // 17:30 — report reminder; 18:15 — supervisors told who's missing.
  if (mins >= 17 * 60 + 30) {
    const ids = [...byStaff.keys()];
    const { data: reps } = ids.length ? await sb.from("perf_daily_reports").select("staff_id, status").eq("report_date", today).in("staff_id", ids) : { data: [] };
    const sentIds = new Set((reps || []).filter((r) => r.status !== "draft").map((r) => r.staff_id));
    const missing = ids.filter((id) => !sentIds.has(id));
    if (mins < 18 * 60) {
      for (const id of missing) {
        const r = await notify(id, { kind: "report_due", title: "Daily report due at 6:00pm", body: "Your daily report is due at 6:00pm. It's already filled from ERPNext.", url: "/?view=report", reminder: true, dedupeKey: "report-due:" + today + ":" + id });
        if (r.stored) sent++;
      }
    }
    if (mins >= 18 * 60 + 15) {
      const byManager = new Map();
      for (const id of missing) {
        const s = await getStaff(id);
        if (!s?.reportsTo) continue;
        if (!byManager.has(s.reportsTo)) byManager.set(s.reportsTo, []);
        byManager.get(s.reportsTo).push(firstName(s));
      }
      for (const [mgr, names] of byManager) {
        const r = await notify(mgr, {
          kind: "team_reports_missing",
          title: names.length + (names.length === 1 ? " report missing" : " reports missing"),
          body: names.length + " of your team " + (names.length === 1 ? "hasn't" : "haven't") + " sent a report: " + names.join(", ") + ".",
          url: "/?view=team&filter=no_report",
          reminder: true,
          dedupeKey: "team-missing:" + today + ":" + mgr,
        });
        if (r.stored) sent++;
      }
    }
  }
  return { job: "reminders", sent };
}

async function openRatingTasks(month, today, { notifyKind }) {
  const sb = getServiceClient();
  const { data, error } = await sb.from("perf_staff").select("reports_to").eq("active", true).not("reports_to", "is", null);
  if (error) throw error;
  const supervisors = [...new Set((data || []).map((r) => r.reports_to))];
  const [y, m] = addMonths(month, 1).split("-");
  const dueLabel = RATING_DUE_DAY + " " + new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  let created = 0;
  for (const id of supervisors) {
    const me = await getStaffById(id);
    if (!me?.active) continue;
    const due = await ratingsDue(me);
    const left = due.people.filter((p) => !p.rated).length;
    if (left === 0) continue;
    const r = await addSystemTask(id, today, { key: "rate_team:" + month, title: "Rate your team for " + monthLabel(month), dueTime: "17:00", sopCode: "SOP-PPL-06" });
    if (r.created) created++;
    await notify(id, {
      kind: notifyKind,
      title: "Rate your team",
      body: "Rate your " + left + (left === 1 ? " Associate" : " Associates") + " for " + monthLabel(month) + " by " + dueLabel + ".",
      url: "/?view=ratings",
      dedupeKey: notifyKind + ":" + month + ":" + id,
    });
  }
  return { supervisors: supervisors.length, created };
}

export async function runTick(now = new Date(), { force } = {}) {
  const p = lagosParts(now);
  const today = lagosDate(now);
  const month = monthOf(today);
  const prev = addMonths(month, -1);
  const results = [];

  if (force === "build_day_plans" || p.minutes >= 5 * 60) {
    results.push(await safe("build_day_plans", () => runOnce("build_day_plans", today, () => buildAllDayPlans(today))));
  }
  if (force === "evaluate_auto_tasks" || (p.hour >= 5 && p.hour < 22)) {
    results.push(await safe("evaluate_auto_tasks", async () => ({ job: "evaluate_auto_tasks", ...(await evaluateAllAutoTasks(today)) })));
  }
  if (force === "reminders" || !force) {
    results.push(await safe("reminders", () => remindersTick(today, now)));
  }
  if (force === "rebuild_scores" || p.minutes >= 30) {
    results.push(
      await safe("rebuild_scores", () =>
        runOnce("rebuild_scores", today, async () => {
          const r = { current: await rebuildScores(month) };
          if (monthPhase(prev, now) !== "locked") r.previous = await rebuildScores(prev);
          return r;
        })
      )
    );
  }
  if (p.day >= 1 && p.day <= RATING_DUE_DAY && p.minutes >= 6 * 60) {
    results.push(await safe("open_rating_tasks", () => runOnce("open_rating_tasks", today, () => openRatingTasks(prev, today, { notifyKind: p.day === RATING_DUE_DAY ? "rate_due_day3" : "rate_open" }))));
  }
  if (force === "mark_incomplete" || p.day === 4 || p.day === 5) {
    results.push(await safe("mark_incomplete", () => runOnce("mark_incomplete", prev, () => markIncomplete(prev))));
  }
  if (force === "lock_month" || p.day >= 6) {
    results.push(await safe("lock_month", () => runOnce("lock_month", prev, () => lockMonth(prev))));
  }
  return { at: now.toISOString(), lagos: today + " " + String(p.hour).padStart(2, "0") + ":" + String(p.minute).padStart(2, "0"), results };
}
