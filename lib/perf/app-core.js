// Farm Alert Performance App — pure rules from the build spec (v1.0, 1 Nov
// 2026): scoring and bands (6.1), which template applies on which day (4),
// quiet hours and the daily push cap (7), the 300 m productive-visit rule
// (4, screen 04), report lateness (screen 05) and the monthly cycle (6.3).
//
// No database, no ERPNext, no React and only relative imports, so the same
// functions run on the server, in the phone UI, and under `node --test`
// (scripts/perf-app.test.mjs). Business-time maths is always Africa/Lagos
// (WAT, UTC+1, no daylight saving).

export const TIME_ZONE = "Africa/Lagos";
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

export const REPORT_DUE_TIME = "18:00";
export const PRODUCTIVE_RADIUS_M = 300;
export const QUIET_START_MIN = 20 * 60; // 20:00
export const QUIET_END_MIN = 7 * 60; // 07:00
export const DAILY_REMINDER_CAP = 6;
export const RATING_DUE_DAY = 3;
export const MONTH_LOCK_DAY = 5;
export const IMPROVEMENT_DECISION_WORKING_DAYS = 10;
export const DARE_POINTS = { submitted: 1, tested: 3, adopted: 5 };
export const VISIT_OUTCOMES = ["Order taken", "No order", "Payment collected", "Complaint"];
export const IDEA_STATUSES = ["received", "scored", "in_test", "adopted", "scaled", "parked", "no"];
export const IDEA_STATUS_LABELS = {
  received: "Received",
  scored: "Scored",
  in_test: "In test",
  adopted: "Adopted",
  scaled: "Scaled",
  parked: "Parked",
  no: "No",
};
export const NOT_DONE_REASONS = ["Customer not available", "Stock not available", "No transport", "System or network problem", "Asked to do something else"];

// ---------------------------------------------------------------------------
// Time (Africa/Lagos)
// ---------------------------------------------------------------------------

// Wall-clock parts in Lagos for an instant.
export function lagosParts(date = new Date()) {
  const d = new Date(date.getTime() + LAGOS_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

export function lagosDate(date = new Date()) {
  const p = lagosParts(date);
  return p.year + "-" + pad(p.month) + "-" + pad(p.day);
}

export function monthOf(dateStr) {
  return String(dateStr).slice(0, 7);
}

export function isValidDate(dateStr) {
  if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(dateStr + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

export function isValidMonth(month) {
  return typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1);
}

export function monthRange(month) {
  const from = month + "-01";
  const to = addDays(addMonths(month, 1) + "-01", -1);
  return { from, to };
}

export function weekdayOf(dateStr) {
  return new Date(dateStr + "T00:00:00Z").getUTCDay();
}

export function timeToMinutes(t) {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Lagos wall time "HH:MM" on dateStr -> the real instant.
export function lagosInstant(dateStr, time) {
  const mins = timeToMinutes(time) ?? 0;
  return new Date(Date.parse(dateStr + "T00:00:00Z") + mins * 60000 - LAGOS_OFFSET_MS);
}

export function formatTime12(t) {
  const mins = timeToMinutes(t);
  if (mins === null) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ":" + pad(m) + suffix;
}

// ---------------------------------------------------------------------------
// Scoring (spec 6.1)
// ---------------------------------------------------------------------------

// One KPI as 0–100. Higher-is-better: actual ÷ target × 100. Lower-is-better
// (expired stock, debtor days): target ÷ actual × 100, and zero actual
// scores 100. Both capped at 100. null when there's nothing to score.
export function kpiScore(actual, target, higherIsBetter = true) {
  if (actual === null || actual === undefined || Number.isNaN(Number(actual))) return null;
  const a = Number(actual);
  const t = Number(target);
  if (!t || t <= 0) return null;
  let s;
  if (higherIsBetter) s = (a / t) * 100;
  else s = a <= 0 ? 100 : (t / a) * 100;
  return Math.max(0, Math.min(100, Math.round(s * 10) / 10));
}

// lines: [{weight, score}] with score null when there's no data.
// Before the month locks, missing lines are left out (never counted as
// zero, spec 6.1) and the rest are scaled to their own weights; after
// Day 5 lock, missing counts as zero (spec 6.3). Returns null = No data.
export function monthlyScore(lines, { missingAsZero = false } = {}) {
  const list = Array.isArray(lines) ? lines : [];
  if (list.length === 0) return null;
  let total = 0;
  let weightUsed = 0;
  let any = false;
  for (const l of list) {
    const w = Number(l.weight) || 0;
    if (l.score === null || l.score === undefined) {
      if (missingAsZero) weightUsed += w;
      continue;
    }
    any = true;
    total += Number(l.score) * w;
    weightUsed += w;
  }
  if (!any && !missingAsZero) return null;
  if (!any && missingAsZero) return 0;
  if (weightUsed <= 0) return null;
  return Math.round(total / weightUsed);
}

export function weightsValid(kpis) {
  const sum = (kpis || []).reduce((s, k) => s + (Number(k.weight) || 0), 0);
  return Math.abs(sum - 100) < 0.001;
}

export function bandOf(score) {
  if (score === null || score === undefined) return "no_data";
  if (score >= 85) return "green";
  if (score >= 70) return "amber";
  return "red";
}

export const BAND_LABELS = { green: "Green", amber: "Amber", red: "Red", no_data: "No data" };

// Points needed to reach the next band up, or null at the top / no data.
export function nextBandGap(score) {
  if (score === null || score === undefined) return null;
  if (score >= 85) return null;
  if (score >= 70) return { band: "green", points: 85 - score };
  return { band: "amber", points: 70 - score };
}

// ---------------------------------------------------------------------------
// Templates and tasks (spec 4, 5)
// ---------------------------------------------------------------------------

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

export function templateMatchesStaff(template, staff) {
  if (template.role && norm(template.role) !== norm(staff.role)) return false;
  if (template.cluster && template.cluster !== staff.cluster) return false;
  return true;
}

export function templateDueOn(template, dateStr) {
  switch (template.frequency) {
    case "daily":
      return true;
    case "weekly":
      return weekdayOf(dateStr) === Number(template.weekday);
    case "monthly": {
      // Day 31 on a 30-day month falls on the month's last day.
      const day = Number(dateStr.slice(8, 10));
      const last = Number(monthRange(monthOf(dateStr)).to.slice(8, 10));
      return day === Math.min(Number(template.month_day), last);
    }
    default:
      return false; // on_event tasks are created by the event, not the plan
  }
}

export function isFieldRole(staff) {
  if (staff.fieldRole === true || staff.fieldRole === false) return staff.fieldRole;
  return staff.cluster === "Sales & Marketing";
}

// Auto rules: is the task done, given what was measured?
export function ruleDone(doneWhen, measured, target, compliant) {
  if (doneWhen === "all_compliant") {
    // Every record today is compliant (nothing to do also counts as done).
    return Number(compliant) >= Number(measured);
  }
  if (doneWhen === "gte_1") return Number(measured) >= 1;
  if (target === null || target === undefined) return Number(measured) >= 1;
  return Number(measured) >= Number(target);
}

export function isOverdue(task, now = new Date()) {
  if (task.status !== "open" || !task.due_time) return false;
  return now.getTime() > lagosInstant(task.task_date, task.due_time).getTime();
}

// ---------------------------------------------------------------------------
// Reports, visits, ratings
// ---------------------------------------------------------------------------

export function reportIsLate(reportDate, sentAt) {
  return new Date(sentAt).getTime() > lagosInstant(reportDate, REPORT_DUE_TIME).getTime();
}

export function distanceMetres(lat1, lng1, lat2, lng2) {
  const vals = [lat1, lng1, lat2, lng2].map(Number);
  if (vals.some((v) => !Number.isFinite(v))) return null;
  const [a1, o1, a2, o2] = vals;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(a2 - a1);
  const dLng = toRad(o2 - o1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// Productive: an order is linked AND (within 300 m of the Partner's pin, or
// the supervisor approved it). No saved pin = can't be checked, so it isn't
// held against the Associate — it shows as "no pin" for the supervisor.
export function visitIsProductive({ salesOrder, salesInvoice, distanceM, farApproved }) {
  if (!salesOrder && !salesInvoice) return false;
  if (distanceM === null || distanceM === undefined) return true;
  return distanceM <= PRODUCTIVE_RADIUS_M || !!farApproved;
}

export function ratingNeedsComment({ care, dare, conduct, teamwork }) {
  return Math.min(Number(care), Number(dare), Number(conduct), Number(teamwork)) <= 2;
}

export function ratingValid(r) {
  return ["care", "dare", "conduct", "teamwork"].every((k) => Number.isInteger(Number(r[k])) && Number(r[k]) >= 1 && Number(r[k]) <= 5);
}

// ---------------------------------------------------------------------------
// Monthly cycle (spec 6.3)
// ---------------------------------------------------------------------------

// Where `month` is in its cycle at `now`: "live" during the month and up to
// Day 3 of the next; "incomplete" on Days 4–5; "locked" after Day 5 23:59.
export function monthPhase(month, now = new Date()) {
  const today = lagosDate(now);
  const next = addMonths(month, 1);
  if (today < next + "-01") return "live";
  const after = addMonths(month, 2);
  if (today >= after + "-01") return "locked";
  const day = Number(today.slice(8, 10));
  if (day <= RATING_DUE_DAY) return "live";
  if (day <= MONTH_LOCK_DAY) return "incomplete";
  return "locked";
}

// The month a supervisor is rating right now: last month until Day 5,
// otherwise none open (this month is rated next month).
export function ratingMonth(now = new Date()) {
  const today = lagosDate(now);
  const day = Number(today.slice(8, 10));
  if (day <= MONTH_LOCK_DAY) return addMonths(monthOf(today), -1);
  return null;
}

// ---------------------------------------------------------------------------
// Notifications (spec 7)
// ---------------------------------------------------------------------------

export function isQuietHours(now = new Date()) {
  const m = lagosParts(now).minutes;
  return m >= QUIET_START_MIN || m < QUIET_END_MIN;
}

// Add working days (Mon–Fri) to a date.
export function addWorkingDays(dateStr, n) {
  let d = dateStr;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    const wd = weekdayOf(d);
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

// Display name for a centre: outlet codes are stored upper-case
// (lib/perf/scoring.js outletKey); show them the way people say them.
const CENTRE_NAMES = { PHC: "Port Harcourt" };
export function centreLabel(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (CENTRE_NAMES[s.toUpperCase()]) return CENTRE_NAMES[s.toUpperCase()];
  if (s === s.toUpperCase() && /[A-Z]{3,}/.test(s)) return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return s;
}

export function formatNaira(n) {
  const v = Math.round(Number(n) || 0);
  return "₦" + v.toLocaleString("en-NG");
}

export function formatNairaShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return "₦" + (Math.round(v / 1e5) / 10).toString() + "m";
  if (Math.abs(v) >= 1e3) return "₦" + Math.round(v / 1e3) + "k";
  return formatNaira(v);
}
