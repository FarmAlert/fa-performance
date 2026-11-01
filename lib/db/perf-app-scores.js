import "server-only";
import { getServiceClient } from "./serviceClient";
import { listAllStaff, getLogsForMonth, getMonthlyInputsForMonth } from "./perf-staff";
import { getAppSettings } from "./settings";
import { measureRule } from "./perf-app-tasks";
import { notify } from "./perf-app-notify";
import { computeAllScores, KPI_LABELS, resolveWeights, outletLabel } from "../perf/scoring";
import { kpiScore, monthlyScore, bandOf, nextBandGap, monthPhase, monthRange, lagosDate, addMonths, monthOf, BAND_LABELS } from "../perf/app-core";

// ---------------------------------------------------------------------------
// Farm Alert Performance App — monthly scores (spec 4 FA Monthly Score, 6).
//
// Two sources, so the app connects to the Performance System that already
// runs today rather than replacing it:
//   - "scorecard": the role has a perf_scorecards row (spec 6.2). Each KPI's
//     actual comes from ERPNext (read-only) or our own visits/reports, over
//     the month to date, scored 0–100 and weighted (lib/perf/app-core.js).
//   - "cluster": no scorecard yet — the existing lib/perf/scoring.js
//     formula for that cluster (the same number the admin CEO Dashboard and
//     the widget show), so nobody's score disappears while scorecards are
//     rolled out role by role.
// Leaders' "team_average" KPI is computed after their team (spec 6.1).
// Rebuilt nightly while the month is open; frozen on Day 5 (lockMonth),
// when missing figures start counting as zero (spec 6.3).
// ---------------------------------------------------------------------------

export class AppScoreError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "AppScoreError";
    this.status = status;
  }
}

function clusterLines(cluster, kpis, weightOverrides) {
  const labels = KPI_LABELS[cluster] || [];
  const weights = resolveWeights(cluster, weightOverrides) || [];
  return (kpis || []).map((s, i) => {
    const score = s === null || s === undefined ? null : Math.round(Math.max(0, Math.min(100, Number(s))));
    const w = Math.round((Number(weights[i]) || 0) * 100);
    return { key: "k" + i, kpi: String(labels[i] || "KPI " + (i + 1)).replace(/\s*\(\d+%\)\s*$/, ""), weight: w, actual: null, target: null, score, weighted: score === null ? null : Math.round(score * w) / 100 };
  });
}

async function loadContext(month) {
  const sb = getServiceClient();
  const allStaff = (await listAllStaff()).filter((s) => s.active);
  const ids = allStaff.map((s) => s.id);
  const [cards, rules, manual, logs, monthlyInputs, settings] = await Promise.all([
    sb.from("perf_scorecards").select("*").eq("active", true),
    sb.from("perf_auto_rules").select("*").eq("active", true),
    sb.from("perf_kpi_manual_actuals").select("staff_id, kpi_key, actual").eq("month", month),
    getLogsForMonth(ids, month),
    getMonthlyInputsForMonth(ids, month),
    getAppSettings(),
  ]);
  if (cards.error) throw cards.error;
  if (rules.error) throw rules.error;
  if (manual.error) throw manual.error;
  const weights = settings.perf_cluster_weights || {};
  return {
    allStaff,
    cards: cards.data || [],
    rules: new Map((rules.data || []).map((r) => [r.key, r])),
    manual: new Map((manual.data || []).map((m) => [m.staff_id + "|" + m.kpi_key, Number(m.actual)])),
    clusterScores: computeAllScores(allStaff, logs, month, monthlyInputs, weights),
    weights,
  };
}

export function scorecardFor(staff, cards) {
  const role = String(staff.role || "").trim().toLowerCase();
  return cards.find((c) => c.role && c.role.trim().toLowerCase() === role) || cards.find((c) => !c.role && c.cluster && c.cluster === staff.cluster) || null;
}

async function kpiActual(kpi, staff, ctx, range, teamScores) {
  const rk = kpi.rule_key;
  if (rk === "manual") {
    const v = ctx.manual.get(staff.id + "|" + kpi.key);
    return v === undefined ? null : v;
  }
  if (rk === "team_average") {
    const team = ctx.allStaff.filter((s) => s.reportsTo === staff.id);
    const scores = team.map((s) => teamScores.get(s.id)).filter((v) => v !== null && v !== undefined);
    return scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  }
  if (rk === "collections_ratio") {
    const sales = ctx.rules.get("sales_invoiced");
    const pay = ctx.rules.get("payments_received");
    if (!sales || !pay) return null;
    const [s, p] = await Promise.all([measureRule(sales, staff, range.from, range.to), measureRule(pay, staff, range.from, range.to)]);
    if (s.unavailable || p.unavailable || !s.measured) return null;
    return Math.round((p.measured / s.measured) * 1000) / 10;
  }
  const rule = ctx.rules.get(rk);
  if (!rule) return null;
  const m = await measureRule(rule, staff, range.from, range.to);
  return m.unavailable ? null : m.measured;
}

async function computeOne(staff, month, ctx, teamScores, { missingAsZero }) {
  const card = scorecardFor(staff, ctx.cards);
  if (!card) {
    const r = ctx.clusterScores[staff.id];
    if (!r && !staff.cluster) return null;
    const lines = clusterLines(staff.cluster, r?.kpis || [], ctx.weights);
    const score = r ? r.overall : missingAsZero ? 0 : null;
    return { source: "cluster", lines, score };
  }
  const { from, to } = monthRange(month);
  const today = lagosDate();
  const range = { from, to: to < today ? to : today };
  const lines = [];
  for (const k of card.kpis || []) {
    let actual = null;
    try {
      actual = await kpiActual(k, staff, ctx, range, teamScores);
    } catch (err) {
      console.error("[perf-app] KPI " + k.key + " for " + staff.id + " failed: " + err.message);
    }
    const personal = k.target_field ? Number(staff.targets?.[k.target_field]) : NaN;
    const target = Number.isFinite(personal) && personal > 0 ? personal : Number(k.target);
    const score = kpiScore(actual, target, k.higher_is_better !== false);
    const weight = Number(k.weight) || 0;
    lines.push({ key: k.key, kpi: k.kpi, weight, actual, target, money: k.rule_key === "sales_invoiced" || k.rule_key === "payments_received", percent: k.rule_key === "collections_ratio", score, weighted: score === null ? null : Math.round(score * weight) / 100 });
  }
  return { source: "scorecard", lines, score: monthlyScore(lines, { missingAsZero }) };
}

function usesTeamAverage(staff, cards) {
  const card = scorecardFor(staff, cards);
  return !!card && (card.kpis || []).some((k) => k.rule_key === "team_average");
}

async function monthStatus(month) {
  const { data } = await getServiceClient().from("perf_months").select("*").eq("month", month).maybeSingle();
  return data || { month, status: "live" };
}

// rebuild_scores (00:30 daily) and the final pass inside lock_month.
export async function rebuildScores(month, { missingAsZero = false, lock = false } = {}) {
  const sb = getServiceClient();
  const ms = await monthStatus(month);
  if (ms.status === "locked") return { skipped: "locked" };
  const ctx = await loadContext(month);
  const { data: lockedRows } = await sb.from("perf_monthly_scores").select("staff_id").eq("month", month).eq("status", "locked");
  const lockedIds = new Set((lockedRows || []).map((r) => r.staff_id));

  const teamScores = new Map();
  const first = ctx.allStaff.filter((s) => !usesTeamAverage(s, ctx.cards));
  const second = ctx.allStaff.filter((s) => usesTeamAverage(s, ctx.cards));
  const phase = lock ? "locked" : monthPhase(month);
  let written = 0;
  for (const group of [first, second]) {
    for (const staff of group) {
      if (lockedIds.has(staff.id)) continue;
      try {
        const r = await computeOne(staff, month, ctx, teamScores, { missingAsZero });
        if (!r) continue;
        teamScores.set(staff.id, r.score);
        const { error } = await sb.from("perf_monthly_scores").upsert(
          {
            staff_id: staff.id,
            month,
            source: r.source,
            lines: r.lines,
            score: r.score,
            band: bandOf(r.score),
            status: phase,
            locked_at: lock ? new Date().toISOString() : null,
            computed_at: new Date().toISOString(),
          },
          { onConflict: "staff_id,month" }
        );
        if (error) throw error;
        written++;
      } catch (err) {
        console.error("[perf-app] score for " + staff.id + " " + month + " failed: " + err.message);
      }
    }
  }
  return { written };
}

// Day 3, 23:59: flag missing figures and ratings; tell HR and line managers.
export async function markIncomplete(month) {
  const sb = getServiceClient();
  await rebuildScores(month);
  const [{ data: scores }, { data: ratings }] = await Promise.all([
    sb.from("perf_monthly_scores").select("staff_id, score, lines").eq("month", month),
    sb.from("perf_supervisor_ratings").select("staff_id").eq("month", month),
  ]);
  const rated = new Set((ratings || []).map((r) => r.staff_id));
  const staff = (await listAllStaff()).filter((s) => s.active);
  const byManager = new Map();
  let missingFigures = 0;
  let missingRatings = 0;
  for (const s of staff) {
    const row = (scores || []).find((r) => r.staff_id === s.id);
    const gaps = !row || row.score === null || (row.lines || []).some((l) => l.score === null);
    if (gaps) missingFigures++;
    if (s.reportsTo && !rated.has(s.id)) {
      missingRatings++;
      if (!byManager.has(s.reportsTo)) byManager.set(s.reportsTo, []);
      byManager.get(s.reportsTo).push(s.name.split(" ")[0]);
    }
  }
  for (const [managerId, names] of byManager) {
    await notify(managerId, { kind: "ratings_missing", title: "Ratings due", body: "Rate " + names.join(", ") + " for " + monthLabel(month) + " before Day 5, when the month locks.", url: "/?view=ratings", dedupeKey: "incomplete-mgr:" + month + ":" + managerId });
  }
  for (const hr of staff.filter((s) => s.isAdmin || s.accessLevel === "admin")) {
    await notify(hr.id, { kind: "month_incomplete", title: monthLabel(month) + " is incomplete", body: missingFigures + " people have missing figures and " + missingRatings + " ratings are missing. The month locks on Day 5.", url: "/admin", dedupeKey: "incomplete-hr:" + month + ":" + hr.id });
  }
  await sb.from("perf_monthly_scores").update({ status: "incomplete" }).eq("month", month).neq("status", "locked");
  await sb.from("perf_months").upsert({ month, status: "incomplete", incomplete_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "month" });
  return { missingFigures, missingRatings };
}

// Day 5, 23:59: final rebuild (missing = 0), then lock scores and ratings.
export async function lockMonth(month, actor = "system") {
  const sb = getServiceClient();
  const ms = await monthStatus(month);
  if (ms.status === "locked") return { skipped: "locked" };
  const r = await rebuildScores(month, { missingAsZero: true, lock: true });
  const now = new Date().toISOString();
  await sb.from("perf_monthly_scores").update({ status: "locked", locked_at: now }).eq("month", month);
  await sb.from("perf_supervisor_ratings").update({ locked: true }).eq("month", month);
  await sb.from("perf_months").upsert({ month, status: "locked", locked_at: now, locked_by: actor, updated_at: now }, { onConflict: "month" });
  return { locked: true, written: r.written || 0 };
}

export function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" }) + (y !== Number(lagosDate().slice(0, 4)) ? " " + y : "");
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function shapeScore(row) {
  if (!row) return { score: null, band: "no_data", bandLabel: BAND_LABELS.no_data, lines: [], status: "live", source: null };
  const score = row.score === null ? null : Number(row.score);
  return { score, band: row.band, bandLabel: BAND_LABELS[row.band], gap: nextBandGap(score), lines: row.lines || [], status: row.status, source: row.source, verified: row.verified, computedAt: row.computed_at };
}

// Current-month score for a set of people (header pill, Team screen).
export async function scoresFor(staffIds, month) {
  if (staffIds.length === 0) return new Map();
  const { data, error } = await getServiceClient().from("perf_monthly_scores").select("*").in("staff_id", staffIds).eq("month", month);
  if (error) throw error;
  return new Map((data || []).map((r) => [r.staff_id, shapeScore(r)]));
}

// A single live recompute for someone whose score hasn't been built yet
// (first day of a month, or a new joiner) — never for a locked month.
async function liveScoreFor(staff, month) {
  try {
    const ctx = await loadContext(month);
    const teamScores = new Map();
    const { data } = await getServiceClient().from("perf_monthly_scores").select("staff_id, score").eq("month", month);
    (data || []).forEach((r) => teamScores.set(r.staff_id, r.score === null ? null : Number(r.score)));
    const r = await computeOne(staff, month, ctx, teamScores, { missingAsZero: false });
    if (!r) return null;
    return { score: r.score, band: bandOf(r.score), lines: r.lines, status: monthPhase(month), source: r.source };
  } catch (err) {
    console.error("[perf-app] live score failed: " + err.message);
    return null;
  }
}

export async function getMyRating(staff, month) {
  const sb = getServiceClient();
  const [{ data: row }, { data: rating }, { data: history }, { data: points }] = await Promise.all([
    sb.from("perf_monthly_scores").select("*").eq("staff_id", staff.id).eq("month", month).maybeSingle(),
    sb.from("perf_supervisor_ratings").select("*, rater:perf_staff!perf_supervisor_ratings_rated_by_fkey(name)").eq("staff_id", staff.id).eq("month", month).maybeSingle(),
    sb.from("perf_monthly_scores").select("month, score, band").eq("staff_id", staff.id).eq("status", "locked").lt("month", month).order("month", { ascending: false }).limit(5),
    sb.from("perf_dare_points").select("points, reason, awarded_on").eq("staff_id", staff.id),
  ]);
  let score = row ? shapeScore(row) : null;
  if (!score) {
    const live = monthPhase(month) === "locked" ? null : await liveScoreFor(staff, month);
    score = shapeScore(live ? { ...live, verified: false } : null);
  }
  const monthPoints = (points || []).filter((p) => monthOf(p.awarded_on) === month).reduce((s, p) => s + p.points, 0);
  return {
    month,
    monthLabel: monthLabel(month),
    ...score,
    locked: score.status === "locked",
    rating: rating
      ? { care: rating.care, dare: rating.dare, conduct: rating.conduct, teamwork: rating.teamwork, comment: rating.comment || "", by: rating.rater?.name || null, locked: rating.locked, savedAt: rating.updated_at }
      : null,
    trend: (history || []).reverse().map((h) => ({ month: h.month, label: monthLabel(h.month).slice(0, 3), score: h.score === null ? null : Number(h.score), band: h.band })),
    darePoints: { total: (points || []).reduce((s, p) => s + p.points, 0), thisMonth: monthPoints },
  };
}

// ---------------------------------------------------------------------------
// Admin: export, corrections, verification (spec 6.3, 10.2, SOP-PPL-06)
// ---------------------------------------------------------------------------

export async function exportRows(month) {
  const sb = getServiceClient();
  const staff = await listAllStaff();
  const [{ data: scores }, { data: ratings }, { data: points }] = await Promise.all([
    sb.from("perf_monthly_scores").select("*").eq("month", month),
    sb.from("perf_supervisor_ratings").select("*").eq("month", month),
    sb.from("perf_dare_points").select("staff_id, points, awarded_on"),
  ]);
  const sMap = new Map((scores || []).map((r) => [r.staff_id, r]));
  const rMap = new Map((ratings || []).map((r) => [r.staff_id, r]));
  const byId = new Map(staff.map((s) => [s.id, s]));
  return staff
    .filter((s) => s.active || sMap.has(s.id))
    .map((s) => {
      const sc = sMap.get(s.id);
      const r = rMap.get(s.id);
      const pts = (points || []).filter((p) => p.staff_id === s.id && monthOf(p.awarded_on) === month).reduce((a, p) => a + p.points, 0);
      return {
        staffId: s.id,
        name: s.name,
        outlet: outletLabel(s.outlet),
        role: s.role,
        lineManager: s.reportsTo ? byId.get(s.reportsTo)?.name || "" : "",
        score: sc?.score === null || sc?.score === undefined ? null : Number(sc.score),
        band: BAND_LABELS[sc?.band || "no_data"],
        source: sc?.source || "",
        status: sc?.status || "no data",
        verified: !!sc?.verified,
        care: r?.care ?? null,
        dare: r?.dare ?? null,
        conduct: r?.conduct ?? null,
        teamwork: r?.teamwork ?? null,
        ratingComment: r?.comment || "",
        darePoints: pts,
        lines: sc?.lines || [],
      };
    })
    .sort((a, b) => a.outlet.localeCompare(b.outlet) || a.name.localeCompare(b.name));
}

export async function correctScore({ staffId, month, newScore, reason, actor }) {
  const n = Number(newScore);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new AppScoreError("Score must be 0–100.");
  if (!String(reason || "").trim()) throw new AppScoreError("A reason is required for every correction.");
  const sb = getServiceClient();
  const { data: row } = await sb.from("perf_monthly_scores").select("*").eq("staff_id", staffId).eq("month", month).maybeSingle();
  if (!row) throw new AppScoreError("No score for that person and month.", 404);
  const { error: cErr } = await sb.from("perf_score_corrections").insert({ staff_id: staffId, month, old_score: row.score, new_score: Math.round(n), reason: String(reason).slice(0, 1000), corrected_by: actor });
  if (cErr) throw cErr;
  const { error } = await sb.from("perf_monthly_scores").update({ score: Math.round(n), band: bandOf(Math.round(n)) }).eq("id", row.id);
  if (error) throw error;
  return { ok: true };
}

export async function setVerified({ staffId, month, verified, actor }) {
  const { error } = await getServiceClient().from("perf_monthly_scores").update({ verified: !!verified, verified_by: verified ? actor : null }).eq("staff_id", staffId).eq("month", month);
  if (error) throw error;
  return { ok: true };
}

export async function listCorrections(month) {
  const { data, error } = await getServiceClient().from("perf_score_corrections").select("*").eq("month", month).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listMonths() {
  const { data, error } = await getServiceClient().from("perf_months").select("*").order("month", { ascending: false }).limit(24);
  if (error) throw error;
  const current = monthOf(lagosDate());
  const prev = addMonths(current, -1);
  const rows = data || [];
  for (const m of [current, prev]) if (!rows.find((r) => r.month === m)) rows.push({ month: m, status: "live" });
  return rows.sort((a, b) => b.month.localeCompare(a.month)).map((r) => ({ ...r, label: monthLabel(r.month), phase: monthPhase(r.month) }));
}
