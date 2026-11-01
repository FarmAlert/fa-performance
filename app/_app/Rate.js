"use client";

import { useEffect, useState } from "react";
import { useData } from "./useData";
import { enqueue, uuid } from "./client";
import { TopBar, ScorePill, Skeleton, ErrorBox, Sheet } from "./ui";

// Screen 09 — Supervisor: rate an Associate (spec 8.3). The scorecard from
// ERPNext is read-only; Care and Dare are 1–5 buttons, Conduct and
// Teamwork 1–5 pickers; the comment is shown to the Associate and is
// required when any score is 2 or below. Save confirms first (spec 8.2) and
// can be edited until the month locks on Day 5. The server refuses anyone
// who doesn't report to you (403).

function Scale({ label, value, onChange }) {
  return (
    <div className="pa-field">
      <span className="pa-label">{label}</span>
      <div className="pa-choices c5" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} className="pa-choice" style={{ minHeight: 48 }} onClick={() => onChange(n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function Picker({ label, value, onChange }) {
  return (
    <label className="pa-field" style={{ flex: 1 }}>
      <span className="pa-label">{label}</span>
      <select className="pa-select" value={value || ""} onChange={(e) => onChange(Number(e.target.value) || null)}>
        <option value="">Choose</option>
        {[5, 4, 3, 2, 1].map((n) => (
          <option key={n} value={n}>
            {n} / 5
          </option>
        ))}
      </select>
    </label>
  );
}

export default function Rate({ personId, month, back, onAuthError, markOffline, showToast }) {
  const { data, loading, error, fromCache, cachedAt } = useData("rate_context", { employee: personId, month }, { onAuthError });
  const [r, setR] = useState({ care: null, dare: null, conduct: null, teamwork: null, comment: "" });
  const [formError, setFormError] = useState("");
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (data) markOffline(fromCache, cachedAt);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data?.rating) setR({ ...data.rating, comment: data.rating.comment || "" });
  }, [data, fromCache, cachedAt, markOffline]);

  const first = data?.person.name.split(" ")[0] || "They";
  const needsComment = [r.care, r.dare, r.conduct, r.teamwork].some((v) => v !== null && v <= 2);
  const complete = [r.care, r.dare, r.conduct, r.teamwork].every((v) => v >= 1);

  function check() {
    setFormError("");
    if (!complete) return setFormError("Give all four scores.");
    if (needsComment && !r.comment.trim()) return setFormError("Add a comment: it's required when any score is 2 or below.");
    setConfirm(true);
  }

  async function save() {
    setConfirm(false);
    await enqueue("rate", { client_id: uuid(), employee: personId, month: data.month, care: r.care, dare: r.dare, conduct: r.conduct, teamwork: r.teamwork, comment: r.comment.trim() }, { label: "the rating for " + first });
    showToast("Rating saved. " + first + " can see it now.");
    back();
  }

  const summary = (data?.lines || []).map((l) => l.kpi.split(" ")[0] + " " + (l.score === null ? "–" : Math.round(l.score))).join(" · ");

  return (
    <>
      <TopBar title={data ? "Rate " + data.person.name : "Rate"} sub={data ? data.monthLabel + (data.locked ? " · locked" : " · due by Day 3, editable to Day 5") : ""} onBack={back} />
      <main className="pa-main no-nav">
        {loading && !data && <Skeleton rows={4} />}
        <ErrorBox>{!data && error}</ErrorBox>
        {data && (
          <>
            <div className="pa-card pad pa-row" style={{ alignItems: "center" }}>
              <ScorePill score={data.score} band={data.band} size="sm" />
              <div>
                <div style={{ fontWeight: 800 }}>Scorecard from ERPNext</div>
                <div className="pa-muted" style={{ fontSize: 13 }}>
                  {summary || "No figures yet"}
                </div>
              </div>
            </div>
            {data.locked ? (
              <div className="pa-banner">This month is locked. Ratings can&apos;t change after Day 5.</div>
            ) : (
              <>
                <Scale label="Care (empathy)" value={r.care} onChange={(v) => setR((x) => ({ ...x, care: v }))} />
                <Scale label="Dare (innovation)" value={r.dare} onChange={(v) => setR((x) => ({ ...x, dare: v }))} />
                <div className="pa-row" style={{ alignItems: "flex-start" }}>
                  <Picker label="Conduct" value={r.conduct} onChange={(v) => setR((x) => ({ ...x, conduct: v }))} />
                  <Picker label="Teamwork" value={r.teamwork} onChange={(v) => setR((x) => ({ ...x, teamwork: v }))} />
                </div>
                <label className="pa-field">
                  <span className="pa-label">
                    Comment {first} will see{needsComment ? " (required)" : ""}
                  </span>
                  <textarea className="pa-textarea" value={r.comment || ""} onChange={(e) => setR((x) => ({ ...x, comment: e.target.value }))} maxLength={2000} style={needsComment && !r.comment?.trim() ? { borderColor: "#f3b4b4" } : undefined} />
                </label>
                <p className="pa-help" style={{ margin: 0 }}>
                  Care and Dare make up 30% of the twice-yearly appraisal. A score of 2 or below needs a comment.
                </p>
                <ErrorBox>{formError}</ErrorBox>
              </>
            )}
          </>
        )}
      </main>
      {data && !data.locked && (
        <div className="pa-actionbar">
          <div className="pa-actionbar-inner">
            <button type="button" className="pa-btn" onClick={check}>
              {data.rating ? "Update rating" : "Save rating"}
            </button>
          </div>
        </div>
      )}
      <Sheet open={confirm} onClose={() => setConfirm(false)} title={"Save " + first + "'s rating?"}>
        <p className="pa-muted" style={{ margin: 0, fontSize: 14 }}>
          {first} sees it on My rating straight away, with your comment. You can change it until Day 5, when the month locks.
        </p>
        <button type="button" className="pa-btn" onClick={save}>
          Save rating
        </button>
        <button type="button" className="pa-btn ghost" onClick={() => setConfirm(false)}>
          Keep editing
        </button>
      </Sheet>
    </>
  );
}
