import "server-only";
import { getServiceClient } from "./serviceClient";
import { getStaffById } from "./perf-staff";
import { notify } from "./perf-app-notify";
import { ownMediaPath, signedMediaUrls } from "./perf-app-media";
import { listDirectReports, isGrowthReviewer, isPerformanceAdmin, isViewer } from "../perf/app-auth";
import { lagosDate, addWorkingDays, monthOf, DARE_POINTS, IDEA_STATUS_LABELS, isValidMonth, centreLabel } from "../perf/app-core";
import { outletLabel } from "../perf/scoring";

// ---------------------------------------------------------------------------
// Farm Alert Performance App — ideas and Dare points (spec 4 FA Idea /
// FA Dare Point, screen 07, SOP-GRO-01).
//
//   Improvement: the line manager decides within 10 working days
//                (fast track, on the supervisor's Ideas to decide tab).
//   Growth:      scored at Gate 1 by the VP Sales & Marketing (value,
//                margin, cost, fit 1–5), then decided at Gate 1 / Gate 3.
// Points are a ledger (perf_dare_points) so they can be audited: submitted
// 1, tested 3, adopted or scaled 5, each at most once per idea. Every
// decision carries a reason the person can read.
// ---------------------------------------------------------------------------

export class AppIdeaError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "AppIdeaError";
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECISIONS = { adopt: "adopted", try: "in_test", no: "no", park: "parked", scale: "scaled" };

async function award(staffId, ideaId, reason) {
  const { error } = await getServiceClient().from("perf_dare_points").insert({ staff_id: staffId, idea_id: ideaId, points: DARE_POINTS[reason === "adopted" ? "adopted" : reason], reason, awarded_on: lagosDate() });
  if (error && error.code !== "23505") throw error;
  return !error;
}

function shortDate(d) {
  return new Date(d + "T00:00:00Z").toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function shapeIdea(i, { points = 0, urls, owner } = {}) {
  return {
    id: i.id,
    kind: i.kind,
    title: i.title,
    problem: i.problem,
    benefit: i.benefit,
    est: i.est_saving_or_margin,
    status: i.status,
    statusLabel: IDEA_STATUS_LABELS[i.status],
    reason: i.decision_reason,
    decidedBy: i.decided_by,
    decidedAt: i.decided_at,
    decideBy: i.decide_by,
    decideByLabel: i.decide_by ? shortDate(i.decide_by) : null,
    scores: i.score_value ? { value: i.score_value, margin: i.score_margin, cost: i.score_cost, fit: i.score_fit } : null,
    ideaOfMonth: i.idea_of_month,
    points,
    photo: urls && i.photo_path ? urls.get(i.photo_path) || null : null,
    voice: urls && i.voice_path ? urls.get(i.voice_path) || null : null,
    createdAt: i.created_at,
    owner: owner || null,
  };
}

export async function submitIdea(staff, p) {
  const clientId = String(p.client_id || "");
  if (!UUID.test(clientId)) throw new AppIdeaError("Missing idea id.");
  const sb = getServiceClient();
  const { data: dup } = await sb.from("perf_ideas").select("*").eq("client_id", clientId).maybeSingle();
  if (dup) {
    if (dup.staff_id !== staff.id) throw new AppIdeaError("Idea id already used.", 409);
    return { ok: true, duplicate: true, idea: shapeIdea(dup, { points: 1 }) };
  }

  const kind = p.kind === "growth" ? "growth" : p.kind === "improvement" ? "improvement" : null;
  if (!kind) throw new AppIdeaError("Choose Improvement or Growth.");
  const title = String(p.title || "").trim().slice(0, 140);
  if (!title) throw new AppIdeaError("Write your idea in one line.");
  const photo = p.photo || null;
  const voice = p.voice || null;
  if (photo && !ownMediaPath(staff.id, photo, "idea_photo")) throw new AppIdeaError("Invalid photo.");
  if (voice && !ownMediaPath(staff.id, voice, "idea_voice")) throw new AppIdeaError("Invalid voice note.");

  const today = lagosDate();
  const decideBy = kind === "improvement" ? addWorkingDays(today, 10) : null;
  const { data, error } = await sb
    .from("perf_ideas")
    .insert({
      staff_id: staff.id,
      client_id: clientId,
      kind,
      title,
      problem: String(p.problem || "").trim().slice(0, 2000) || null,
      benefit: String(p.benefit || "").trim().slice(0, 2000) || null,
      est_saving_or_margin: String(p.est || "").trim().slice(0, 200) || null,
      photo_path: photo,
      voice_path: voice,
      decide_by: decideBy,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return submitIdea(staff, p);
    throw error;
  }
  await award(staff.id, data.id, "submitted");

  await notify(staff.id, {
    kind: "idea_received",
    title: "Idea received, +1 Dare point",
    body: kind === "improvement" ? "Your line manager will decide by " + shortDate(decideBy) + "." : "It will be scored at the monthly Growth review.",
    url: "/?view=ideas",
    dedupeKey: "idea-received:" + data.id,
  });
  if (kind === "improvement" && staff.reportsTo) {
    await notify(staff.reportsTo, { kind: "idea_to_decide", title: "New idea to decide", body: staff.name.split(" ")[0] + ": " + title, url: "/?view=decide", dedupeKey: "idea-mgr:" + data.id });
  }
  return { ok: true, idea: shapeIdea(data, { points: 1 }) };
}

export async function myIdeas(staff) {
  const sb = getServiceClient();
  const [{ data: ideas, error }, { data: points }] = await Promise.all([
    sb.from("perf_ideas").select("*").eq("staff_id", staff.id).order("created_at", { ascending: false }).limit(100),
    sb.from("perf_dare_points").select("idea_id, points").eq("staff_id", staff.id),
  ]);
  if (error) throw error;
  const byIdea = new Map();
  (points || []).forEach((p) => byIdea.set(p.idea_id, (byIdea.get(p.idea_id) || 0) + p.points));
  const urls = await signedMediaUrls((ideas || []).flatMap((i) => [i.photo_path, i.voice_path]));
  return {
    totalPoints: (points || []).reduce((s, p) => s + p.points, 0),
    ideas: (ideas || []).map((i) => shapeIdea(i, { points: byIdea.get(i.id) || 0, urls })),
  };
}

// Supervisor fast track + (for the VP Sales & Marketing) growth ideas.
export async function ideasToDecide(me) {
  const sb = getServiceClient();
  const direct = await listDirectReports(me.id);
  const directIds = direct.map((p) => p.id);
  const reviewer = isGrowthReviewer(me);
  const viewer = isViewer(me) || isPerformanceAdmin(me);

  const queries = [];
  if (directIds.length) queries.push(sb.from("perf_ideas").select("*").eq("kind", "improvement").in("staff_id", directIds).in("status", ["received", "in_test"]));
  if (reviewer || viewer) queries.push(sb.from("perf_ideas").select("*").eq("kind", "growth").in("status", ["received", "scored", "in_test", "adopted"]));
  const results = await Promise.all(queries);
  const rows = results.flatMap((r) => r.data || []);
  const owners = new Map();
  for (const id of [...new Set(rows.map((r) => r.staff_id))]) {
    const s = await getStaffById(id);
    if (s) owners.set(id, { id: s.id, name: s.name, centre: centreLabel(outletLabel(s.outlet)) });
  }
  const urls = await signedMediaUrls(rows.flatMap((i) => [i.photo_path, i.voice_path]));
  const seen = new Set();
  const ideas = rows
    .filter((r) => (seen.has(r.id) ? false : seen.add(r.id)))
    .sort((a, b) => (a.decide_by || "9999").localeCompare(b.decide_by || "9999") || b.created_at.localeCompare(a.created_at))
    .map((i) => ({ ...shapeIdea(i, { urls, owner: owners.get(i.staff_id) }), canDecide: (i.kind === "improvement" && directIds.includes(i.staff_id)) || (i.kind === "growth" && reviewer) || isPerformanceAdmin(me) }));
  return { growthReviewer: reviewer, ideas };
}

async function loadIdea(id) {
  if (!UUID.test(id || "")) throw new AppIdeaError("Idea not found.", 404);
  const { data, error } = await getServiceClient().from("perf_ideas").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new AppIdeaError("Idea not found.", 404);
  return data;
}

async function assertCanDecide(me, idea) {
  if (isPerformanceAdmin(me)) return;
  if (idea.kind === "growth") {
    if (!isGrowthReviewer(me)) throw new AppIdeaError("Growth ideas are decided at the Growth review.", 403);
    return;
  }
  const owner = await getStaffById(idea.staff_id);
  if (!owner || owner.reportsTo !== me.id) throw new AppIdeaError("Only their line manager can decide this idea.", 403);
}

// decide_idea (spec 9): {idea, decision: Adopt|Try|No|Park|Scale, reason}.
export async function decideIdea(me, { idea: ideaId, decision, reason }) {
  const idea = await loadIdea(ideaId);
  await assertCanDecide(me, idea);
  const status = DECISIONS[String(decision || "").toLowerCase()];
  if (!status) throw new AppIdeaError("Choose Adopt, Try, Park or No.");
  if (status === "scaled" && idea.status !== "adopted") throw new AppIdeaError("Only an adopted idea can be scaled.");
  const why = String(reason || "").trim().slice(0, 2000);
  if (!why) throw new AppIdeaError("Give a reason: the person will see it.");

  const patch = { status, decision_reason: why, decided_by: me.name, decided_at: new Date().toISOString() };
  if (status === "in_test" && !idea.test_owner) patch.test_owner = idea.staff_id; // originator offered first
  const { error } = await getServiceClient().from("perf_ideas").update(patch).eq("id", idea.id);
  if (error) throw error;

  let pts = 0;
  if (status === "in_test" && (await award(idea.staff_id, idea.id, "tested"))) pts = DARE_POINTS.tested;
  if ((status === "adopted" || status === "scaled") && (await award(idea.staff_id, idea.id, "adopted"))) pts = DARE_POINTS.adopted;

  const verb = { adopted: "was adopted", in_test: "will be tested", no: "won't go ahead", parked: "is parked for now", scaled: "is being scaled" }[status];
  await notify(idea.staff_id, {
    kind: "idea_decided",
    title: "Your idea " + verb,
    body: "'" + idea.title + "' " + verb + "." + (pts ? " +" + pts + " Dare points." : "") + " " + why,
    url: "/?view=ideas",
    dedupeKey: "idea-decided:" + idea.id + ":" + status,
  });
  return { ok: true, status, points: pts };
}

// Gate 1 scoring for growth ideas (VP Sales & Marketing).
export async function scoreGrowthIdea(me, { idea: ideaId, value, margin, cost, fit }) {
  const idea = await loadIdea(ideaId);
  if (idea.kind !== "growth") throw new AppIdeaError("Only growth ideas are scored.");
  if (!isGrowthReviewer(me) && !isPerformanceAdmin(me)) throw new AppIdeaError("Only the Growth reviewer can score ideas.", 403);
  const s = { score_value: Number(value), score_margin: Number(margin), score_cost: Number(cost), score_fit: Number(fit) };
  if (!Object.values(s).every((v) => Number.isInteger(v) && v >= 1 && v <= 5)) throw new AppIdeaError("Each score must be 1 to 5.");
  const patch = { ...s };
  if (idea.status === "received") patch.status = "scored";
  const { error } = await getServiceClient().from("perf_ideas").update(patch).eq("id", idea.id);
  if (error) throw error;
  return { ok: true };
}

export async function setIdeaOfMonth(me, { idea: ideaId, month }) {
  if (!isGrowthReviewer(me) && !isPerformanceAdmin(me)) throw new AppIdeaError("Only the Growth reviewer names the Idea of the Month.", 403);
  const m = month || monthOf(lagosDate());
  if (!isValidMonth(m)) throw new AppIdeaError("Invalid month.");
  const idea = await loadIdea(ideaId);
  const sb = getServiceClient();
  await sb.from("perf_ideas").update({ idea_of_month: null }).eq("idea_of_month", m);
  const { error } = await sb.from("perf_ideas").update({ idea_of_month: m }).eq("id", idea.id);
  if (error) throw error;
  await sb.from("perf_months").upsert({ month: m, idea_of_month: idea.id, updated_at: new Date().toISOString() }, { onConflict: "month" });
  await notify(idea.staff_id, { kind: "idea_of_month", title: "Idea of the Month", body: "'" + idea.title + "' is the Idea of the Month. Well done.", url: "/?view=ideas", dedupeKey: "iotm:" + m });
  return { ok: true };
}

// Admin/desk: every idea, optionally by status/kind.
export async function listAllIdeas({ kind, status } = {}) {
  let q = getServiceClient().from("perf_ideas").select("*").order("created_at", { ascending: false }).limit(300);
  if (kind) q = q.eq("kind", kind);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  const owners = new Map();
  for (const id of [...new Set((data || []).map((r) => r.staff_id))]) {
    const s = await getStaffById(id);
    if (s) owners.set(id, { id: s.id, name: s.name, centre: centreLabel(outletLabel(s.outlet)) });
  }
  return (data || []).map((i) => shapeIdea(i, { owner: owners.get(i.staff_id) }));
}
