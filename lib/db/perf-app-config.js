import "server-only";
import { getServiceClient } from "./serviceClient";
import { listAllStaff } from "./perf-staff";
import { weightsValid, isValidMonth, timeToMinutes } from "../perf/app-core";
import { CLUSTERS } from "../perf/scoring";

// ---------------------------------------------------------------------------
// Farm Alert Performance App — admin setup (spec 2 "Performance admin":
// role cards, task templates, scorecards and weights, reporting lines).
// The spec puts this in ERPNext desk; here it's Admin → Performance → App
// setup, backed by the same perf_* tables the phone reads. Every write is
// validated here (CLAUDE.md Section 12) before it reaches the database —
// rule filters especially, since they become ERPNext query filters.
// ---------------------------------------------------------------------------

export class AppConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "AppConfigError";
    this.status = 400;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*(\s[A-Za-z0-9_]+)*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;
const DOCTYPE = /^[A-Za-z][A-Za-z0-9 ]{1,60}$/;
const OPS = new Set(["=", "!=", ">", ">=", "<", "<=", "in", "not in", "like", "not like", "is", "between"]);
const ERP_ID = /^[^\n\r\t<>"]{1,140}$/;
const KEY = /^[a-z][a-z0-9_]{1,40}$/;

function str(v, max = 500) {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

function cleanFilters(list, label) {
  if (list === undefined || list === null || list === "") return [];
  let arr = list;
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      throw new AppConfigError(label + " must be valid JSON, e.g. [[\"docstatus\",\"=\",1]].");
    }
  }
  if (!Array.isArray(arr) || arr.length > 10) throw new AppConfigError(label + " must be a list of up to 10 filters.");
  return arr.map((f) => {
    if (!Array.isArray(f) || f.length !== 3) throw new AppConfigError(label + ": each filter is [field, operator, value].");
    const [field, op, value] = f;
    if (typeof field !== "string" || !FIELD.test(field)) throw new AppConfigError(label + ": invalid field \"" + field + "\".");
    if (!OPS.has(String(op))) throw new AppConfigError(label + ": unsupported operator \"" + op + "\".");
    const okValue = (v) => ["string", "number", "boolean"].includes(typeof v) && String(v).length <= 140;
    if (!(okValue(value) || (Array.isArray(value) && value.length <= 20 && value.every(okValue)))) throw new AppConfigError(label + ": invalid value for " + field + ".");
    return [field, op, value];
  });
}

export async function getSetup() {
  const sb = getServiceClient();
  const [staff, rules, templates, cards, overrides] = await Promise.all([
    listAllStaff(),
    sb.from("perf_auto_rules").select("*").order("label"),
    sb.from("perf_task_templates").select("*").order("cluster", { nullsFirst: true }).order("sort_order"),
    sb.from("perf_scorecards").select("*").order("name"),
    sb.from("perf_task_target_overrides").select("*"),
  ]);
  for (const r of [rules, templates, cards, overrides]) if (r.error) throw r.error;
  return {
    staff: staff.map((s) => ({
      id: s.id,
      name: s.name,
      outlet: s.outlet,
      role: s.role,
      cluster: s.cluster,
      active: s.active,
      reportsTo: s.reportsTo,
      erpEmployee: s.erpEmployee,
      erpUser: s.erpUser,
      erpSalesPerson: s.erpSalesPerson,
      fieldRole: s.fieldRole,
      hasLogin: !!s.owner,
    })),
    rules: rules.data || [],
    templates: templates.data || [],
    scorecards: cards.data || [],
    overrides: overrides.data || [],
    clusters: CLUSTERS,
  };
}

export async function updateStaffLink({ staffId, reportsTo, erpEmployee, erpUser, erpSalesPerson, fieldRole }) {
  if (!UUID.test(staffId || "")) throw new AppConfigError("Choose a staff member.");
  if (reportsTo && !UUID.test(reportsTo)) throw new AppConfigError("Invalid line manager.");
  if (reportsTo === staffId) throw new AppConfigError("Someone can't report to themselves.");
  const ids = { erp_employee: str(erpEmployee, 140), erp_user: str(erpUser, 140), erp_sales_person: str(erpSalesPerson, 140) };
  for (const [k, v] of Object.entries(ids)) if (v && !ERP_ID.test(v)) throw new AppConfigError("Invalid " + k.replace("erp_", "ERPNext ").replace("_", " ") + ".");

  // No reporting loops: walk up from the new manager.
  if (reportsTo) {
    const all = await listAllStaff();
    const byId = new Map(all.map((s) => [s.id, s]));
    let cur = byId.get(reportsTo);
    for (let i = 0; cur && i < 50; i++) {
      if (cur.id === staffId) throw new AppConfigError("That would create a reporting loop.");
      cur = cur.reportsTo ? byId.get(cur.reportsTo) : null;
    }
  }
  const patch = { reports_to: reportsTo || null, ...ids, field_role: fieldRole === true || fieldRole === false ? fieldRole : null };
  const { error } = await getServiceClient().from("perf_staff").update(patch).eq("id", staffId);
  if (error) throw error;
  return { ok: true };
}

export async function saveRule(input) {
  const source = input.source;
  if (!["visits", "productive_visits", "daily_report", "erp"].includes(source)) throw new AppConfigError("Choose where the rule counts from.");
  const key = str(input.key, 41);
  if (!key || !KEY.test(key)) throw new AppConfigError("Key: lower-case letters, numbers and _ only.");
  const label = str(input.label, 140);
  if (!label) throw new AppConfigError("Give the rule a label.");
  const row = {
    key,
    label,
    source,
    doctype_name: null,
    user_field: null,
    user_ref: null,
    date_field: null,
    conditions: [],
    measure: input.measure === "sum" ? "sum" : "count",
    measure_field: null,
    done_when: ["gte_target", "gte_1", "all_compliant"].includes(input.done_when) ? input.done_when : "gte_target",
    compliant_conditions: [],
    active: input.active !== false,
  };
  if (source === "erp") {
    row.doctype_name = str(input.doctype_name, 60);
    if (!row.doctype_name || !DOCTYPE.test(row.doctype_name)) throw new AppConfigError("Enter the ERPNext DocType, e.g. Payment Entry.");
    row.user_field = str(input.user_field, 80);
    if (!row.user_field || !FIELD.test(row.user_field)) throw new AppConfigError("Enter the field that names the employee, e.g. owner or Sales Team.sales_person.");
    row.user_ref = ["erp_user", "erp_sales_person", "erp_employee"].includes(input.user_ref) ? input.user_ref : null;
    if (!row.user_ref) throw new AppConfigError("Choose which ERPNext id to match.");
    row.date_field = str(input.date_field, 60);
    if (!row.date_field || !FIELD.test(row.date_field)) throw new AppConfigError("Enter the date field, e.g. posting_date.");
    row.conditions = cleanFilters(input.conditions, "Conditions");
    row.compliant_conditions = cleanFilters(input.compliant_conditions, "Done-when filters");
  }
  if (row.measure === "sum") {
    row.measure_field = str(input.measure_field, 60);
    if (!row.measure_field || !FIELD.test(row.measure_field)) throw new AppConfigError("Enter the field to add up, e.g. paid_amount.");
  }
  const sb = getServiceClient();
  const q = input.id && UUID.test(input.id) ? sb.from("perf_auto_rules").update(row).eq("id", input.id) : sb.from("perf_auto_rules").insert(row);
  const { error } = await q;
  if (error) {
    if (error.code === "23505") throw new AppConfigError("A rule with that key already exists.");
    throw error;
  }
  return { ok: true };
}

export async function saveTemplate(input) {
  const title = str(input.title, 140);
  if (!title) throw new AppConfigError("Give the task a title.");
  const frequency = ["daily", "weekly", "monthly", "on_event"].includes(input.frequency) ? input.frequency : "daily";
  const source = input.source === "auto" ? "auto" : "manual";
  const row = {
    role: str(input.role, 140),
    cluster: input.cluster && CLUSTERS.includes(input.cluster) ? input.cluster : null,
    title,
    sop_code: str(input.sop_code, 40),
    step_no: input.step_no === "" || input.step_no === null || input.step_no === undefined ? null : Math.max(0, Math.min(999, parseInt(input.step_no, 10) || 0)),
    frequency,
    weekday: frequency === "weekly" ? Number(input.weekday) : null,
    month_day: frequency === "monthly" ? Number(input.month_day) : null,
    due_time: input.due_time ? String(input.due_time).slice(0, 5) : null,
    source,
    auto_rule_id: source === "auto" ? input.auto_rule_id || null : null,
    target_qty: input.target_qty === "" || input.target_qty === null || input.target_qty === undefined ? null : Number(input.target_qty),
    how_to: str(input.how_to, 2000),
    record: str(input.record, 200),
    sop_url: str(input.sop_url, 500),
    active: input.active !== false,
    sort_order: Number.isFinite(Number(input.sort_order)) ? Number(input.sort_order) : 0,
  };
  if (row.due_time && timeToMinutes(row.due_time) === null) throw new AppConfigError("Due time must be HH:MM.");
  if (frequency === "weekly" && !(row.weekday >= 0 && row.weekday <= 6)) throw new AppConfigError("Choose the weekday.");
  if (frequency === "monthly" && !(row.month_day >= 1 && row.month_day <= 31)) throw new AppConfigError("Choose the day of the month.");
  if (source === "auto" && !UUID.test(row.auto_rule_id || "")) throw new AppConfigError("Auto tasks need an auto-tick rule.");
  if (row.target_qty !== null && !(Number.isFinite(row.target_qty) && row.target_qty >= 0)) throw new AppConfigError("Target must be a number.");
  if (row.sop_url && !/^https:\/\//.test(row.sop_url)) throw new AppConfigError("SOP link must start with https://.");
  const sb = getServiceClient();
  const q = input.id && UUID.test(input.id) ? sb.from("perf_task_templates").update(row).eq("id", input.id) : sb.from("perf_task_templates").insert(row);
  const { error } = await q;
  if (error) throw error;
  return { ok: true };
}

export async function saveScorecard(input) {
  const name = str(input.name, 140);
  if (!name) throw new AppConfigError("Give the scorecard a name.");
  const role = str(input.role, 140);
  const cluster = input.cluster && CLUSTERS.includes(input.cluster) ? input.cluster : null;
  if (!role && !cluster) throw new AppConfigError("Choose the role or cluster this scorecard applies to.");
  const kpis = (Array.isArray(input.kpis) ? input.kpis : []).slice(0, 12).map((k, i) => {
    const key = str(k.key, 41) || "k" + (i + 1);
    if (!KEY.test(key)) throw new AppConfigError("KPI key \"" + key + "\": lower-case letters, numbers and _ only.");
    const kpi = str(k.kpi, 140);
    if (!kpi) throw new AppConfigError("Each KPI needs a name.");
    const weight = Number(k.weight);
    const target = Number(k.target);
    if (!(weight >= 0 && weight <= 100)) throw new AppConfigError(kpi + ": weight must be 0–100.");
    if (k.rule_key !== "team_average" && !(target > 0)) throw new AppConfigError(kpi + ": target must be above 0.");
    const rule_key = str(k.rule_key, 41);
    if (!rule_key || !(KEY.test(rule_key) || ["manual", "team_average", "collections_ratio"].includes(rule_key))) throw new AppConfigError(kpi + ": choose where the actual comes from.");
    const target_field = str(k.target_field, 60);
    if (target_field && !/^[A-Za-z][A-Za-z0-9_]*$/.test(target_field)) throw new AppConfigError(kpi + ": invalid personal target field.");
    return { key, kpi, weight, target: rule_key === "team_average" ? 100 : target, target_field, rule_key, higher_is_better: k.higher_is_better !== false };
  });
  if (kpis.length === 0) throw new AppConfigError("Add at least one KPI.");
  if (!weightsValid(kpis)) throw new AppConfigError("Weights must add up to 100 (now " + kpis.reduce((s, k) => s + k.weight, 0) + ").");
  if (new Set(kpis.map((k) => k.key)).size !== kpis.length) throw new AppConfigError("KPI keys must be unique.");
  const row = { name, role, cluster: role ? null : cluster, kpis, active: input.active !== false };
  const sb = getServiceClient();
  const q = input.id && UUID.test(input.id) ? sb.from("perf_scorecards").update(row).eq("id", input.id) : sb.from("perf_scorecards").insert(row);
  const { error } = await q;
  if (error) throw error;
  return { ok: true };
}

export async function setTargetOverride({ staffId, templateId, target }) {
  if (!UUID.test(staffId || "") || !UUID.test(templateId || "")) throw new AppConfigError("Choose a person and a task.");
  const sb = getServiceClient();
  if (target === null || target === "" || target === undefined) {
    const { error } = await sb.from("perf_task_target_overrides").delete().eq("staff_id", staffId).eq("template_id", templateId);
    if (error) throw error;
    return { ok: true };
  }
  const n = Number(target);
  if (!(Number.isFinite(n) && n >= 0)) throw new AppConfigError("Target must be a number.");
  const { error } = await sb.from("perf_task_target_overrides").upsert({ staff_id: staffId, template_id: templateId, target_qty: n }, { onConflict: "staff_id,template_id" });
  if (error) throw error;
  return { ok: true };
}

export async function setManualActual({ staffId, month, kpiKey, actual, actor }) {
  if (!UUID.test(staffId || "")) throw new AppConfigError("Choose a person.");
  if (!isValidMonth(month)) throw new AppConfigError("Invalid month.");
  if (!KEY.test(kpiKey || "")) throw new AppConfigError("Invalid KPI.");
  const sb = getServiceClient();
  const { data: m } = await sb.from("perf_months").select("status").eq("month", month).maybeSingle();
  if (m?.status === "locked") throw new AppConfigError("That month is locked. Use a score correction instead.");
  if (actual === null || actual === "" || actual === undefined) {
    const { error } = await sb.from("perf_kpi_manual_actuals").delete().eq("staff_id", staffId).eq("month", month).eq("kpi_key", kpiKey);
    if (error) throw error;
    return { ok: true };
  }
  const n = Number(actual);
  if (!Number.isFinite(n)) throw new AppConfigError("Actual must be a number.");
  const { error } = await sb.from("perf_kpi_manual_actuals").upsert({ staff_id: staffId, month, kpi_key: kpiKey, actual: n, entered_by: actor, updated_at: new Date().toISOString() }, { onConflict: "staff_id,month,kpi_key" });
  if (error) throw error;
  return { ok: true };
}

export async function listManualActuals(month) {
  const { data, error } = await getServiceClient().from("perf_kpi_manual_actuals").select("*").eq("month", month);
  if (error) throw error;
  return data || [];
}
