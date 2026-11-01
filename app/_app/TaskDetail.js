"use client";

import { useEffect, useState } from "react";
import { useData } from "./useData";
import { enqueue, post, uuid } from "./client";
import { Icon, Tag, TopBar, Sheet, Skeleton, ErrorBox, prettyDate } from "./ui";

// Screen 03 — Task detail (spec 8.3): when it's due, what must be recorded,
// linked records with quick actions, the SOP "How to do it" text, and
// either Mark done (YOU TICK) or "Ticks itself when the record is saved in
// ERPNext". "Can't do it" asks for a reason and tells the line manager.
export default function TaskDetail({ me, id, back, onAuthError, markOffline, showToast }) {
  const { data: t, loading, error, fromCache, cachedAt, setData } = useData("task_detail", { name: id }, { onAuthError });
  const [sheet, setSheet] = useState(false);
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (t) markOffline(fromCache, cachedAt);
  }, [t, fromCache, cachedAt, markOffline]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (t?.templateId) setMuted((me.mutedTemplateIds || []).includes(t.templateId));
  }, [t, me]);

  async function mark(status, why) {
    setBusy(true);
    await enqueue("mark_task", { client_id: uuid(), task: t.id, status, reason: why }, { label: "a task update" });
    setData((d) => ({ ...d, status, reason: why || null, doneBy: status === "done" ? "user" : null }));
    setBusy(false);
    setSheet(false);
    showToast(status === "done" ? "Marked done" : "Saved. Your line manager has been told.");
    if (status === "done") back();
  }

  async function toggleMute() {
    try {
      const r = await post("mute_task", { template: t.templateId, muted: !muted });
      setMuted(r.muted);
      showToast(r.muted ? "Reminders muted for this task" : "Reminders on for this task");
    } catch (err) {
      showToast(err.message === "offline" ? "You're offline." : err.message);
    }
  }

  const finalReason = reason === "__other" ? other.trim() : reason;

  return (
    <>
      <TopBar title="Task" sub={t ? prettyDate(t.date) : ""} onBack={back} />
      <main className="pa-main no-nav">
        {loading && !t && <Skeleton rows={3} />}
        <ErrorBox>{!t && error}</ErrorBox>
        {t && (
          <>
            <div className="pa-card pad">
              <div className="pa-h1" style={{ fontSize: 19 }}>
                {t.title}
              </div>
              <div className="pa-tags" style={{ marginTop: 8 }}>
                {t.source === "auto" ? <Tag kind="erp">From ERPNext</Tag> : <Tag>You tick</Tag>}
                {t.overdue && <Tag kind="red">Overdue</Tag>}
                {t.status === "done" && <Tag kind="erp">Done</Tag>}
                {t.status === "not_done" && <Tag kind="red">Not done</Tag>}
                {t.sop && <Tag kind="grey">{t.sop}</Tag>}
              </div>
              <div className="pa-divider" style={{ margin: "12px 0" }} />
              <div className="pa-figs">
                <div className="pa-fig">
                  <span>Due</span>
                  <b style={{ fontSize: 16 }}>{t.dueLabel || "Today"}</b>
                </div>
                <div className="pa-fig">
                  <span>{t.source === "auto" ? "Progress" : "Record"}</span>
                  <b style={{ fontSize: 16 }}>{t.source === "auto" ? t.progressLabel || "Not started" : t.record || "Tick when done"}</b>
                </div>
                {t.source === "auto" && t.record && (
                  <div className="pa-fig wide">
                    <span>What must be recorded</span>
                    <b style={{ fontSize: 15 }}>{t.record}</b>
                  </div>
                )}
              </div>
              {t.autoNote && (
                <p className="pa-help" style={{ marginTop: 10 }}>
                  Can&apos;t check this yet: {t.autoNote}.
                </p>
              )}
              {t.reason && <p className="pa-help" style={{ marginTop: 10 }}>Reason given: {t.reason}</p>}
            </div>

            {t.linked?.length > 0 && (
              <>
                <div className="pa-eyebrow">Linked records</div>
                <div className="pa-card pa-list" style={{ padding: "0 12px" }}>
                  {t.linked.map((l, i) => (
                    <div key={i} className="pa-between" style={{ padding: "11px 0", alignItems: "center" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700 }}>{l.title}</div>
                        <div className="pa-muted">{l.subtitle}</div>
                      </div>
                      {l.phone && (
                        <a className="pa-back" href={"tel:" + l.phone} aria-label={"Call " + l.title}>
                          <Icon name="phone" size={18} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {t.howTo && (
              <>
                <div className="pa-eyebrow">How to do it</div>
                <div className="pa-card pad">
                  <p className="pa-quote" style={{ margin: 0 }}>
                    {t.howTo}
                  </p>
                  {t.sopUrl && (
                    <a className="pa-link" href={t.sopUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", paddingLeft: 0 }}>
                      Open {t.sop || "the SOP"} in the Playbook
                    </a>
                  )}
                </div>
              </>
            )}

            {t.templateId && !/daily report/i.test(t.title) && t.status === "open" && (
              <button type="button" className="pa-link" style={{ alignSelf: "flex-start" }} onClick={toggleMute}>
                {muted ? "Turn reminders back on for this task" : "Mute reminders for this task"}
              </button>
            )}
          </>
        )}
      </main>

      {t && t.status !== "done" && (
        <div className="pa-actionbar">
          <div className="pa-actionbar-inner">
            {t.source === "auto" ? (
              <div className="pa-banner ok" style={{ justifyContent: "center", textAlign: "center" }}>
                <div>
                  <b>Ticks itself when the record is saved in ERPNext</b>
                  Nothing to tap here.
                </div>
              </div>
            ) : (
              <button type="button" className="pa-btn green" disabled={busy} onClick={() => mark("done")}>
                <Icon name="check" width={3} />
                Mark done
              </button>
            )}
            {t.status === "open" && (
              <button type="button" className="pa-btn ghost" onClick={() => setSheet(true)}>
                I can&apos;t do it
              </button>
            )}
          </div>
        </div>
      )}

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Why can't it be done?">
        <div className="pa-choices">
          {(t?.reasons || []).map((r) => (
            <button key={r} type="button" className="pa-choice tall" aria-pressed={reason === r} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
          <button type="button" className="pa-choice tall" aria-pressed={reason === "__other"} onClick={() => setReason("__other")}>
            Something else
          </button>
        </div>
        {reason === "__other" && <textarea className="pa-textarea" placeholder="Tell your line manager what happened" value={other} onChange={(e) => setOther(e.target.value)} />}
        <p className="pa-help">Your line manager will be told.</p>
        <button type="button" className="pa-btn" disabled={!finalReason || busy} onClick={() => mark("not_done", finalReason)}>
          Save and tell my line manager
        </button>
      </Sheet>
    </>
  );
}
