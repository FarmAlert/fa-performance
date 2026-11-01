import "server-only";
import { getServiceClient } from "./serviceClient";
import { getStaffById } from "./perf-staff";
import { listTasksForStaff } from "./perf-tasks";
import { notify } from "./perf-app-notify";
import {
  lagosDate,
  addDays,
  weekdayOf,
  monthOf,
  templateMatchesStaff,
  templateDueOn,
  ruleDone,
  isOverdue,
  formatTime12,
  formatNaira,
  monthPhase,
  NOT_DONE_REASONS,
} from "../perf/app-core";
import { measureErpRule, invoicesDueToday, openLeadsFor, offDayInfo } from "../perf/app-erp";

// ---------------------------------------------------------------------------
// Farm Alert Performance App — daily tasks (spec 4 FA Daily Task, 5, 6.3).
//
// - buildDayPlan: the 05:00 job's per-person step. Idempotent: a template
//   already planned for that person and day is never added twice (unique
//   index + an existence check), so re-running the job is harmless.
// - evaluateAutoTasks: re-measures every Auto task for a person and day
//   from our own visits/reports or a read-only ERPNext query, and ticks or
//   REOPENS it (a cancelled ERPNext record drops the count, so the task
//   reopens on the next run — spec 5.1). Users can never change an Auto
//   task themselves (markTask refuses).
// - Every tick stores the record names it was based on (auto_refs) so
//   Internal Audit can trace it.
// ---------------------------------------------------------------------------

export class AppTaskError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "AppTaskError";
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_SELECT = "*, template:perf_task_templates(id, sop_code, how_to, record, sop_url, target_qty, auto_rule:perf_auto_rules(*))";

async function activeTemplates() {
  const { data, error } = await getServiceClient().from("perf_task_templates").select("*").eq("active", true).order("sort_order");
  if (error) throw error;
  return data || [];
}

async function targetOverrides(staffId) {
  const { data, error } = await getServiceClient().from("perf_task_target_overrides").select("template_id, target_qty").eq("staff_id", staffId);
  if (error) throw error;
  return new Map((data || []).map((r) => [r.template_id, Number(r.target_qty)]));
}

// Creates today's tasks for one person. Returns { created, skipped }.
export async function buildDayPlan(staff, date, { templates, holidayCache } = {}) {
  if (!staff.active) return { created: 0, skipped: "inactive" };
  const off = await offDayInfo(staff, date, holidayCache);
  if (off.off) return { created: 0, skipped: off.reason };
  // No ERPNext holiday calendar to go by: Sunday is the default day off.
  if (!off.known && weekdayOf(date) === 0) return { created: 0, skipped: "sunday" };

  const all = templates || (await activeTemplates());
  const due = all.filter((t) => templateMatchesStaff(t, staff) && templateDueOn(t, date));
  if (due.length === 0) return { created: 0 };

  const sb = getServiceClient();
  const { data: existing, error } = await sb.from("perf_daily_tasks").select("template_id").eq("staff_id", staff.id).eq("task_date", date).not("template_id", "is", null);
  if (error) throw error;
  const have = new Set((existing || []).map((r) => r.template_id));
  const overrides = await targetOverrides(staff.id);

  const rows = due
    .filter((t) => !have.has(t.id))
    .map((t) => ({
      staff_id: staff.id,
      task_date: date,
      template_id: t.id,
      title: t.title,
      sop_code: t.sop_code,
      due_time: t.due_time,
      source: t.source,
      target: overrides.has(t.id) ? overrides.get(t.id) : t.target_qty,
      progress: t.source === "auto" ? 0 : null,
    }));
  if (rows.length === 0) return { created: 0 };

  const { error: insErr } = await sb.from("perf_daily_tasks").insert(rows);
  if (insErr && insErr.code !== "23505") throw insErr;
  return { created: insErr ? 0 : rows.length };
}

export async function buildAllDayPlans(date) {
  const sb = getServiceClient();
  const { data, error } = await sb.from("perf_staff").select("id").eq("active", true);
  if (error) throw error;
  const templates = await activeTemplates();
  const holidayCache = new Map();
  let created = 0;
  let people = 0;
  for (const row of data || []) {
    try {
      const staff = await getStaffById(row.id);
      const r = await buildDayPlan(staff, date, { templates, holidayCache });
      created += r.created || 0;
      people++;
    } catch (err) {
      console.error("[perf-app] day plan for " + row.id + " failed: " + err.message);
    }
  }
  return { people, created };
}

// A one-off system task, e.g. "Rate your team" on Day 1 (spec 6.3).
export async function addSystemTask(staffId, date, { key, title, dueTime = null, sopCode = null }) {
  const { error } = await getServiceClient()
    .from("perf_daily_tasks")
    .insert({ staff_id: staffId, task_date: date, system_key: key, title, due_time: dueTime, sop_code: sopCode, source: "manual" });
  if (error && error.code !== "23505") throw error;
  return { created: !error };
}

// ---------------------------------------------------------------------------
// Auto-ticks
// ---------------------------------------------------------------------------

async function measureLocal(rule, staff, date) {
  const sb = getServiceClient();
  if (rule.source === "visits" || rule.source === "productive_visits") {
    let q = sb.from("perf_visits").select("id, client_id").eq("staff_id", staff.id).eq("visit_date", date);
    if (rule.source === "productive_visits") q = q.eq("productive", true);
    const { data, error } = await q;
    if (error) throw error;
    return { measured: (data || []).length, refs: (data || []).slice(0, 50).map((v) => ({ doctype: "Visit", name: v.id })) };
  }
  if (rule.source === "daily_report") {
    const { data, error } = await sb.from("perf_daily_reports").select("id, status").eq("staff_id", staff.id).eq("report_date", date).in("status", ["sent", "late"]).maybeSingle();
    if (error) throw error;
    return { measured: data ? 1 : 0, refs: data ? [{ doctype: "Daily Report", name: data.id }] : [] };
  }
  return { unavailable: "Unknown rule source" };
}

// Measures a rule over a date range — shared with monthly scoring.
export async function measureRule(rule, staff, from, to) {
  if (rule.source === "erp") return measureErpRule(rule, staff, from, to);
  if (from === to) return measureLocal(rule, staff, from);
  const sb = getServiceClient();
  if (rule.source === "visits" || rule.source === "productive_visits") {
    let q = sb.from("perf_visits").select("id", { count: "exact", head: true }).eq("staff_id", staff.id).gte("visit_date", from).lte("visit_date", to);
    if (rule.source === "productive_visits") q = q.eq("productive", true);
    const { count, error } = await q;
    if (error) throw error;
    return { measured: count || 0, refs: [] };
  }
  if (rule.source === "daily_report") {
    const { count, error } = await sb.from("perf_daily_reports").select("id", { count: "exact", head: true }).eq("staff_id", staff.id).gte("report_date", from).lte("report_date", to).in("status", ["sent", "late"]);
    if (error) throw error;
    return { measured: count || 0, refs: [] };
  }
  return { unavailable: "Unknown rule source" };
}

export async function evaluateAutoTasks(staff, date, now = new Date()) {
  const sb = getServiceClient();
  const { data: tasks, error } = await sb.from("perf_daily_tasks").select(TASK_SELECT).eq("staff_id", staff.id).eq("task_date", date).in("status", ["open", "done"]);
  if (error) throw error;
  let ticked = 0;
  let reopened = 0;

  for (const t of tasks || []) {
    const patch = {};
    if (t.source === "auto" && t.template?.auto_rule?.active) {
      const rule = t.template.auto_rule;
      try {
        let target = t.target === null || t.target === undefined ? null : Number(t.target);
        // "Collect payments due today": the target is the outstanding on
        // invoices due today, read live (spec 5), unless a fixed target is set.
        if (rule.key === "payments_received" && target === null) {
          const due = await invoicesDueToday(staff, date);
          if (due) target = due.total;
        }
        const m = await measureRule(rule, staff, date, date);
        patch.evaluated_at = now.toISOString();
        if (m.unavailable) {
          patch.auto_note = m.unavailable;
        } else {
          const done = rule.key === "payments_received" && target === 0 ? true : ruleDone(rule.done_when, m.measured, target, m.compliant);
          patch.auto_note = null;
          patch.progress = rule.done_when === "all_compliant" ? m.compliant : m.measured;
          patch.target = rule.done_when === "all_compliant" ? m.measured : target;
          patch.auto_refs = m.refs || [];
          if (done && t.status !== "done") {
            patch.status = "done";
            patch.done_at = now.toISOString();
            patch.done_by = "auto";
            ticked++;
          } else if (!done && t.status === "done" && t.done_by === "auto") {
            patch.status = "open";
            patch.done_at = null;
            patch.done_by = null;
            reopened++;
          }
        }
      } catch (err) {
        console.error("[perf-app] evaluating task " + t.id + " failed: " + err.message);
        patch.auto_note = "Couldn't reach ERPNext, will try again shortly";
        patch.evaluated_at = now.toISOString();
      }
    }
    const status = patch.status || t.status;
    const overdue = isOverdue({ ...t, status }, now);
    if (overdue !== t.overdue) patch.overdue = overdue;
    if (Object.keys(patch).length) {
      const { error: upErr } = await sb.from("perf_daily_tasks").update(patch).eq("id", t.id);
      if (upErr) console.error("[perf-app] task " + t.id + " update failed: " + upErr.message);
    }
  }
  return { ticked, reopened };
}

export async function evaluateAllAutoTasks(date) {
  const sb = getServiceClient();
  const { data, error } = await sb.from("perf_daily_tasks").select("staff_id").eq("task_date", date).in("status", ["open", "done"]);
  if (error) throw error;
  const ids = [...new Set((data || []).map((r) => r.staff_id))];
  let ticked = 0;
  let reopened = 0;
  for (const id of ids) {
    try {
      const staff = await getStaffById(id);
      if (!staff?.active) continue;
      const r = await evaluateAutoTasks(staff, date);
      ticked += r.ticked;
      reopened += r.reopened;
    } catch (err) {
      console.error("[perf-app] auto evaluation for " + id + " failed: " + err.message);
    }
  }
  return { people: ids.length, ticked, reopened };
}

// ---------------------------------------------------------------------------
// Reads for the phone
// ---------------------------------------------------------------------------

function hhmm(t) {
  return t ? String(t).slice(0, 5) : null;
}

export function shapeTask(t, now = new Date()) {
  const rule = t.template?.auto_rule || null;
  const money = rule?.measure === "sum";
  const progress = t.progress === null || t.progress === undefined ? null : Number(t.progress);
  const target = t.target === null || t.target === undefined ? null : Number(t.target);
  let progressLabel = null;
  if (t.source === "auto" && progress !== null) {
    if (rule?.done_when === "all_compliant") progressLabel = target ? progress + " of " + target + " done" : "Nothing due today";
    else if (money) progressLabel = target ? formatNaira(progress) + " of " + formatNaira(target) : formatNaira(progress) + " so far";
    else progressLabel = target ? progress + " of " + target : String(progress);
  }
  return {
    id: t.id,
    date: t.task_date,
    title: t.title,
    due: hhmm(t.due_time),
    dueLabel: t.due_time ? formatTime12(t.due_time) : null,
    sop: t.sop_code || null,
    source: t.source,
    status: t.status,
    progress,
    target,
    progressLabel,
    money,
    overdue: isOverdue(t, now),
    doneAt: t.done_at,
    doneBy: t.done_by,
    reason: t.reason_not_done || null,
    autoNote: t.auto_note || null,
    systemKey: t.system_key || null,
    templateId: t.template_id || null,
  };
}

function reminderFor(tasks) {
  const open = tasks.filter((t) => t.status === "open");
  const overdue = open.filter((t) => t.overdue);
  if (overdue.length) {
    const first = overdue[0];
    return { kind: "overdue", count: overdue.length, title: overdue.length + (overdue.length === 1 ? " task overdue" : " tasks overdue"), text: first.title + " was due at " + first.due + "." };
  }
  const next = open.filter((t) => t.due).sort((a, b) => a.due.localeCompare(b.due))[0];
  if (next) return { kind: "next", count: 0, title: "Next up", text: next.title + (next.dueLabel ? " by " + next.dueLabel : "") + "." };
  return null;
}

// My day (spec 02 / API my_day). Builds today's plan on first open if the
// 05:00 job hasn't run yet, so a missed job never leaves someone blank.
export async function getMyDay(staff, date, { refresh = false } = {}) {
  const today = lagosDate();
  const sb = getServiceClient();
  if (date === today) {
    const { count } = await sb.from("perf_daily_tasks").select("id", { count: "exact", head: true }).eq("staff_id", staff.id).eq("task_date", date);
    if (!count) await buildDayPlan(staff, date);
    if (refresh) await evaluateAutoTasks(staff, date);
  }
  const { data, error } = await sb.from("perf_daily_tasks").select(TASK_SELECT).eq("staff_id", staff.id).eq("task_date", date).neq("status", "cancelled");
  if (error) throw error;
  const now = new Date();
  const tasks = (data || []).map((t) => shapeTask(t, now)).sort((a, b) => (a.due || "99").localeCompare(b.due || "99"));

  // Tasks HQ assigned through the existing Tasks board (migration 110)
  // show here too — same records, so progress stays in one place.
  let assigned = [];
  try {
    const hq = await listTasksForStaff(staff.id);
    assigned = (hq || [])
      .filter((t) => t.status === "pending" || t.status === "in_progress")
      .map((t) => ({ id: t.id, title: t.title, description: t.description || null, dueDate: t.dueDate, status: t.status, priority: t.priority, overdue: t.isOverdue }));
  } catch (err) {
    console.error("[perf-app] assigned tasks read failed: " + err.message);
  }

  return {
    date,
    done: tasks.filter((t) => t.status === "done").length,
    total: tasks.length,
    reminder: reminderFor(tasks),
    tasks,
    assigned,
  };
}

async function loadTaskFor(taskId, staffId) {
  if (!UUID.test(taskId || "")) throw new AppTaskError("Task not found.", 404);
  const { data, error } = await getServiceClient().from("perf_daily_tasks").select(TASK_SELECT).eq("id", taskId).maybeSingle();
  if (error) throw error;
  if (!data || (staffId && data.staff_id !== staffId)) throw new AppTaskError("Task not found.", 404);
  return data;
}

// Task detail (spec 03): how-to, what to record, linked records.
export async function getTaskDetail(staff, taskId) {
  const t = await loadTaskFor(taskId, staff.id);
  const rule = t.template?.auto_rule || null;
  const linked = [];
  try {
    if (rule?.key === "payments_received") {
      const due = await invoicesDueToday(staff, t.task_date);
      (due?.invoices || []).forEach((i) => linked.push({ kind: "invoice", title: i.customerName, subtitle: i.name + " · " + formatNaira(i.outstanding) + " due", phone: i.phone }));
    } else if (/lead/i.test(t.title) || rule?.key === "leads_assigned") {
      const leads = await openLeadsFor(staff);
      leads.forEach((l) => linked.push({ kind: "lead", title: l.title, subtitle: l.name + " · " + l.status, phone: l.phone }));
    }
  } catch (err) {
    console.error("[perf-app] linked records for " + t.id + " failed: " + err.message);
  }
  (t.auto_refs || []).slice(0, 20).forEach((r) => linked.push({ kind: "record", title: r.doctype, subtitle: r.name }));

  return {
    ...shapeTask(t),
    howTo: t.template?.how_to || null,
    record: t.template?.record || null,
    sopUrl: t.template?.sop_url || null,
    ruleLabel: rule?.label || null,
    linked,
    reasons: NOT_DONE_REASONS,
  };
}

function lineManagerName(staff) {
  return staff.reportsTo ? getStaffById(staff.reportsTo) : Promise.resolve(null);
}

// mark_task (spec 9): Done / Not done on a YOU TICK task. Rejected for Auto
// tasks, other people's tasks, and days in a locked month.
export async function markTask(staff, { task, status, reason }) {
  const t = await loadTaskFor(task, staff.id);
  if (t.source === "auto") throw new AppTaskError("This task ticks itself when the record is saved in ERPNext.");
  if (monthPhase(monthOf(t.task_date)) === "locked") throw new AppTaskError("This month is locked. Ask HR to correct it.", 409);
  if (t.task_date < addDays(lagosDate(), -7)) throw new AppTaskError("This task is too old to change.", 409);

  const s = String(status || "").toLowerCase().replace(" ", "_");
  if (s !== "done" && s !== "not_done" && s !== "open") throw new AppTaskError("Status must be Done or Not done.");
  const cleanReason = String(reason || "").trim().slice(0, 500);
  if (s === "not_done" && !cleanReason) throw new AppTaskError("Give a reason the task can't be done.");

  const patch = {
    status: s,
    done_at: s === "done" ? new Date().toISOString() : null,
    done_by: s === "done" ? "user" : null,
    reason_not_done: s === "not_done" ? cleanReason : null,
    overdue: false,
  };
  const { error } = await getServiceClient().from("perf_daily_tasks").update(patch).eq("id", t.id).eq("staff_id", staff.id);
  if (error) throw error;

  if (s === "not_done") {
    const manager = await lineManagerName(staff);
    if (manager) {
      await notify(manager.id, {
        kind: "task_not_done",
        title: staff.name.split(" ")[0] + " can't do a task",
        body: t.title + ": " + cleanReason,
        url: "/?view=team&person=" + staff.id,
        dedupeKey: "notdone:" + t.id,
      });
    }
  }
  return { ok: true, task: shapeTask({ ...t, ...patch }) };
}

// Mute reminders for one template (spec 7: "Users can mute reminders for
// single tasks but not the report reminder").
export async function setTaskMuted(staff, { templateId, muted }) {
  if (!UUID.test(templateId || "")) throw new AppTaskError("Task not found.", 404);
  const { data: tpl, error } = await getServiceClient().from("perf_task_templates").select("id, auto_rule:perf_auto_rules(key)").eq("id", templateId).maybeSingle();
  if (error) throw error;
  if (!tpl) throw new AppTaskError("Task not found.", 404);
  if (tpl.auto_rule?.key === "daily_report_sent") throw new AppTaskError("The daily report reminder can't be muted.");
  const set = new Set(staff.mutedTemplateIds || []);
  if (muted) set.add(templateId);
  else set.delete(templateId);
  const { error: upErr } = await getServiceClient().from("perf_staff").update({ muted_template_ids: [...set] }).eq("id", staff.id);
  if (upErr) throw upErr;
  return { ok: true, muted: !!muted };
}

// Tasks summary for a person/day, used by the report and the Team screen.
export async function taskSummary(staffId, date) {
  const { data, error } = await getServiceClient().from("perf_daily_tasks").select(TASK_SELECT).eq("staff_id", staffId).eq("task_date", date).neq("status", "cancelled");
  if (error) throw error;
  const now = new Date();
  return (data || []).map((t) => shapeTask(t, now));
}
