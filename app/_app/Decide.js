"use client";

import { useEffect, useState } from "react";
import { useData } from "./useData";
import { post } from "./client";
import { Tag, Skeleton, ErrorBox, Empty, Sheet, Icon } from "./ui";

// Supervisor tab: Ideas to decide (spec 8.3 / 9 decide_idea). Improvement
// ideas from direct reports (fast track: Adopt, Try, Park or No, always
// with a reason the person reads). The VP Sales & Marketing also sees
// growth ideas here to score at Gate 1 (value, margin, cost, fit) and
// decide, and can name the Idea of the Month.

const DECISIONS = [
  ["adopt", "Adopt", "+5 Dare points"],
  ["try", "Try it", "Test first, +3 Dare points"],
  ["park", "Park", "Good idea, not now"],
  ["no", "No", "Won't go ahead"],
];

export default function Decide({ me, onAuthError, markOffline, showToast }) {
  const { data, loading, error, fromCache, cachedAt, reload } = useData("ideas_to_decide", {}, { onAuthError });
  const [open, setOpen] = useState(null);
  const [mode, setMode] = useState("decide");
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [scores, setScores] = useState({ value: 0, margin: 0, cost: 0, fit: 0 });
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) markOffline(fromCache, cachedAt);
  }, [data, fromCache, cachedAt, markOffline]);

  function start(idea, m) {
    setOpen(idea);
    setMode(m);
    setDecision("");
    setReason("");
    setFormError("");
    setScores(idea.scores || { value: 0, margin: 0, cost: 0, fit: 0 });
  }

  async function submit() {
    setFormError("");
    setBusy(true);
    try {
      if (mode === "score") {
        await post("score_idea", { idea: open.id, ...scores });
        showToast("Gate 1 score saved");
      } else {
        await post("decide_idea", { idea: open.id, decision, reason });
        showToast("Decision sent to " + (open.owner?.name.split(" ")[0] || "them"));
      }
      setOpen(null);
      reload();
    } catch (err) {
      setFormError(err.message === "offline" ? "You're offline. Decisions need a connection." : err.message);
    }
    setBusy(false);
  }

  async function ideaOfMonth(idea) {
    try {
      await post("idea_of_month", { idea: idea.id });
      showToast("Named Idea of the Month");
      reload();
    } catch (err) {
      showToast(err.message === "offline" ? "You're offline." : err.message);
    }
  }

  const ideas = data?.ideas || [];
  const improvement = ideas.filter((i) => i.kind === "improvement");
  const growth = ideas.filter((i) => i.kind === "growth");

  function card(i) {
    const avg = i.scores ? ((i.scores.value + i.scores.margin + i.scores.cost + i.scores.fit) / 4).toFixed(1) : null;
    return (
      <div key={i.id} className="pa-card pad">
        <div className="pa-between" style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div className="pa-task-title">{i.title}</div>
            <div className="pa-task-meta">
              {i.owner ? i.owner.name + " · " + i.owner.centre : ""}
              {i.decideByLabel ? " · decide by " + i.decideByLabel : ""}
            </div>
          </div>
          <Tag kind={i.status === "in_test" || i.status === "scored" ? "amber" : i.status === "adopted" ? "erp" : ""}>{i.statusLabel}</Tag>
        </div>
        {i.problem && <p style={{ margin: "8px 0 0", fontSize: 14 }}>{i.problem}</p>}
        {i.est && <p className="pa-muted" style={{ margin: "4px 0 0" }}>Saving or margin: {i.est}</p>}
        {avg && <p className="pa-muted" style={{ margin: "4px 0 0" }}>Gate 1 score {avg} (value {i.scores.value}, margin {i.scores.margin}, cost {i.scores.cost}, fit {i.scores.fit})</p>}
        {i.photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={i.photo} alt="Idea photo" className="pa-photo" style={{ marginTop: 8, width: "100%", height: 160 }} />
        )}
        {i.voice && <audio controls src={i.voice} style={{ width: "100%", marginTop: 8 }} />}
        {i.canDecide && (
          <div className="pa-row" style={{ gap: 8, marginTop: 10 }}>
            {i.kind === "growth" && (
              <button type="button" className="pa-btn ghost sm" style={{ flex: 1 }} onClick={() => start(i, "score")}>
                Score Gate 1
              </button>
            )}
            <button type="button" className="pa-btn sm" style={{ flex: 1 }} onClick={() => start(i, "decide")}>
              Decide
            </button>
          </div>
        )}
        {i.kind === "growth" && data.growthReviewer && (i.status === "adopted" || i.status === "in_test") && !i.ideaOfMonth && (
          <button type="button" className="pa-link" onClick={() => ideaOfMonth(i)}>
            Name Idea of the Month
          </button>
        )}
        {i.ideaOfMonth && (
          <div className="pa-tags">
            <Tag kind="amber">
              <span className="pa-row" style={{ gap: 4 }}>
                <Icon name="trophy" size={11} width={2.5} />
                Idea of the Month
              </span>
            </Tag>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="pa-hero">
        <div className="pa-hero-kicker">{me.isGrowthReviewer ? "Fast track and Growth review" : "Fast track"}</div>
        <div className="pa-hero-title">Ideas to decide</div>
        <div className="pa-hero-sub">Every idea gets an answer with a reason.</div>
      </div>
      <main className="pa-main">
        {loading && !data && <Skeleton rows={3} />}
        <ErrorBox>{!data && error}</ErrorBox>
        {data && ideas.length === 0 && (
          <Empty icon="idea" title="Nothing to decide">
            New ideas from your team appear here.
          </Empty>
        )}
        {improvement.length > 0 && <div className="pa-eyebrow">Improvement</div>}
        {improvement.map(card)}
        {growth.length > 0 && <div className="pa-eyebrow">Growth</div>}
        {growth.map(card)}
      </main>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={mode === "score" ? "Gate 1 score" : "Your decision"}>
        <div style={{ fontWeight: 700 }}>{open?.title}</div>
        {mode === "score" ? (
          ["value", "margin", "cost", "fit"].map((k) => (
            <div key={k} className="pa-field">
              <span className="pa-label" style={{ textTransform: "capitalize" }}>
                {k}
              </span>
              <div className="pa-choices c5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" className="pa-choice" aria-pressed={scores[k] === n} onClick={() => setScores((s) => ({ ...s, [k]: n }))}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))
        ) : (
          <>
            <div className="pa-choices c2">
              {DECISIONS.filter(([k]) => !(open?.status === "in_test" && k === "try")).map(([k, label, hint]) => (
                <button key={k} type="button" className="pa-choice tall" aria-pressed={decision === k} onClick={() => setDecision(k)}>
                  {label}
                  <small>{hint}</small>
                </button>
              ))}
              {open?.status === "adopted" && (
                <button type="button" className="pa-choice tall" aria-pressed={decision === "scale"} onClick={() => setDecision("scale")}>
                  Scale
                  <small>Roll out more widely</small>
                </button>
              )}
            </div>
            <label className="pa-field">
              <span className="pa-label">Reason (they will see it)</span>
              <textarea className="pa-textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
            </label>
          </>
        )}
        <ErrorBox>{formError}</ErrorBox>
        <button type="button" className="pa-btn" disabled={busy || (mode === "decide" ? !decision || !reason.trim() : Object.values(scores).some((v) => !v))} onClick={submit}>
          {mode === "score" ? "Save score" : "Send decision"}
        </button>
      </Sheet>
    </>
  );
}
