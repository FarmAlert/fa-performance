import "server-only";
import { getServiceClient } from "./serviceClient";
import { evaluateAutoTasks, measureRule, taskSummary } from "./perf-app-tasks";
import { lagosDate, addDays, reportIsLate, isFieldRole, formatTime12, REPORT_DUE_TIME, monthOf, monthPhase } from "../perf/app-core";

// ---------------------------------------------------------------------------
// Farm Alert Performance App — daily report (spec 4 FA Daily Report, 05).
//
// Figures are read from ERPNext (and our own visits) for that day and that
// person and stay live until the report is confirmed; confirming stores a
// snapshot (`figures`) so the supervisor sees exactly what was sent. A
// report sent after 18:00 Lagos is marked Late — including one queued
// offline, which keeps the time it was confirmed on the phone.
// ---------------------------------------------------------------------------

export class AppReportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "AppReportError";
    this.status = status;
  }
}

const SALES_FIGURES = [
  { key: "sales", label: "Sales invoiced", rule: "sales_invoiced", money: true },
  { key: "payments", label: "Payments confirmed", rule: "payments_received", money: true },
  { key: "new_partners", label: "New Partners", rule: "new_customers" },
  { key: "visits", label: "Visits", rule: "visits" },
  { key: "productive", label: "Productive visits", rule: "productive_visits" },
];

async function rulesByKey(keys) {
  const { data, error } = await getServiceClient().from("perf_auto_rules").select("*").in("key", keys).eq("active", true);
  if (error) throw error;
  return new Map((data || []).map((r) => [r.key, r]));
}

// Live figures for a person and day. Sales roles get the spec's five sales
// figures; every other role sees the figures behind their own auto tasks.
export async function liveFigures(staff, date, tasks) {
  if (isFieldRole(staff)) {
    const rules = await rulesByKey(SALES_FIGURES.map((f) => f.rule));
    return Promise.all(
      SALES_FIGURES.map(async (f) => {
        const rule = rules.get(f.rule);
        if (!rule) return { key: f.key, label: f.label, value: null, money: !!f.money, note: "Not set up" };
        try {
          const m = await measureRule(rule, staff, date, date);
          if (m.unavailable) return { key: f.key, label: f.label, value: null, money: !!f.money, note: m.unavailable };
          return { key: f.key, label: f.label, value: m.measured, money: !!f.money, source: rule.source === "erp" ? "ERPNext" : "App" };
        } catch (err) {
          console.error("[perf-app] figure " + f.key + " failed: " + err.message);
          return { key: f.key, label: f.label, value: null, money: !!f.money, note: "ERPNext unavailable" };
        }
      })
    );
  }
  return (tasks || [])
    .filter((t) => t.source === "auto" && t.systemKey === null && !/daily report/i.test(t.title))
    .map((t) => ({ key: t.id, label: t.title, value: t.progress, money: t.money, target: t.target, note: t.autoNote || null, source: "ERPNext" }));
}

function shapeReport(r) {
  if (!r) return null;
  return { status: r.status, sentAt: r.sent_at, notes: r.notes || "", reasons: r.reasons || {}, figures: r.figures?.list || null, tasksDone: r.tasks_done, tasksTotal: r.tasks_total };
}

export async function getDailyReport(staff, date) {
  const sb = getServiceClient();
  const { data: report, error } = await sb.from("perf_daily_reports").select("*").eq("staff_id", staff.id).eq("report_date", date).maybeSingle();
  if (error) throw error;
  const tasks = await taskSummary(staff.id, date);
  const sent = report && (report.status === "sent" || report.status === "late");
  const figures = sent ? report.figures?.list || [] : await liveFigures(staff, date, tasks);
  const reportTask = (t) => t.systemKey === null && /daily report/i.test(t.title);
  const counted = tasks.filter((t) => !reportTask(t));
  return {
    date,
    dueLabel: formatTime12(REPORT_DUE_TIME),
    lateIfSentNow: reportIsLate(date, new Date().toISOString()),
    figures,
    tasks: counted.map((t) => ({ id: t.id, title: t.title, status: t.status, source: t.source, reason: t.reason, progressLabel: t.progressLabel })),
    done: counted.filter((t) => t.status === "done").length,
    total: counted.length,
    report: shapeReport(report),
  };
}

function validDate(date) {
  const today = lagosDate();
  return date === today || date === addDays(today, -1);
}

export async function saveReportDraft(staff, { date, notes, reasons }) {
  if (!validDate(date)) throw new AppReportError("You can only work on today's or yesterday's report.");
  const sb = getServiceClient();
  const { data: existing } = await sb.from("perf_daily_reports").select("status").eq("staff_id", staff.id).eq("report_date", date).maybeSingle();
  if (existing && existing.status !== "draft") throw new AppReportError("This report has already been sent.", 409);
  const { error } = await sb
    .from("perf_daily_reports")
    .upsert({ staff_id: staff.id, report_date: date, notes: String(notes || "").slice(0, 4000), reasons: cleanReasons(reasons), status: "draft" }, { onConflict: "staff_id,report_date" });
  if (error) throw error;
  return { ok: true };
}

function cleanReasons(reasons) {
  const out = {};
  if (reasons && typeof reasons === "object") {
    Object.entries(reasons)
      .slice(0, 50)
      .forEach(([k, v]) => {
        const s = String(v || "").trim().slice(0, 500);
        if (/^[0-9a-f-]{36}$/i.test(k) && s) out[k] = s;
      });
  }
  return out;
}

// send_daily_report (spec 9). `confirmedAt` is when the person tapped
// Confirm on the phone (kept for offline sends); bounded so a phone clock
// can't backdate a report before its own day or into the future.
export async function sendDailyReport(staff, { date, notes, reasons, confirmedAt }) {
  if (!validDate(date)) throw new AppReportError("You can only send today's or yesterday's report.");
  if (monthPhase(monthOf(date)) === "locked") throw new AppReportError("That month is locked.", 409);
  const sb = getServiceClient();
  const { data: existing } = await sb.from("perf_daily_reports").select("*").eq("staff_id", staff.id).eq("report_date", date).maybeSingle();
  if (existing && existing.status !== "draft") return { ok: true, duplicate: true, report: shapeReport(existing) };

  const tasks = await taskSummary(staff.id, date);
  const counted = tasks.filter((t) => !(t.systemKey === null && /daily report/i.test(t.title)));
  const r = cleanReasons(reasons);
  const missing = counted.filter((t) => t.status !== "done" && !r[t.id] && !t.reason);
  if (missing.length) throw new AppReportError("Give a reason for each task not done: " + missing.map((t) => t.title).join(", ") + ".");

  // A YOU TICK task left open is closed as Not done with its reason; an
  // auto task stays as ERPNext has it, with the reason recorded.
  for (const t of counted) {
    if (t.status === "done") continue;
    const reason = r[t.id] || t.reason;
    const patch = { reason_not_done: reason };
    if (t.source === "manual" && t.status === "open") patch.status = "not_done";
    const { error } = await sb.from("perf_daily_tasks").update(patch).eq("id", t.id).eq("staff_id", staff.id);
    if (error) throw error;
  }

  const now = Date.now();
  let sentAt = new Date(now);
  if (confirmedAt) {
    const c = new Date(confirmedAt);
    if (!Number.isNaN(c.getTime()) && c.getTime() <= now && lagosDate(c) >= date) sentAt = c;
  }
  const figures = await liveFigures(staff, date, counted);
  const row = {
    staff_id: staff.id,
    report_date: date,
    figures: { list: figures, captured_at: new Date(now).toISOString() },
    tasks_done: counted.filter((t) => t.status === "done").length,
    tasks_total: counted.length,
    notes: String(notes || "").slice(0, 4000),
    reasons: r,
    status: reportIsLate(date, sentAt.toISOString()) ? "late" : "sent",
    sent_at: sentAt.toISOString(),
  };
  const { data, error } = await sb.from("perf_daily_reports").upsert(row, { onConflict: "staff_id,report_date" }).select("*").single();
  if (error) throw error;

  try {
    await evaluateAutoTasks(staff, date);
  } catch (err) {
    console.error("[perf-app] post-report evaluation failed: " + err.message);
  }
  return { ok: true, report: shapeReport(data) };
}

export async function reportsForDate(staffIds, date) {
  if (staffIds.length === 0) return new Map();
  const { data, error } = await getServiceClient().from("perf_daily_reports").select("staff_id, status, sent_at, figures, notes, tasks_done, tasks_total").in("staff_id", staffIds).eq("report_date", date);
  if (error) throw error;
  return new Map((data || []).map((r) => [r.staff_id, r]));
}
