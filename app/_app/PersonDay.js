"use client";

import { useEffect } from "react";
import { useData } from "./useData";
import { post, formatClock } from "./client";
import { TopBar, Tag, Skeleton, ErrorBox, naira, prettyDate } from "./ui";

// Supervisor: one team member's day (tap a card on Team) — their tasks,
// today's report as sent, and visits with distance from the pin. A visit
// more than 300 m from the pin can be approved here so it counts as
// productive (spec 4 FA Visit). Read-only otherwise.

export default function PersonDay({ personId, back, go, onAuthError, markOffline, showToast }) {
  const { data, loading, error, fromCache, cachedAt, reload } = useData("person_day", { employee: personId }, { onAuthError });
  useEffect(() => {
    if (data) markOffline(fromCache, cachedAt);
  }, [data, fromCache, cachedAt, markOffline]);

  async function approve(v) {
    try {
      await post("approve_visit", { visit: v.id });
      showToast("Visit approved");
      reload();
    } catch (err) {
      showToast(err.message === "offline" ? "You're offline." : err.message);
    }
  }

  const rep = data?.report?.report;
  const sent = rep && rep.status !== "draft";

  return (
    <>
      <TopBar title={data?.person.name || "Team member"} sub={data ? [data.person.role, data.person.centre].filter(Boolean).join(" · ") : ""} onBack={back} />
      <main className="pa-main no-nav">
        {loading && !data && <Skeleton rows={4} />}
        <ErrorBox>{!data && error}</ErrorBox>
        {data && (
          <>
            <div className="pa-between">
              <div className="pa-h2">{prettyDate(data.day.date)}</div>
              <span className="pa-muted">
                {data.day.done} of {data.day.total} done
              </span>
            </div>
            <div className="pa-progress">
              <span style={{ width: (data.day.total ? Math.round((data.day.done / data.day.total) * 100) : 0) + "%" }} />
            </div>

            <div className="pa-card pa-list" style={{ padding: "0 12px" }}>
              {data.day.tasks.length === 0 && <div className="pa-muted" style={{ padding: 12 }}>No tasks today.</div>}
              {data.day.tasks.map((t) => (
                <div key={t.id} style={{ padding: "10px 0" }}>
                  <div className="pa-between" style={{ alignItems: "flex-start" }}>
                    <div style={{ fontWeight: 700 }}>{t.title}</div>
                    {t.status === "done" ? <Tag kind="erp">Done</Tag> : t.status === "not_done" ? <Tag kind="red">Not done</Tag> : t.overdue ? <Tag kind="red">Overdue</Tag> : <Tag kind="grey">Open</Tag>}
                  </div>
                  <div className="pa-muted">{[t.progressLabel, t.dueLabel && "due " + t.dueLabel, t.reason && "Reason: " + t.reason].filter(Boolean).join(" · ")}</div>
                </div>
              ))}
            </div>

            <div className="pa-eyebrow">Daily report</div>
            <div className="pa-card pad">
              {sent ? (
                <>
                  <div className="pa-between">
                    <b>{rep.status === "late" ? "Sent late" : "Sent"} at {formatClock(rep.sentAt)}</b>
                    {rep.status === "late" && <Tag kind="amber">Late</Tag>}
                  </div>
                  <div className="pa-figs" style={{ marginTop: 10 }}>
                    {(rep.figures || data.report.figures || []).map((f) => (
                      <div key={f.key} className="pa-fig">
                        <b style={{ fontSize: 16 }}>{f.value === null || f.value === undefined ? "–" : f.money ? naira(f.value) : f.value}</b>
                        <span>{f.label}</span>
                      </div>
                    ))}
                  </div>
                  {rep.notes && <p className="pa-quote" style={{ margin: "10px 0 0" }}>{rep.notes}</p>}
                </>
              ) : (
                <div className="pa-muted">No report sent yet today.</div>
              )}
            </div>

            {data.visits.length > 0 && (
              <>
                <div className="pa-eyebrow">Visits</div>
                {data.visits.map((v) => (
                  <div key={v.id} className="pa-card" style={v.farFromPin && !v.farApproved ? { borderColor: "#f5c77e" } : undefined}>
                    <div className="pa-between" style={{ alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 800 }}>{v.partner}</div>
                        <div className="pa-muted">
                          {formatClock(v.time)} · {v.outcomes.join(", ")}
                          {v.salesOrder || v.salesInvoice ? " · " + (v.salesOrder || v.salesInvoice) : ""}
                        </div>
                      </div>
                      {v.productive ? <Tag kind="erp">Productive</Tag> : <Tag kind="grey">Not productive</Tag>}
                    </div>
                    <div className="pa-muted" style={{ marginTop: 6 }}>
                      {v.distanceM === null ? "No pin to compare" : v.distanceM + " m from the pin"}
                      {v.farFromPin && (v.farApproved ? " · approved" : " · more than 300 m")}
                    </div>
                    {v.notes && <p style={{ margin: "6px 0 0", fontSize: 13 }}>{v.notes}</p>}
                    {v.photos.length > 0 && (
                      <div className="pa-photo-grid" style={{ marginTop: 8 }}>
                        {v.photos.map((url, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={i} src={url} alt={"Shelf photo " + (i + 1)} className="pa-photo" />
                        ))}
                      </div>
                    )}
                    {v.farFromPin && !v.farApproved && data.canApproveVisits && (
                      <button type="button" className="pa-btn ghost sm" style={{ marginTop: 10 }} onClick={() => approve(v)}>
                        Approve this visit
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}

            {data.canApproveVisits && (
              <button type="button" className="pa-btn ghost" style={{ marginTop: 6 }} onClick={() => go("rate", { person: data.person.id })}>
                Rate {data.person.name.split(" ")[0]}
              </button>
            )}
          </>
        )}
      </main>
    </>
  );
}
