"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Button, { PageHeader, Panel } from "./ui";

// /admin setup. Six tabs over the same tables the phone app reads. Every
// save goes through /api/admin, which validates and permission-checks it
// (lib/perf/admin-auth.js); this page only hides controls a read-only
// viewer couldn't use anyway.

const TABS = [
  ["people", "People & reporting"],
  ["templates", "Task templates"],
  ["rules", "Auto-tick rules"],
  ["scorecards", "Scorecards"],
  ["months", "Months & scores"],
  ["ideas", "Ideas"],
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const BAND_CLASS = { Green: "bg-green/15 text-[#1a8f4c]", Amber: "bg-amber-50 text-amber-700", Red: "bg-red-50 text-red-700", "No data": "bg-slate-100 text-slate-500" };
const input = "w-full border border-slate-200 rounded-lg px-3 h-10 text-sm focus:outline-none focus:ring-2 focus:ring-navy/30";
const label = "text-xs font-semibold text-slate-500";

async function postAction(body) {
  const res = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json", "x-perf-app": "1" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Couldn't save.");
  return data;
}

function Field({ title, children, className = "" }) {
  return (
    <label className={"flex flex-col gap-1 " + className}>
      <span className={label}>{title}</span>
      {children}
    </label>
  );
}

function Notice({ msg }) {
  if (!msg) return null;
  return <p className={"text-sm rounded-lg px-3 py-2 " + (msg.ok ? "bg-green/10 text-[#1a8f4c]" : "bg-red-50 text-red-700")}>{msg.text}</p>;
}

export default function SetupClient({ onSignedOut }) {
  const [tab, setTab] = useState("people");
  const [month, setMonth] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async (m) => {
    setError("");
    try {
      const res = await fetch("/api/admin" + (m ? "?month=" + m : ""), { cache: "no-store" });
      if (res.status === 401) return onSignedOut?.();
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't load.");
      setData(d);
      setMonth(d.month);
    } catch (err) {
      setError(err.message);
    }
  }, [onSignedOut]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumb={data?.canManage ? "Performance admin" : "Read-only view"}
        title="Setup and scores"
        subtitle="Reporting lines, ERPNext links, role tasks, auto-ticks, scorecards, the monthly lock and exports for the staff phone app."
      />
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={"rounded-full px-4 h-10 text-sm font-semibold whitespace-nowrap border " + (tab === k ? "bg-navy text-white border-navy" : "bg-white text-navy border-slate-200 hover:border-navy/40")}>
            {l}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      {!data && !error && <div className="bg-white rounded-2xl border border-slate-100 p-6 text-slate-400 text-sm">Loading…</div>}
      {data && tab === "people" && <PeopleTab data={data} reload={() => load(month)} />}
      {data && tab === "templates" && <TemplatesTab data={data} reload={() => load(month)} />}
      {data && tab === "rules" && <RulesTab data={data} reload={() => load(month)} />}
      {data && tab === "scorecards" && <ScorecardsTab data={data} reload={() => load(month)} />}
      {data && tab === "months" && <MonthsTab data={data} month={month} setMonth={(m) => load(m)} reload={() => load(month)} />}
      {data && tab === "ideas" && <IdeasTab data={data} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PeopleTab({ data, reload }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState(null);
  const byId = useMemo(() => new Map(data.staff.map((s) => [s.id, s])), [data.staff]);
  const list = data.staff.filter((s) => s.active && (!q || (s.name + " " + s.outlet + " " + s.role).toLowerCase().includes(q.toLowerCase())));
  const unlinked = data.staff.filter((s) => s.active && s.cluster && !s.reportsTo).length;

  async function save() {
    setMsg(null);
    try {
      await postAction({ action: "update_staff_link", staffId: editing.id, reportsTo: editing.reportsTo || null, erpEmployee: editing.erpEmployee, erpUser: editing.erpUser, erpSalesPerson: editing.erpSalesPerson, fieldRole: editing.fieldRole });
      setMsg({ ok: true, text: "Saved " + editing.name + "." });
      setEditing(null);
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  return (
    <Panel title="People and reporting lines" subtitle={"Line manager drives who supervises whom in the app (spec: Employee.reports_to). ERPNext ids drive auto-ticks and report figures. " + unlinked + " active people have no line manager yet."}>
      <div className="flex flex-col gap-3">
        <input className={input} placeholder="Search name, centre or role" value={q} onChange={(e) => setQ(e.target.value)} />
        <Notice msg={msg} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs">
                <th className="py-2 pr-3">Person</th>
                <th className="py-2 pr-3">Line manager</th>
                <th className="py-2 pr-3">ERPNext user</th>
                <th className="py-2 pr-3">Sales Person</th>
                <th className="py-2 pr-3">Employee</th>
                <th className="py-2 pr-3">Field role</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 align-top">
                  {editing?.id === s.id ? (
                    <>
                      <td className="py-2 pr-3">
                        <div className="font-semibold text-navy">{s.name}</div>
                        <div className="text-xs text-slate-400">{s.outlet} · {s.role}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <select className={input} value={editing.reportsTo || ""} onChange={(e) => setEditing({ ...editing, reportsTo: e.target.value || null })}>
                          <option value="">None</option>
                          {data.staff
                            .filter((o) => o.active && o.id !== s.id)
                            .map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name} ({o.outlet})
                              </option>
                            ))}
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        <input className={input} value={editing.erpUser || ""} onChange={(e) => setEditing({ ...editing, erpUser: e.target.value })} placeholder="user@farmalert.com.ng" />
                      </td>
                      <td className="py-2 pr-3">
                        <input className={input} value={editing.erpSalesPerson || ""} onChange={(e) => setEditing({ ...editing, erpSalesPerson: e.target.value })} />
                      </td>
                      <td className="py-2 pr-3">
                        <input className={input} value={editing.erpEmployee || ""} onChange={(e) => setEditing({ ...editing, erpEmployee: e.target.value })} placeholder="HR-EMP-00012" />
                      </td>
                      <td className="py-2 pr-3">
                        <select className={input} value={editing.fieldRole === null ? "" : String(editing.fieldRole)} onChange={(e) => setEditing({ ...editing, fieldRole: e.target.value === "" ? null : e.target.value === "true" })}>
                          <option value="">Auto</option>
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <div className="flex gap-2">
                          <Button size="sm" onClick={save}>
                            Save
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 pr-3">
                        <div className="font-semibold text-navy">{s.name}</div>
                        <div className="text-xs text-slate-400">
                          {s.outlet} · {s.role}
                          {!s.hasLogin && " · no login yet"}
                        </div>
                      </td>
                      <td className="py-2 pr-3">{s.reportsTo ? byId.get(s.reportsTo)?.name || "–" : <span className="text-amber-700">Not set</span>}</td>
                      <td className="py-2 pr-3 text-slate-600">{s.erpUser || "–"}</td>
                      <td className="py-2 pr-3 text-slate-600">{s.erpSalesPerson || "–"}</td>
                      <td className="py-2 pr-3 text-slate-600">{s.erpEmployee || "–"}</td>
                      <td className="py-2 pr-3 text-slate-600">{s.fieldRole === null ? "Auto" : s.fieldRole ? "Yes" : "No"}</td>
                      <td className="py-2">
                        {data.canManage && (
                          <Button size="sm" variant="secondary" onClick={() => setEditing({ ...s })}>
                            Edit
                          </Button>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

const EMPTY_TEMPLATE = { title: "", role: "", cluster: "", sop_code: "", step_no: "", frequency: "daily", weekday: 1, month_day: 1, due_time: "", source: "manual", auto_rule_id: "", target_qty: "", how_to: "", record: "", sop_url: "", active: true, sort_order: 0 };

function TemplatesTab({ data, reload }) {
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState(null);
  const rules = new Map(data.rules.map((r) => [r.id, r]));

  async function save() {
    setMsg(null);
    try {
      await postAction({ action: "save_template", template: editing });
      setMsg({ ok: true, text: "Saved. New and changed tasks apply from tomorrow's 05:00 plan." });
      setEditing(null);
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  return (
    <Panel
      title="Task templates (role cards)"
      subtitle="Each active template becomes a task for everyone in its role or cluster on the days it's due. Leave role and cluster empty for everyone."
      action={data.canManage && !editing ? <Button size="sm" onClick={() => setEditing({ ...EMPTY_TEMPLATE })}>Add task</Button> : null}
    >
      <div className="flex flex-col gap-3">
        <Notice msg={msg} />
        {editing && (
          <div className="border border-navy/20 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50">
            <Field title="Title" className="sm:col-span-2">
              <input className={input} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </Field>
            <Field title="SOP code / step">
              <div className="flex gap-2">
                <input className={input} value={editing.sop_code || ""} onChange={(e) => setEditing({ ...editing, sop_code: e.target.value })} placeholder="SOP-SAL-02" />
                <input className={input + " w-20"} value={editing.step_no ?? ""} onChange={(e) => setEditing({ ...editing, step_no: e.target.value })} placeholder="Step" />
              </div>
            </Field>
            <Field title="Cluster">
              <select className={input} value={editing.cluster || ""} onChange={(e) => setEditing({ ...editing, cluster: e.target.value })}>
                <option value="">Any</option>
                {data.clusters.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field title="Role (exact, optional)">
              <input className={input} value={editing.role || ""} onChange={(e) => setEditing({ ...editing, role: e.target.value })} placeholder="e.g. Store Manager" />
            </Field>
            <Field title="Due time">
              <input className={input} type="time" value={(editing.due_time || "").slice(0, 5)} onChange={(e) => setEditing({ ...editing, due_time: e.target.value })} />
            </Field>
            <Field title="Frequency">
              <select className={input} value={editing.frequency} onChange={(e) => setEditing({ ...editing, frequency: e.target.value })}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="on_event">On event</option>
              </select>
            </Field>
            {editing.frequency === "weekly" && (
              <Field title="Weekday">
                <select className={input} value={editing.weekday ?? 1} onChange={(e) => setEditing({ ...editing, weekday: Number(e.target.value) })}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {editing.frequency === "monthly" && (
              <Field title="Day of month">
                <input className={input} type="number" min={1} max={31} value={editing.month_day ?? 1} onChange={(e) => setEditing({ ...editing, month_day: Number(e.target.value) })} />
              </Field>
            )}
            <Field title="Who ticks it">
              <select className={input} value={editing.source} onChange={(e) => setEditing({ ...editing, source: e.target.value })}>
                <option value="manual">You tick (manual)</option>
                <option value="auto">From ERPNext (auto)</option>
              </select>
            </Field>
            {editing.source === "auto" && (
              <Field title="Auto-tick rule">
                <select className={input} value={editing.auto_rule_id || ""} onChange={(e) => setEditing({ ...editing, auto_rule_id: e.target.value })}>
                  <option value="">Choose</option>
                  {data.rules.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field title="Target (optional)">
              <input className={input} value={editing.target_qty ?? ""} onChange={(e) => setEditing({ ...editing, target_qty: e.target.value })} placeholder="e.g. 6" />
            </Field>
            <Field title="What must be recorded">
              <input className={input} value={editing.record || ""} onChange={(e) => setEditing({ ...editing, record: e.target.value })} placeholder="Visit log / F01" />
            </Field>
            <Field title="Playbook link (https)" className="sm:col-span-2">
              <input className={input} value={editing.sop_url || ""} onChange={(e) => setEditing({ ...editing, sop_url: e.target.value })} />
            </Field>
            <Field title="How to do it (SOP step text)" className="sm:col-span-3">
              <textarea className={input + " h-24 py-2"} value={editing.how_to || ""} onChange={(e) => setEditing({ ...editing, how_to: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.active !== false} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active
            </label>
            <div className="sm:col-span-3 flex gap-2">
              <Button onClick={save}>Save task</Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <div className="divide-y divide-slate-100">
          {data.templates.map((t) => (
            <div key={t.id} className="py-3 flex items-start justify-between gap-3">
              <div>
                <div className={"font-semibold " + (t.active ? "text-navy" : "text-slate-400 line-through")}>{t.title}</div>
                <div className="text-xs text-slate-500">
                  {[t.cluster || t.role || "Everyone", t.frequency === "weekly" ? "Weekly, " + WEEKDAYS[t.weekday] : t.frequency === "monthly" ? "Monthly, day " + t.month_day : t.frequency === "daily" ? "Daily" : "On event", t.due_time ? "due " + t.due_time.slice(0, 5) : null, t.sop_code, t.source === "auto" ? "Auto: " + (rules.get(t.auto_rule_id)?.label || "rule missing") : "Manual", t.target_qty ? "target " + Number(t.target_qty) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              {data.canManage && (
                <Button size="sm" variant="secondary" onClick={() => setEditing({ ...t })}>
                  Edit
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

const EMPTY_RULE = { key: "", label: "", source: "erp", doctype_name: "", user_field: "owner", user_ref: "erp_user", date_field: "posting_date", conditions: '[["docstatus","=",1]]', measure: "count", measure_field: "", done_when: "gte_target", compliant_conditions: "[]", active: true };

function RulesTab({ data, reload }) {
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState(null);

  async function save() {
    setMsg(null);
    try {
      await postAction({ action: "save_rule", rule: editing });
      setMsg({ ok: true, text: "Rule saved. It's used from the next 15-minute check." });
      setEditing(null);
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }

  const edit = (r) => setEditing({ ...r, conditions: JSON.stringify(r.conditions || []), compliant_conditions: JSON.stringify(r.compliant_conditions || []) });

  return (
    <Panel
      title="Auto-tick rules"
      subtitle="How a task ticks itself. ERPNext rules are read-only queries: VetXpress never writes to ERPNext. The ERPNext API user needs read access to each DocType used here."
      action={data.canManage && !editing ? <Button size="sm" onClick={() => setEditing({ ...EMPTY_RULE })}>Add rule</Button> : null}
    >
      <div className="flex flex-col gap-3">
        <Notice msg={msg} />
        {editing && (
          <div className="border border-navy/20 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50">
            <Field title="Key (unique, lower_case)">
              <input className={input} value={editing.key} onChange={(e) => setEditing({ ...editing, key: e.target.value })} />
            </Field>
            <Field title="Label" className="sm:col-span-2">
              <input className={input} value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
            </Field>
            <Field title="Counts from">
              <select className={input} value={editing.source} onChange={(e) => setEditing({ ...editing, source: e.target.value })}>
                <option value="erp">ERPNext (read-only)</option>
                <option value="visits">Visits logged in the app</option>
                <option value="productive_visits">Productive visits</option>
                <option value="daily_report">Daily report sent</option>
              </select>
            </Field>
            {editing.source === "erp" && (
              <>
                <Field title="DocType">
                  <input className={input} value={editing.doctype_name || ""} onChange={(e) => setEditing({ ...editing, doctype_name: e.target.value })} placeholder="Payment Entry" />
                </Field>
                <Field title="Date field">
                  <input className={input} value={editing.date_field || ""} onChange={(e) => setEditing({ ...editing, date_field: e.target.value })} placeholder="posting_date" />
                </Field>
                <Field title="Employee field">
                  <input className={input} value={editing.user_field || ""} onChange={(e) => setEditing({ ...editing, user_field: e.target.value })} placeholder="owner or Sales Team.sales_person" />
                </Field>
                <Field title="Match against">
                  <select className={input} value={editing.user_ref || ""} onChange={(e) => setEditing({ ...editing, user_ref: e.target.value })}>
                    <option value="erp_user">ERPNext user</option>
                    <option value="erp_sales_person">Sales Person</option>
                    <option value="erp_employee">Employee</option>
                  </select>
                </Field>
                <Field title="Conditions (JSON filters)" className="sm:col-span-3">
                  <input className={input + " font-mono"} value={editing.conditions} onChange={(e) => setEditing({ ...editing, conditions: e.target.value })} />
                </Field>
              </>
            )}
            <Field title="Measure">
              <select className={input} value={editing.measure} onChange={(e) => setEditing({ ...editing, measure: e.target.value })}>
                <option value="count">Count</option>
                <option value="sum">Sum of a field</option>
              </select>
            </Field>
            {editing.measure === "sum" && (
              <Field title="Field to add up">
                <input className={input} value={editing.measure_field || ""} onChange={(e) => setEditing({ ...editing, measure_field: e.target.value })} placeholder="paid_amount" />
              </Field>
            )}
            <Field title="Done when">
              <select className={input} value={editing.done_when} onChange={(e) => setEditing({ ...editing, done_when: e.target.value })}>
                <option value="gte_target">Measure ≥ target</option>
                <option value="gte_1">At least one</option>
                <option value="all_compliant">Every record matches the filters below</option>
              </select>
            </Field>
            {editing.done_when === "all_compliant" && (
              <Field title="Every record must also match (JSON filters)" className="sm:col-span-3">
                <input className={input + " font-mono"} value={editing.compliant_conditions} onChange={(e) => setEditing({ ...editing, compliant_conditions: e.target.value })} />
              </Field>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.active !== false} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active
            </label>
            <div className="sm:col-span-3 flex gap-2">
              <Button onClick={save}>Save rule</Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <div className="divide-y divide-slate-100">
          {data.rules.map((r) => (
            <div key={r.id} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={"font-semibold " + (r.active ? "text-navy" : "text-slate-400")}>{r.label}</div>
                <div className="text-xs text-slate-500 break-all">
                  <code>{r.key}</code> · {r.source === "erp" ? r.doctype_name + " where " + r.user_field + " = " + r.user_ref.replace("erp_", "") + ", by " + r.date_field + " · " + JSON.stringify(r.conditions) : r.source.replace("_", " ")} · {r.measure === "sum" ? "sum of " + r.measure_field : "count"} · {r.done_when.replace(/_/g, " ")}
                </div>
              </div>
              {data.canManage && (
                <Button size="sm" variant="secondary" onClick={() => edit(r)}>
                  Edit
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function ScorecardsTab({ data, reload }) {
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState(null);
  const total = editing ? editing.kpis.reduce((s, k) => s + (Number(k.weight) || 0), 0) : 0;

  async function save() {
    setMsg(null);
    try {
      await postAction({ action: "save_scorecard", scorecard: editing });
      setMsg({ ok: true, text: "Scorecard saved. Scores rebuild tonight, or use Months & scores → Rebuild now." });
      setEditing(null);
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  }
  const setKpi = (i, patch) => setEditing((e) => ({ ...e, kpis: e.kpis.map((k, j) => (j === i ? { ...k, ...patch } : k)) }));

  return (
    <Panel
      title="Scorecards (Playbook section 17)"
      subtitle="KPIs and weights per role or cluster. People without a scorecard keep their existing Performance System formula, so nobody's score disappears while scorecards roll out."
      action={data.canManage && !editing ? <Button size="sm" onClick={() => setEditing({ name: "", role: "", cluster: "", active: true, kpis: [{ key: "", kpi: "", weight: 100, target: "", rule_key: "manual", target_field: "", higher_is_better: true }] })}>Add scorecard</Button> : null}
    >
      <div className="flex flex-col gap-3">
        <Notice msg={msg} />
        {editing && (
          <div className="border border-navy/20 rounded-xl p-4 flex flex-col gap-3 bg-slate-50">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field title="Name">
                <input className={input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field title="Cluster">
                <select className={input} value={editing.cluster || ""} onChange={(e) => setEditing({ ...editing, cluster: e.target.value })}>
                  <option value="">Choose</option>
                  {data.clusters.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field title="Or exact role (overrides cluster)">
                <input className={input} value={editing.role || ""} onChange={(e) => setEditing({ ...editing, role: e.target.value })} />
              </Field>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400">
                    <th className="pr-2 py-1">Key</th>
                    <th className="pr-2 py-1">KPI</th>
                    <th className="pr-2 py-1">Weight</th>
                    <th className="pr-2 py-1">Target</th>
                    <th className="pr-2 py-1">Personal target field</th>
                    <th className="pr-2 py-1">Actual comes from</th>
                    <th className="pr-2 py-1">Higher is better</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {editing.kpis.map((k, i) => (
                    <tr key={i}>
                      <td className="pr-2 py-1">
                        <input className={input + " w-28"} value={k.key} onChange={(e) => setKpi(i, { key: e.target.value })} />
                      </td>
                      <td className="pr-2 py-1">
                        <input className={input + " min-w-44"} value={k.kpi} onChange={(e) => setKpi(i, { kpi: e.target.value })} />
                      </td>
                      <td className="pr-2 py-1">
                        <input className={input + " w-20"} value={k.weight} onChange={(e) => setKpi(i, { weight: e.target.value })} />
                      </td>
                      <td className="pr-2 py-1">
                        <input className={input + " w-28"} value={k.target} onChange={(e) => setKpi(i, { target: e.target.value })} />
                      </td>
                      <td className="pr-2 py-1">
                        <input className={input + " w-36"} value={k.target_field || ""} onChange={(e) => setKpi(i, { target_field: e.target.value })} placeholder="revenueTarget" />
                      </td>
                      <td className="pr-2 py-1">
                        <select className={input + " min-w-44"} value={k.rule_key} onChange={(e) => setKpi(i, { rule_key: e.target.value })}>
                          <option value="manual">Entered by HR (manual)</option>
                          <option value="team_average">Team average score</option>
                          <option value="collections_ratio">Collections ÷ sales (%)</option>
                          {data.rules.map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="pr-2 py-1 text-center">
                        <input type="checkbox" checked={k.higher_is_better !== false} onChange={(e) => setKpi(i, { higher_is_better: e.target.checked })} />
                      </td>
                      <td className="py-1">
                        <button type="button" className="text-red-600 text-xs font-semibold" onClick={() => setEditing((e) => ({ ...e, kpis: e.kpis.filter((_, j) => j !== i) }))}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Button size="sm" variant="secondary" onClick={() => setEditing((e) => ({ ...e, kpis: [...e.kpis, { key: "", kpi: "", weight: 0, target: "", rule_key: "manual", target_field: "", higher_is_better: true }] }))}>
                Add KPI
              </Button>
              <span className={"text-sm font-semibold " + (Math.abs(total - 100) < 0.001 ? "text-[#1a8f4c]" : "text-red-700")}>Weights total {total} / 100</span>
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={Math.abs(total - 100) > 0.001}>
                Save scorecard
              </Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {data.scorecards.map((c) => (
          <div key={c.id} className="border border-slate-100 rounded-xl p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-navy">{c.name}</div>
                <div className="text-xs text-slate-500">{c.role ? "Role: " + c.role : "Cluster: " + c.cluster}{c.active ? "" : " · inactive"}</div>
              </div>
              {data.canManage && (
                <Button size="sm" variant="secondary" onClick={() => setEditing({ ...c, kpis: c.kpis.map((k) => ({ ...k })) })}>
                  Edit
                </Button>
              )}
            </div>
            <ul className="mt-2 text-sm text-slate-600 grid sm:grid-cols-2 gap-x-6">
              {c.kpis.map((k) => (
                <li key={k.key}>
                  {k.kpi} · <b>{k.weight}</b> · target {k.rule_key === "team_average" ? "team" : Number(k.target).toLocaleString("en-NG")}
                  {k.target_field ? " (or personal " + k.target_field + ")" : ""}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function MonthsTab({ data, month, setMonth, reload }) {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [correcting, setCorrecting] = useState(null);
  const [manual, setManual] = useState(null);
  const m = data.months.find((x) => x.month === month) || { status: "live", phase: "live", label: month };
  const manualKpis = data.scorecards.flatMap((c) => c.kpis.filter((k) => k.rule_key === "manual").map((k) => ({ ...k, card: c })));

  async function act(body, ok) {
    setBusy(true);
    setMsg(null);
    try {
      await postAction(body);
      setMsg({ ok: true, text: ok });
      reload();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Month" subtitle="Scores rebuild nightly while a month is open. Day 3: missing figures and ratings are flagged. Day 5: the month locks and missing figures count as zero.">
        <div className="flex flex-wrap items-end gap-3">
          <Field title="Month">
            <select className={input} value={month} onChange={(e) => setMonth(e.target.value)}>
              {data.months.map((x) => (
                <option key={x.month} value={x.month}>
                  {x.label} ({x.status})
                </option>
              ))}
            </select>
          </Field>
          {data.canManage && m.status !== "locked" && (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => act({ action: "rebuild_scores", month }, "Scores rebuilt.")}>
                Rebuild now
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => window.confirm("Lock " + m.label + "? Scores and ratings freeze and missing figures count as zero. This can't be undone.") && act({ action: "lock_month", month }, m.label + " locked.")}>
                Lock month
              </Button>
            </>
          )}
          {data.canExport && (
            <>
              <a className="border border-slate-300 text-navy font-bold rounded-xl px-4 h-11 text-sm flex items-center hover:border-navy/50 hover:bg-navy/5" href={"/api/admin/export?format=xlsx&month=" + month}>
                Export Excel
              </a>
              <a className="border border-slate-300 text-navy font-bold rounded-xl px-4 h-11 text-sm flex items-center hover:border-navy/50 hover:bg-navy/5" href={"/api/admin/export?format=csv&month=" + month}>
                Export CSV
              </a>
            </>
          )}
          {data.canManage && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act({ action: "run_job", job: "build_day_plans" }, "Today's day plans built.")}>
              Build today&apos;s tasks now
            </Button>
          )}
        </div>
        <div className="mt-3">
          <Notice msg={msg} />
        </div>
      </Panel>

      <Panel title={"Scores · " + m.label} subtitle="Verified = Internal Audit spot-check done (SOP-PPL-06). Corrections need a reason and are kept in the audit trail below.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-2 pr-3">Person</th>
                <th className="py-2 pr-3">Score</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">Care / Dare / Conduct / Team</th>
                <th className="py-2 pr-3">Dare pts</th>
                <th className="py-2 pr-3">Verified</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.scores.map((r) => (
                <tr key={r.staffId} className="border-t border-slate-100">
                  <td className="py-2 pr-3">
                    <div className="font-semibold text-navy">{r.name}</div>
                    <div className="text-xs text-slate-400">
                      {r.outlet} · {r.role}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <span className={"text-xs font-semibold rounded-full px-2.5 py-1 " + BAND_CLASS[r.band]}>
                      {r.score === null ? "No data" : r.score + " " + r.band}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-slate-500 text-xs">{r.source === "scorecard" ? "Scorecard" : r.source === "cluster" ? "Cluster formula" : "–"}</td>
                  <td className="py-2 pr-3 text-slate-600">{r.care ? [r.care, r.dare, r.conduct, r.teamwork].join(" / ") : <span className="text-slate-400">Not rated</span>}</td>
                  <td className="py-2 pr-3">{r.darePoints}</td>
                  <td className="py-2 pr-3">
                    <input type="checkbox" disabled={!data.canManage || r.score === null} checked={r.verified} onChange={(e) => act({ action: "set_verified", staffId: r.staffId, month, verified: e.target.checked }, "Saved.")} aria-label={"Verified " + r.name} />
                  </td>
                  <td className="py-2">
                    {data.canManage && r.score !== null && (
                      <Button size="sm" variant="secondary" onClick={() => setCorrecting({ staffId: r.staffId, name: r.name, newScore: r.score, reason: "" })}>
                        Correct
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {correcting && (
          <div className="mt-3 border border-navy/20 rounded-xl p-4 bg-slate-50 grid sm:grid-cols-4 gap-3 items-end">
            <div className="font-semibold text-navy sm:col-span-4">Correct {correcting.name}&apos;s score</div>
            <Field title="New score (0–100)">
              <input className={input} value={correcting.newScore} onChange={(e) => setCorrecting({ ...correcting, newScore: e.target.value })} />
            </Field>
            <Field title="Reason (required)" className="sm:col-span-2">
              <input className={input} value={correcting.reason} onChange={(e) => setCorrecting({ ...correcting, reason: e.target.value })} />
            </Field>
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  await act({ action: "correct_score", staffId: correcting.staffId, month, newScore: correcting.newScore, reason: correcting.reason }, "Score corrected.");
                  setCorrecting(null);
                }}
              >
                Save
              </Button>
              <Button variant="secondary" onClick={() => setCorrecting(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {manualKpis.length > 0 && m.status !== "locked" && (
        <Panel title="Manual KPI actuals" subtitle="For scorecard KPIs ERPNext doesn't record yet (marked 'Entered by HR').">
          <div className="grid sm:grid-cols-5 gap-3 items-end">
            <Field title="Person">
              <select className={input} value={manual?.staffId || ""} onChange={(e) => setManual({ ...(manual || {}), staffId: e.target.value })}>
                <option value="">Choose</option>
                {data.staff
                  .filter((s) => s.active)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field title="KPI">
              <select className={input} value={manual?.kpiKey || ""} onChange={(e) => setManual({ ...(manual || {}), kpiKey: e.target.value })}>
                <option value="">Choose</option>
                {manualKpis.map((k) => (
                  <option key={k.card.id + k.key} value={k.key}>
                    {k.kpi} ({k.card.name})
                  </option>
                ))}
              </select>
            </Field>
            <Field title="Actual">
              <input className={input} value={manual?.actual ?? ""} onChange={(e) => setManual({ ...(manual || {}), actual: e.target.value })} />
            </Field>
            <Button disabled={!data.canManage || busy || !manual?.staffId || !manual?.kpiKey} onClick={() => act({ action: "set_manual_actual", month, ...manual }, "Saved. Rebuild to see it in the score.")}>
              Save actual
            </Button>
          </div>
          {data.manual.length > 0 && (
            <ul className="mt-3 text-sm text-slate-600">
              {data.manual.map((x) => (
                <li key={x.staff_id + x.kpi_key}>
                  {data.staff.find((s) => s.id === x.staff_id)?.name} · {x.kpi_key}: <b>{Number(x.actual).toLocaleString("en-NG")}</b> <span className="text-slate-400">({x.entered_by})</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {data.corrections.length > 0 && (
        <Panel title="Corrections (audit trail)">
          <ul className="text-sm text-slate-600 divide-y divide-slate-100">
            {data.corrections.map((c) => (
              <li key={c.id} className="py-2">
                {data.staff.find((s) => s.id === c.staff_id)?.name}: {c.old_score ?? "–"} → <b>{c.new_score}</b> · {c.reason} <span className="text-slate-400">({c.corrected_by}, {new Date(c.created_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })})</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function IdeasTab({ data }) {
  const [kind, setKind] = useState("");
  const list = data.ideas.filter((i) => !kind || i.kind === kind);
  return (
    <Panel title="Ideas register (SOP-GRO-01)" subtitle="Every idea, its status and the reason given. Decisions are made in the app: line managers for improvement ideas, the VP Sales & Marketing for growth ideas.">
      <div className="flex gap-2 mb-3">
        {[
          ["", "All"],
          ["improvement", "Improvement"],
          ["growth", "Growth"],
        ].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={"rounded-full px-3 h-9 text-sm font-semibold border " + (kind === k ? "bg-navy text-white border-navy" : "bg-white text-navy border-slate-200")}>
            {l}
          </button>
        ))}
      </div>
      <div className="divide-y divide-slate-100">
        {list.length === 0 && <p className="text-slate-400 text-sm py-3">No ideas yet.</p>}
        {list.map((i) => (
          <div key={i.id} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-navy">{i.title}</div>
                <div className="text-xs text-slate-500">
                  {i.owner?.name} · {i.owner?.centre} · {i.kind === "growth" ? "Growth" : "Improvement"} · {new Date(i.createdAt).toLocaleDateString("en-GB")}
                  {i.ideaOfMonth ? " · Idea of the Month " + i.ideaOfMonth : ""}
                </div>
              </div>
              <span className="text-xs font-semibold rounded-full px-2.5 py-1 bg-slate-100 text-slate-600 whitespace-nowrap">{i.statusLabel}</span>
            </div>
            {i.reason && (
              <p className="text-sm text-slate-600 mt-1">
                <b>{i.decidedBy}:</b> {i.reason}
              </p>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
