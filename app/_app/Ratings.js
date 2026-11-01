"use client";

import { useEffect } from "react";
import { useData } from "./useData";
import { ScorePill, Tag, Skeleton, ErrorBox, Empty, Icon } from "./ui";

// Supervisor tab: monthly ratings due (spec 6.3, 7). Last month's ratings
// are open from Day 1 and due by Day 3; they can be edited until Day 5.
export default function Ratings({ go, onAuthError, markOffline }) {
  const { data, loading, error, fromCache, cachedAt } = useData("ratings_due", {}, { onAuthError });
  useEffect(() => {
    if (data) markOffline(fromCache, cachedAt);
  }, [data, fromCache, cachedAt, markOffline]);
  const left = (data?.people || []).filter((p) => !p.rated).length;

  return (
    <>
      <div className="pa-hero">
        <div className="pa-hero-kicker">Monthly ratings</div>
        <div className="pa-hero-title">{data ? data.monthLabel : "Ratings"}</div>
        <div className="pa-hero-sub">{data ? (data.locked ? "Locked" : left ? left + " to rate · due by " + data.dueLabel : "All rated, thank you") : ""}</div>
      </div>
      <main className="pa-main">
        {loading && !data && <Skeleton rows={3} />}
        <ErrorBox>{!data && error}</ErrorBox>
        {data && data.people.length === 0 && (
          <Empty icon="stars" title="No one to rate">
            People who report to you appear here.
          </Empty>
        )}
        {(data?.people || []).map((p) => (
          <button key={p.id} type="button" className="pa-card pa-tap pa-person" onClick={() => go("rate", { person: p.id, month: data.month })}>
            <ScorePill score={p.score} band={p.band} size="sm" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="pa-person-name">{p.name}</div>
              <div className="pa-muted">{[p.role, p.centre].filter(Boolean).join(" · ")}</div>
            </div>
            {p.rated ? <Tag kind="erp">Rated</Tag> : <Tag kind="amber">To rate</Tag>}
            <Icon name="chevron" size={18} stroke="#7D8F97" />
          </button>
        ))}
        <p className="pa-help">Care and Dare make up 30% of the twice-yearly appraisal. Ratings sit beside the score and aren&apos;t part of it.</p>
      </main>
    </>
  );
}
