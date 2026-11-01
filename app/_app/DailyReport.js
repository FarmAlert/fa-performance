"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "./useData";
import { enqueue, uuid, saveLocalDraft, loadLocalDraft, formatClock } from "./client";
import { Icon, TopBar, Sheet, Skeleton, ErrorBox, Tag, naira, prettyDate } from "./ui";

// Screen 05 — Daily report (spec 8.3). Figures fill from ERPNext and stay
// live until confirmed; each task not done needs a reason; notes are free
// text. The draft is kept on the phone as you type. "Confirm and send"
// shows what will happen first (spec 8.2), then locks the report — late if
// after 6:00pm, and it still sends.

function fig(f) {
  if (f.value === null || f.value === undefined) return "–";
  return f.money ? naira(f.value) : String(f.value) + (f.target ? " of " + f.target : "");
}

export default function DailyReport({ back, onAuthError, markOffline, showToast, me }) {
  const { data, loading, error, fromCache, cachedAt, setData } = useData("daily_report", {}, { onAuthError });
  const [notes, setNotes] = useState("");
  const [reasons, setReasons] = useState({});
  const [confirm, setConfirm] = useState(false);
  const [formError, setFormError] = useState("");
  const loadedDraft = useRef(false);

  useEffect(() => {
    if (data) markOffline(fromCache, cachedAt);
  }, [data, fromCache, cachedAt, markOffline]);

  useEffect(() => {
    if (!data || loadedDraft.current) return;
    loadedDraft.current = true;
    loadLocalDraft(data.date).then((d) => {
      const server = data.report || {};
      setNotes(d?.notes ?? server.notes ?? "");
      setReasons({ ...(server.reasons || {}), ...(d?.reasons || {}) });
    });
  }, [data]);

  useEffect(() => {
    if (!data || !loadedDraft.current) return undefined;
    const t = setTimeout(() => saveLocalDraft(data.date, { notes, reasons }), 400);
    return () => clearTimeout(t);
  }, [notes, reasons, data]);

  const sent = data?.report && data.report.status !== "draft";
  const notDone = (data?.tasks || []).filter((t) => t.status !== "done");
  const missing = notDone.filter((t) => !(reasons[t.id] || t.reason || "").trim());

  function openConfirm() {
    setFormError("");
    if (missing.length) {
      setFormError("Give a reason for each task not done.");
      return;
    }
    setConfirm(true);
  }

  async function send() {
    setConfirm(false);
    const late = data.lateIfSentNow;
    await enqueue("send_daily_report", { client_id: uuid(), date: data.date, notes, reasons }, { label: "your daily report" });
    const at = new Date().toISOString();
    setData((d) => ({ ...d, report: { status: late ? "late" : "sent", sentAt: at, notes, reasons, figures: d.figures } }));
    showToast(late ? "Report sent (late)" : "Report sent. Your supervisor can see it now.");
  }

  return (
    <>
      <TopBar title="Daily report" sub={data ? prettyDate(data.date) + " · due by " + data.dueLabel : ""} onBack={me.isSupervisor ? back : undefined} />
      <main className="pa-main">
        {loading && !data && <Skeleton rows={4} />}
        <ErrorBox>{!data && error}</ErrorBox>
        {data && (
          <>
            {sent ? (
              <div className={"pa-banner " + (data.report.status === "late" ? "" : "ok")} role="status">
                <Icon name="check" />
                <div>
                  <b>{data.report.status === "late" ? "Sent late" : "Report sent"}</b>
                  {data.report.sentAt ? "Confirmed at " + formatClock(data.report.sentAt) + "." : ""} Your supervisor can see it.
                </div>
              </div>
            ) : data.lateIfSentNow ? (
              <div className="pa-banner">
                <Icon name="bell" stroke="#92400E" />
                <div>
                  <b>It&apos;s after 6:00pm</b>You can still send it. It will be marked late.
                </div>
              </div>
            ) : null}

            <div className="pa-card pad">
              <div className="pa-between" style={{ marginBottom: 10 }}>
                <div className="pa-h2">Today&apos;s figures</div>
                <Tag kind="erp">{sent ? "As sent" : "Live from ERPNext"}</Tag>
              </div>
              {data.figures.length === 0 ? (
                <div className="pa-muted">No figures for your role yet.</div>
              ) : (
                <div className="pa-figs">
                  {data.figures.map((f, i) => (
                    <div key={f.key} className={"pa-fig" + (data.figures.length % 2 === 1 && i === data.figures.length - 1 ? " wide" : "")}>
                      <b>{fig(f)}</b>
                      <span>{f.label}</span>
                      {f.note && (
                        <span style={{ display: "block", fontSize: 11 }}>
                          {f.note}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pa-card pad">
              <div className="pa-between" style={{ marginBottom: 6 }}>
                <div className="pa-h2">Tasks</div>
                <span className="pa-muted">
                  {data.done} of {data.total} done
                </span>
              </div>
              <div className="pa-list">
                {data.tasks.map((t) => (
                  <div key={t.id} style={{ padding: "10px 0", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className="pa-row" style={{ alignItems: "flex-start" }}>
                      <span className={"pa-check" + (t.status === "done" ? " on" : " no")} style={{ width: 22, height: 22, cursor: "default" }} aria-hidden="true">
                        <Icon name={t.status === "done" ? "check" : "x"} size={13} width={3} />
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700 }}>{t.title}</div>
                        {t.progressLabel && <div className="pa-muted">{t.progressLabel}</div>}
                      </div>
                    </div>
                    {t.status !== "done" &&
                      (sent ? (
                        <div className="pa-muted" style={{ paddingLeft: 32 }}>
                          Reason: {reasons[t.id] || t.reason || "–"}
                        </div>
                      ) : (
                        <select
                          className="pa-select"
                          aria-label={"Reason " + t.title + " wasn't done"}
                          value={reasons[t.id] || t.reason || ""}
                          onChange={(e) => setReasons((r) => ({ ...r, [t.id]: e.target.value }))}
                          style={!(reasons[t.id] || t.reason) ? { borderColor: "#f3b4b4" } : undefined}
                        >
                          <option value="">Choose a reason (required)</option>
                          {me.reasons.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                          <option value="Other: see notes">Other (explain in notes)</option>
                          {t.reason && !me.reasons.includes(t.reason) && <option value={t.reason}>{t.reason}</option>}
                        </select>
                      ))}
                  </div>
                ))}
                {data.tasks.length === 0 && <div className="pa-muted" style={{ padding: "8px 0" }}>No tasks today.</div>}
              </div>
            </div>

            <label className="pa-field">
              <span className="pa-label">Notes, problems and stock-outs</span>
              {sent ? (
                <div className="pa-card">{data.report.notes || <span className="pa-muted">No notes.</span>}</div>
              ) : (
                <textarea className="pa-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything your supervisor should know today" maxLength={4000} />
              )}
            </label>
            <ErrorBox>{formError}</ErrorBox>
            {!sent && (
              <button type="button" className="pa-btn green" onClick={openConfirm} style={{ marginTop: 4 }}>
                Confirm and send report
              </button>
            )}
          </>
        )}
      </main>

      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Send today's report?">
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, color: "var(--muted)" }}>
          <li>The report locks and can&apos;t be edited.</li>
          <li>Your supervisor sees it straight away.</li>
          <li>&quot;Send daily report&quot; ticks itself.</li>
          {data?.lateIfSentNow && <li style={{ color: "var(--band-amber-fg)", fontWeight: 700 }}>It&apos;s after 6:00pm, so it will be marked late.</li>}
        </ul>
        <button type="button" className="pa-btn green" onClick={send}>
          Confirm and send
        </button>
        <button type="button" className="pa-btn ghost" onClick={() => setConfirm(false)}>
          Not yet
        </button>
      </Sheet>
    </>
  );
}
