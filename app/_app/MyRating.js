"use client";

import { useEffect } from "react";
import { useData } from "./useData";
import { ScorePill, Skeleton, ErrorBox, BandText, bandOfScore, naira, Empty } from "./ui";

// Screen 06 — My rating (spec 8.3): this month's live score and colour, how
// far from the next band, each KPI with weight, 0–100 score and a bar in its
// band colour, the supervisor's Care / Dare / Conduct / Teamwork with their
// comment, the last 5 locked months and Dare points.

const BAR = { green: "", amber: " pa-bar-amber", red: " pa-bar-red", no_data: "" };
const BAND_WORD = { green: "Green", amber: "Amber" };

function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

function actualLabel(l) {
  if (l.actual === null || l.actual === undefined) return "No data yet";
  const a = l.money ? naira(l.actual) : l.percent ? l.actual + "%" : String(l.actual);
  const t = l.target ? (l.money ? naira(l.target) : l.percent ? l.target + "%" : String(l.target)) : null;
  return t ? a + " of " + t : a;
}

export default function MyRating({ me, month, go, onAuthError, markOffline }) {
  const m = month || me.month;
  const { data, loading, error, fromCache, cachedAt } = useData("my_rating", { month: m }, { onAuthError });
  useEffect(() => {
    if (data) markOffline(fromCache, cachedAt);
  }, [data, fromCache, cachedAt, markOffline]);

  const status = data ? (data.locked ? "Locked" : "Live, not locked") : "";
  const gap = data?.gap ? data.gap.points + " points from " + BAND_WORD[data.gap.band] : data?.band === "green" ? "In the Green band" : "";
  const months = [me.month, addMonths(me.month, -1), addMonths(me.month, -2)];

  return (
    <>
      <div className="pa-hero">
        <div className="pa-hero-row" style={{ justifyContent: "flex-start", gap: 16 }}>
          <ScorePill score={data?.score ?? null} band={data?.band || "no_data"} size="lg" />
          <div style={{ minWidth: 0 }}>
            <div className="pa-hero-title">My rating · {data?.monthLabel || ""}</div>
            <div className="pa-hero-sub">{[status, gap].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      </div>
      <main className="pa-main">
        <div className="pa-chips" role="group" aria-label="Month">
          {months.map((x) => (
            <button key={x} type="button" className="pa-chip" aria-pressed={x === m} onClick={() => go("rating", { month: x })}>
              {new Date(x + "-15T00:00:00Z").toLocaleString("en-GB", { month: "long", timeZone: "UTC" })}
            </button>
          ))}
        </div>
        {loading && !data && <Skeleton rows={3} />}
        <ErrorBox>{!data && error}</ErrorBox>
        {data && (
          <>
            <div className="pa-card pad">
              <div className="pa-h2" style={{ marginBottom: 4 }}>
                Scorecard{me.cluster ? " · " + me.cluster : ""}
              </div>
              {data.lines.length === 0 ? (
                <Empty icon="rating" title="No figures yet">
                  Your score appears once your first figures are in.
                </Empty>
              ) : (
                data.lines.map((l) => {
                  const b = bandOfScore(l.score);
                  return (
                    <div key={l.key} className="pa-kpi">
                      <div className="pa-between">
                        <span>
                          {l.kpi} · {l.weight}
                        </span>
                        <span className="pa-kpi-score">
                          <BandText score={l.score === null ? null : Math.round(l.score)} />
                        </span>
                      </div>
                      <div className={"pa-progress thin" + BAR[b]}>
                        <span style={{ width: (l.score || 0) + "%" }} />
                      </div>
                      {data.source === "scorecard" && <span className="pa-muted">{actualLabel(l)}</span>}
                    </div>
                  );
                })
              )}
              {data.source === "cluster" && <p className="pa-help" style={{ marginTop: 6 }}>Scored with your team&apos;s current Performance System formula.</p>}
            </div>

            <div className="pa-card pad">
              <div className="pa-h2" style={{ marginBottom: 10 }}>
                From your supervisor
              </div>
              {data.rating ? (
                <>
                  <div className="pa-tiles">
                    {[
                      ["Care", data.rating.care],
                      ["Dare", data.rating.dare],
                      ["Conduct", data.rating.conduct],
                      ["Teamwork", data.rating.teamwork],
                    ].map(([k, v]) => (
                      <div key={k} className="pa-tile">
                        <span>{k}</span>
                        <b>{v} / 5</b>
                      </div>
                    ))}
                  </div>
                  {data.rating.comment && <p className="pa-quote" style={{ margin: "12px 0 6px" }}>&ldquo;{data.rating.comment}&rdquo;</p>}
                  <div className="pa-muted">
                    {data.rating.by}
                    {data.rating.savedAt ? " · " + new Date(data.rating.savedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" }) : ""}
                  </div>
                </>
              ) : (
                <div className="pa-muted">Your supervisor rates you after the month ends, by Day 3. Ratings feed your twice-yearly appraisal.</div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="pa-card pad">
                <div className="pa-muted" style={{ fontWeight: 700 }}>
                  Trend
                </div>
                <div style={{ fontWeight: 800, fontSize: 15, marginTop: 4 }}>
                  {data.trend.length === 0 ? (
                    <span className="pa-muted">First locked month soon</span>
                  ) : (
                    data.trend.map((t, i) => (
                      <span key={t.month}>
                        {i > 0 && " · "}
                        <BandText score={t.score} band={t.band} />
                      </span>
                    ))
                  )}
                </div>
              </div>
              <button type="button" className="pa-card pad dark pa-tap" onClick={() => go("ideas")}>
                <div style={{ color: "var(--teal-ink-soft)", fontWeight: 700, fontSize: 13 }}>Dare points</div>
                <div style={{ fontWeight: 800, fontSize: 28, color: "var(--green)", lineHeight: 1.1 }}>{data.darePoints.total}</div>
                {data.darePoints.thisMonth > 0 && <div style={{ fontSize: 12, color: "var(--teal-ink-soft)" }}>+{data.darePoints.thisMonth} this month</div>}
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}
