"use client";

import { useEffect, useState } from "react";
import { useData } from "./useData";
import { enqueue, post, uuid } from "./client";
import { Icon, ScorePill, Tag, Empty, Skeleton, ErrorBox, greeting, prettyDate } from "./ui";

// Screen 02 — My day (spec 8.3). Header with live score and colour,
// progress, the reminder banner (overdue first, then next due), To do and
// Done in due-time order. FROM ERPNEXT tasks tick themselves (dashed box,
// not tappable); YOU TICK tasks are tapped. Ticks go through the offline
// queue, so they work with no signal and sync later.

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function PushCard({ me, showToast }) {
  const [state, setState] = useState("hidden");
  useEffect(() => {
    if (!me.pushKey || typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Notification.permission === "default") setState("ask");
    else if (Notification.permission === "granted") {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription().then((sub) => sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(me.pushKey) })))
        .then((sub) => sub && post("register_device", { ...sub.toJSON(), platform: "web" }))
        .catch(() => {});
    }
  }, [me.pushKey]);
  if (state !== "ask") return null;

  async function enable() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState("hidden");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(me.pushKey) });
      await post("register_device", { ...sub.toJSON(), platform: "web" });
      setState("hidden");
      showToast("Reminders are on");
    } catch {
      setState("hidden");
    }
  }

  return (
    <div className="pa-banner info">
      <Icon name="bell" />
      <div style={{ flex: 1 }}>
        <b>Turn on reminders</b>
        Get a nudge before tasks are due and when your report is due. Never between 8pm and 7am.
        <div style={{ marginTop: 8 }}>
          <button type="button" className="pa-btn sm" onClick={enable}>
            Turn on
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskCard({ t, onOpen, onTick }) {
  const auto = t.source === "auto";
  const done = t.status === "done";
  const notDone = t.status === "not_done";
  const pct = t.target ? Math.min(100, Math.round(((t.progress || 0) / t.target) * 100)) : null;
  const meta = [];
  if (done && t.doneAt) meta.push("Done " + new Date(t.doneAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) + (t.doneBy === "auto" ? " · ticked from ERPNext" : ""));
  else if (auto && t.progressLabel) meta.push(t.progressLabel);
  if (!done && t.dueLabel) meta.push((auto && t.progressLabel ? "by " : "Due ") + t.dueLabel);
  if (t.sop) meta.push(t.sop);

  return (
    <div className={"pa-card pa-task" + (done ? " done" : "") + (t.overdue ? " alert" : "")} style={t.overdue ? { borderColor: "#f3b4b4" } : undefined}>
      {auto ? (
        <span className={"pa-check auto" + (done ? " on" : "")} aria-label={done ? "Done, ticked from ERPNext" : "Ticks itself from ERPNext"} role="img">
          {done && <Icon name="check" size={16} width={3} />}
        </span>
      ) : (
        <button type="button" className="pa-check-hit" onClick={() => onTick(t)} aria-label={done ? "Mark " + t.title + " as not done yet" : "Mark " + t.title + " done"} aria-pressed={done}>
          <span className={"pa-check" + (done ? " on" : notDone ? " no" : "")}>
            {done && <Icon name="check" size={16} width={3} />}
            {notDone && <Icon name="x" size={14} width={3} />}
          </span>
        </button>
      )}
      <button type="button" onClick={() => onOpen(t)} style={{ flex: 1, minWidth: 0, background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer" }}>
        <div className="pa-task-title">{t.title}</div>
        {meta.length > 0 && <div className="pa-task-meta">{meta.join(" · ")}</div>}
        {notDone && t.reason && <div className="pa-task-meta">Not done: {t.reason}</div>}
        {auto && !done && pct !== null && (
          <div className="pa-progress thin" style={{ marginTop: 8 }}>
            <span style={{ width: pct + "%" }} />
          </div>
        )}
        {!done && (
          <div className="pa-tags">
            {auto ? <Tag kind="erp">From ERPNext</Tag> : <Tag>You tick</Tag>}
            {t.overdue && <Tag kind="red">Overdue</Tag>}
            {t.autoNote && <Tag kind="grey">Waiting for ERPNext link</Tag>}
          </div>
        )}
      </button>
    </div>
  );
}

export default function MyDay({ me, go, onAuthError, markOffline, showToast, onLogout }) {
  const { data, loading, error, fromCache, cachedAt, reload, setData } = useData("my_day", {}, { onAuthError });
  useEffect(() => {
    if (data) markOffline(fromCache, cachedAt);
  }, [data, fromCache, cachedAt, markOffline]);

  async function tick(t) {
    const next = t.status === "done" ? "open" : "done";
    setData((d) => {
      const tasks = d.tasks.map((x) => (x.id === t.id ? { ...x, status: next, doneAt: next === "done" ? new Date().toISOString() : null, doneBy: next === "done" ? "user" : null, overdue: false } : x));
      return { ...d, tasks, done: tasks.filter((x) => x.status === "done").length };
    });
    await enqueue("mark_task", { client_id: uuid(), task: t.id, status: next }, { label: "a task tick" });
    if (next === "done") showToast("Done: " + t.title);
  }

  async function hqStatus(task, status) {
    try {
      await post("hq_task_status", { task: task.id, status });
      setData((d) => ({ ...d, assigned: d.assigned.filter((a) => status !== "completed" || a.id !== task.id).map((a) => (a.id === task.id ? { ...a, status } : a)) }));
      showToast(status === "completed" ? "Marked complete" : "Marked in progress");
    } catch (err) {
      showToast(err.message === "offline" ? "You're offline. Try again with signal." : err.message);
    }
  }

  const tasks = data?.tasks || [];
  const todo = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");
  const pct = data?.total ? Math.round((data.done / data.total) * 100) : 0;
  const reminder = data?.reminder;

  return (
    <>
      <div className="pa-hero">
        <div className="pa-hero-row">
          <div style={{ minWidth: 0 }}>
            <div className="pa-hero-kicker">{greeting()},</div>
            <div className="pa-hero-title">{me.firstName}</div>
            <div className="pa-hero-sub">{[me.role, me.centre].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="pa-hero-actions">
            <button type="button" className="pa-icon-btn" onClick={() => go("inbox")} aria-label={"Notifications" + (me.unread ? ", " + me.unread + " unread" : "")}>
              <Icon name="bell" />
              {me.unread > 0 && <span className="pa-dot" />}
            </button>
            <button type="button" onClick={() => go("rating")} style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} aria-label="Open my rating">
              <ScorePill score={me.score} band={me.band} />
            </button>
          </div>
        </div>
      </div>

      <main className="pa-main">
        <div className="pa-between">
          <div className="pa-h1">My day</div>
          <div className="pa-row" style={{ gap: 4 }}>
            <span className="pa-muted">
              {data ? prettyDate(data.date) + " · " + data.done + " of " + data.total + " done" : ""}
            </span>
            <button type="button" className="pa-back" style={{ width: 40, height: 40, background: "transparent" }} onClick={() => reload({ refresh: "1" })} aria-label="Refresh">
              <Icon name="refresh" size={18} className={loading ? "pa-spin-icon" : ""} />
            </button>
          </div>
        </div>
        <div className="pa-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Tasks done today">
          <span style={{ width: pct + "%" }} />
        </div>

        <PushCard me={me} showToast={showToast} />

        {reminder && (
          <div className={"pa-banner" + (reminder.kind === "next" ? " info" : "")} role="status">
            <Icon name="bell" stroke={reminder.kind === "next" ? "#0D3B4F" : "#92400E"} />
            <div>
              <b>{reminder.title}</b>
              {reminder.text}
            </div>
          </div>
        )}

        {!me.erpLinked && (
          <div className="pa-banner info">
            <Icon name="shield" />
            <div>
              <b>ERPNext not linked yet</b>
              Tasks marked From ERPNext will tick themselves once HR links your ERPNext user.
            </div>
          </div>
        )}

        {me.isSupervisor && (
          <div className="pa-row" style={{ gap: 8 }}>
            <button type="button" className="pa-btn ghost sm" style={{ flex: 1 }} onClick={() => go("report")}>
              Report
            </button>
            <button type="button" className="pa-btn ghost sm" style={{ flex: 1 }} onClick={() => go("rating")}>
              My rating
            </button>
            <button type="button" className="pa-btn ghost sm" style={{ flex: 1 }} onClick={() => go("ideas")}>
              My ideas
            </button>
          </div>
        )}

        <ErrorBox>{!data && error}</ErrorBox>
        {loading && !data && <Skeleton rows={4} />}

        {data && tasks.length === 0 && (data.assigned || []).length === 0 && (
          <Empty icon="sun" title="No tasks today, enjoy your rest">
            Your tasks appear here each working day from 5:00am.
          </Empty>
        )}

        {todo.length > 0 && <div className="pa-eyebrow">To do</div>}
        {todo.map((t) => (
          <TaskCard key={t.id} t={t} onOpen={(x) => go("task", { id: x.id })} onTick={tick} />
        ))}

        {(data?.assigned || []).length > 0 && <div className="pa-eyebrow">Assigned by HQ</div>}
        {(data?.assigned || []).map((a) => (
          <div key={a.id} className="pa-card" style={a.overdue ? { borderColor: "#f3b4b4" } : undefined}>
            <div className="pa-task-title">{a.title}</div>
            <div className="pa-task-meta">
              {a.dueDate ? "Due " + prettyDate(a.dueDate) : "No due date"}
              {a.priority === "high" ? " · High priority" : ""}
            </div>
            {a.description && <div className="pa-muted" style={{ marginTop: 4 }}>{a.description}</div>}
            <div className="pa-tags">
              <Tag kind={a.status === "in_progress" ? "amber" : ""}>{a.status === "in_progress" ? "In progress" : "Pending"}</Tag>
              {a.overdue && <Tag kind="red">Overdue</Tag>}
            </div>
            <div className="pa-row" style={{ gap: 8, marginTop: 10 }}>
              {a.status === "pending" && (
                <button type="button" className="pa-btn ghost sm" style={{ flex: 1 }} onClick={() => hqStatus(a, "in_progress")}>
                  Start
                </button>
              )}
              <button type="button" className="pa-btn sm" style={{ flex: 1 }} onClick={() => hqStatus(a, "completed")}>
                Mark complete
              </button>
            </div>
          </div>
        ))}

        {done.length > 0 && <div className="pa-eyebrow">Done</div>}
        {done.map((t) => (
          <TaskCard key={t.id} t={t} onOpen={(x) => go("task", { id: x.id })} onTick={tick} />
        ))}

        <div className="pa-row" style={{ justifyContent: "center", gap: 18, marginTop: 12 }}>
          {me.isViewer && (
            <a className="pa-link" href="/admin">
              Admin
            </a>
          )}
          <button type="button" className="pa-link" style={{ color: "var(--muted)" }} onClick={onLogout}>
            Sign out
          </button>
        </div>
      </main>

      {me.isFieldRole && (
        <button type="button" className="pa-fab" onClick={() => go("visit")}>
          <Icon name="plus" width={3} />
          Log a visit
        </button>
      )}
    </>
  );
}
