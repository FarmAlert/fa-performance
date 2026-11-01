"use client";

import { useEffect, useState } from "react";
import { useData } from "./useData";
import { post } from "./client";
import { ScorePill, Tag, Skeleton, ErrorBox, Empty, nairaShort, Icon } from "./ui";

// Screen 08 — Supervisor: team today (spec 8.3). Summary (reports in, tasks
// missed, today's team figure), filters, one card per direct report with
// score and colour, centre, report status, progress and a MISSED tag, and
// Nudge for everyone without a report.

export default function Team({ me, filter, go, onAuthError, markOffline, showToast }) {
  const { data, loading, error, fromCache, cachedAt, reload } = useData("team_today", { filter }, { onAuthError });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) markOffline(fromCache, cachedAt);
  }, [data, fromCache, cachedAt, markOffline]);

  const noReport = (data?.people || []).filter((p) => !p.report || p.report.status === "draft");

  async function nudgeAll() {
    setBusy(true);
    try {
      const r = await post("nudge", { employees: noReport.map((p) => p.id) });
      showToast(r.sent ? "Nudged " + r.sent + (r.sent === 1 ? " person" : " people") : "Already nudged this hour");
    } catch (err) {
      showToast(err.message === "offline" ? "You're offline. Try again with signal." : err.message);
    }
    setBusy(false);
  }

  const chips = [
    ["all", "All", data?.counts.all],
    ["attention", "Needs attention", data?.counts.attention],
    ["no_report", "No report", data?.counts.noReport],
  ];

  return (
    <>
      <div className="pa-hero">
        <div className="pa-hero-row">
          <div style={{ minWidth: 0 }}>
            <div className="pa-hero-kicker">{[me.role, me.centre].filter(Boolean).join(" · ")}</div>
            <div className="pa-hero-title">{data?.scope === "all" ? "Everyone today" : "My team today"}</div>
          </div>
          <button type="button" className="pa-icon-btn" onClick={() => go("inbox")} aria-label={"Notifications" + (me.unread ? ", " + me.unread + " unread" : "")}>
            <Icon name="bell" />
            {me.unread > 0 && <span className="pa-dot" />}
          </button>
        </div>
        <div className="pa-stats">
          <div className="pa-stat">
            <b>{data ? data.summary.reportsIn + "/" + data.summary.people : "–"}</b>
            <span>Reports in</span>
          </div>
          <div className="pa-stat">
            <b style={{ color: data?.summary.missed ? "#FCA5A5" : "#fff" }}>{data ? data.summary.missed : "–"}</b>
            <span>Missed tasks</span>
          </div>
          <div className="pa-stat">
            <b style={{ color: "#86EFAC" }}>{data?.summary.teamFigure ? nairaShort(data.summary.teamFigure.value) : "–"}</b>
            <span>{data?.summary.teamFigure?.label || "Sales today"}</span>
          </div>
        </div>
      </div>
      <main className="pa-main">
        <div className="pa-chips" role="group" aria-label="Filter">
          {chips.map(([k, label, n]) => (
            <button key={k} type="button" className="pa-chip" aria-pressed={filter === k} onClick={() => go("team", { filter: k })}>
              {label}
              {n !== undefined ? " " + n : ""}
            </button>
          ))}
        </div>
        {loading && !data && <Skeleton rows={4} />}
        <ErrorBox>{!data && error}</ErrorBox>
        {data && data.people.length === 0 && (
          <Empty icon="team" title={filter === "all" ? "No one reports to you yet" : "Nobody here"}>
            {filter === "all" ? "HR sets reporting lines in Staff Accounts." : "Everyone is on track."}
          </Empty>
        )}
        {(data?.people || []).map((p) => {
          const parts = [p.centre];
          if (!p.report || p.report.status === "draft") parts.push("no report");
          else parts.push((p.report.status === "late" ? "sent late " : "report sent ") + (p.report.sentLabel || ""));
          if (p.visits) parts.push(p.visits + " visits");
          else if (p.total) parts.push(p.done + " of " + p.total + " tasks");
          return (
            <button
              key={p.id}
              type="button"
              className={"pa-card pa-tap pa-person"}
              style={p.band === "red" || p.missed ? { borderColor: "#f3b4b4" } : undefined}
              onClick={() => go("person", { person: p.id })}
            >
              <ScorePill score={p.score} band={p.band} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pa-person-name">{p.name}</div>
                <div className="pa-muted">{parts.join(" · ")}</div>
              </div>
              {p.missed > 0 && <Tag kind="red">{p.missed} missed</Tag>}
              {p.report?.status === "late" && !p.missed && <Tag kind="amber">Late</Tag>}
            </button>
          );
        })}
        {data && noReport.length > 0 && data.scope === "direct" && (
          <button type="button" className="pa-btn ghost" onClick={nudgeAll} disabled={busy}>
            Nudge the {noReport.length} without a report
          </button>
        )}
        {data && (
          <button type="button" className="pa-link" style={{ alignSelf: "center" }} onClick={() => reload()}>
            Refresh
          </button>
        )}
      </main>
    </>
  );
}
