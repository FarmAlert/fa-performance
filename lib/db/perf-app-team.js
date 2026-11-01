import "server-only";
import { getServiceClient } from "./serviceClient";
import { listAllStaff } from "./perf-staff";
import { notify } from "./perf-app-notify";
import { taskSummary, getMyDay } from "./perf-app-tasks";
import { reportsForDate, getDailyReport } from "./perf-app-reports";
import { listVisits } from "./perf-app-visits";
import { scoresFor, getMyRating, monthLabel } from "./perf-app-scores";
import { listDirectReports, assertCanRate, assertCanSee, isViewer, isPerformanceAdmin, AppForbiddenError } from "../perf/app-auth";
import { lagosDate, monthOf, addMonths, ratingMonth, monthPhase, ratingValid, ratingNeedsComment, formatTime12, lagosParts, centreLabel } from "../perf/app-core";
import { outletLabel } from "../perf/scoring";

// ---------------------------------------------------------------------------
// Farm Alert Performance App — supervisor screens (spec 08, 09) and the
// FA Supervisor Rating rules (spec 4, 6.1, 10.4).
//
// A supervisor sees and rates only their direct reports (perf_staff.
// reports_to); viewers (CEO, VP AI & Digital Innovation, Chief Internal
// Auditor) and HR see everyone, read-only. Rating anyone else is refused
// with 403 on the server (acceptance check 11.1). Ratings can be edited
// until the month locks on Day 5, then they lock with it.
// ---------------------------------------------------------------------------

export class AppTeamError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "AppTeamError";
    this.status = status;
  }
}

async function teamFor(me) {
  const direct = await listDirectReports(me.id);
  if (direct.length || !(isViewer(me) || isPerformanceAdmin(me))) return { people: direct, scope: "direct" };
  const all = (await listAllStaff()).filter((s) => s.active && s.id !== me.id && s.cluster);
  return { people: all, scope: "all" };
}

function timeLabel(iso) {
  if (!iso) return null;
  const p = lagosParts(new Date(iso));
  return formatTime12(String(p.hour).padStart(2, "0") + ":" + String(p.minute).padStart(2, "0"));
}

export async function teamToday(me, { filter = "all", date } = {}) {
  const day = date || lagosDate();
  const month = monthOf(day);
  const { people, scope } = await teamFor(me);
  const ids = people.map((p) => p.id);
  const [scores, reports] = await Promise.all([scoresFor(ids, month), reportsForDate(ids, day)]);

  const cards = [];
  let missedTotal = 0;
  let salesTotal = 0;
  let anySales = false;
  for (const p of people) {
    const tasks = await taskSummary(p.id, day);
    const done = tasks.filter((t) => t.status === "done").length;
    const missed = tasks.filter((t) => t.status === "not_done" || (t.status === "open" && t.overdue)).length;
    missedTotal += missed;
    const visit = tasks.find((t) => /visit/i.test(t.title) && t.source === "auto");
    const rep = reports.get(p.id);
    const sales = (rep?.figures?.list || []).find((f) => f.key === "sales");
    if (sales && sales.value !== null) {
      salesTotal += Number(sales.value) || 0;
      anySales = true;
    }
    const sc = scores.get(p.id);
    cards.push({
      id: p.id,
      name: p.name,
      role: p.role,
      centre: centreLabel(outletLabel(p.outlet)),
      score: sc?.score ?? null,
      band: sc?.band || "no_data",
      report: rep ? { status: rep.status, sentAt: rep.sent_at, sentLabel: timeLabel(rep.sent_at) } : null,
      done,
      total: tasks.length,
      missed,
      visits: visit ? visit.progressLabel : null,
    });
  }

  const needsAttention = (c) => c.band === "red" || c.missed > 0;
  const noReport = (c) => !c.report || c.report.status === "draft";
  let list = cards;
  if (filter === "attention") list = cards.filter(needsAttention);
  else if (filter === "no_report") list = cards.filter(noReport);
  list.sort((a, b) => (needsAttention(b) ? 1 : 0) - (needsAttention(a) ? 1 : 0) || (a.score ?? 101) - (b.score ?? 101));

  return {
    date: day,
    scope,
    title: me.role,
    summary: {
      reportsIn: cards.filter((c) => !noReport(c)).length,
      people: cards.length,
      missed: missedTotal,
      teamFigure: anySales ? { label: "Sales today", value: salesTotal, money: true } : null,
    },
    counts: { all: cards.length, attention: cards.filter(needsAttention).length, noReport: cards.filter(noReport).length },
    people: list,
  };
}

// One team member's day, report and visits (tap a card on Team).
export async function personDay(me, staffId, date) {
  const person = await assertCanSee(me, staffId);
  const day = date || lagosDate();
  const [myDay, report, visits] = await Promise.all([getMyDay(person, day), getDailyReport(person, day), listVisits(person.id, day)]);
  return {
    person: { id: person.id, name: person.name, role: person.role, centre: centreLabel(outletLabel(person.outlet)) },
    day: myDay,
    report,
    visits,
    canApproveVisits: person.reportsTo === me.id,
  };
}

// Nudge (spec 08): push everyone listed who hasn't sent today's report.
export async function nudge(me, { employees }) {
  const day = lagosDate();
  const direct = await listDirectReports(me.id);
  const allowed = new Set(direct.map((p) => p.id));
  const ids = (Array.isArray(employees) ? employees : []).filter((id) => allowed.has(id));
  if (ids.length === 0) throw new AppTeamError("Choose someone in your team to nudge.");
  const reports = await reportsForDate(ids, day);
  const hour = lagosParts().hour;
  let sent = 0;
  for (const id of ids) {
    const r = reports.get(id);
    if (r && r.status !== "draft") continue;
    const res = await notify(id, {
      kind: "nudge",
      title: "Your daily report",
      body: me.name.split(" ")[0] + " is waiting for your daily report. It's already filled from ERPNext.",
      url: "/?view=report",
      reminder: true,
      dedupeKey: "nudge:" + day + ":" + hour + ":" + id,
    });
    if (res.stored) sent++;
  }
  return { ok: true, sent };
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

function openRatingMonths() {
  const current = monthOf(lagosDate());
  const prev = ratingMonth();
  return prev ? [prev, current] : [current];
}

export async function ratingsDue(me) {
  const month = ratingMonth() || monthOf(lagosDate());
  const direct = await listDirectReports(me.id);
  const ids = direct.map((p) => p.id);
  const sb = getServiceClient();
  const [{ data: ratings }, scores] = await Promise.all([
    ids.length ? sb.from("perf_supervisor_ratings").select("staff_id, care, dare, conduct, teamwork, updated_at").eq("month", month).in("staff_id", ids) : Promise.resolve({ data: [] }),
    scoresFor(ids, month),
  ]);
  const rMap = new Map((ratings || []).map((r) => [r.staff_id, r]));
  const [y, m] = addMonths(month, 1).split("-");
  return {
    month,
    monthLabel: monthLabel(month),
    dueLabel: "3 " + new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" }),
    locked: monthPhase(month) === "locked",
    people: direct.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      centre: centreLabel(outletLabel(p.outlet)),
      score: scores.get(p.id)?.score ?? null,
      band: scores.get(p.id)?.band || "no_data",
      rated: rMap.has(p.id),
    })),
  };
}

export async function rateContext(me, { employee, month }) {
  const target = await assertCanRate(me, employee);
  const m = month || ratingMonth() || monthOf(lagosDate());
  if (!openRatingMonths().includes(m) && monthPhase(m) !== "locked") throw new AppTeamError("That month isn't open for rating.");
  const summary = await getMyRating(target, m);
  return {
    person: { id: target.id, name: target.name, role: target.role, centre: centreLabel(outletLabel(target.outlet)) },
    month: m,
    monthLabel: summary.monthLabel,
    score: summary.score,
    band: summary.band,
    lines: summary.lines,
    rating: summary.rating,
    locked: monthPhase(m) === "locked",
  };
}

export async function rate(me, p) {
  const target = await assertCanRate(me, p.employee);
  const month = String(p.month || "");
  if (!openRatingMonths().includes(month)) {
    if (monthPhase(month) === "locked") throw new AppTeamError("This month is locked. Ratings can't change after Day 5.", 409);
    throw new AppTeamError("That month isn't open for rating.");
  }
  const r = { care: Number(p.care), dare: Number(p.dare), conduct: Number(p.conduct), teamwork: Number(p.teamwork) };
  if (!ratingValid(r)) throw new AppTeamError("Each score must be 1 to 5.");
  const comment = String(p.comment || "").trim().slice(0, 2000);
  if (ratingNeedsComment(r) && !comment) throw new AppTeamError("Add a comment: it's required when any score is 2 or below.");

  const sb = getServiceClient();
  const { data: existing } = await sb.from("perf_supervisor_ratings").select("id, locked").eq("staff_id", target.id).eq("month", month).maybeSingle();
  if (existing?.locked) throw new AppTeamError("This rating is locked.", 409);
  const { error } = await sb.from("perf_supervisor_ratings").upsert({ staff_id: target.id, month, rated_by: me.id, ...r, comment: comment || null }, { onConflict: "staff_id,month" });
  if (error) throw error;

  if (!existing) {
    await notify(target.id, {
      kind: "rating_saved",
      title: "Your " + monthLabel(month) + " rating is ready",
      body: "Your " + monthLabel(month) + " rating from your supervisor is ready.",
      url: "/?view=rating&month=" + month,
      dedupeKey: "rating:" + month + ":" + target.id,
    });
  }

  // Tick the supervisor's "Rate your team" task once everyone is rated.
  try {
    const due = await ratingsDue(me);
    if (due.month === month && due.people.every((x) => x.rated)) {
      await sb
        .from("perf_daily_tasks")
        .update({ status: "done", done_at: new Date().toISOString(), done_by: "auto" })
        .eq("staff_id", me.id)
        .eq("system_key", "rate_team:" + month)
        .eq("status", "open");
    }
  } catch (err) {
    console.error("[perf-app] rate-team task tick failed: " + err.message);
  }
  return { ok: true, edited: !!existing };
}

export async function guardSupervisor(me) {
  const direct = await listDirectReports(me.id);
  if (direct.length === 0) throw new AppForbiddenError("This is for people with direct reports.");
  return direct;
}
