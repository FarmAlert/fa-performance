"use client";

import { useEffect } from "react";
import { useData } from "./useData";
import { post } from "./client";
import { TopBar, Skeleton, ErrorBox, Empty } from "./ui";

// In-app copy of every notification (spec 7) — so a reminder held back by
// quiet hours or the 6-a-day cap, or missed on a phone with pushes off, is
// still here. Tapping one opens the matching screen.
export default function Inbox({ back, go, onAuthError, reloadMe }) {
  const { data, loading, error } = useData("notifications", {}, { onAuthError });
  useEffect(() => {
    if (!data) return;
    post("mark_notifications_read")
      .then(() => reloadMe())
      .catch(() => {});
  }, [data, reloadMe]);

  function open(n) {
    try {
      const u = new URL(n.url || "/", window.location.origin);
      const p = Object.fromEntries(u.searchParams.entries());
      const view = p.view || "day";
      delete p.view;
      go(view, p);
    } catch {
      go("day");
    }
  }

  return (
    <>
      <TopBar title="Notifications" onBack={back} />
      <main className="pa-main">
        {loading && !data && <Skeleton rows={4} />}
        <ErrorBox>{!data && error}</ErrorBox>
        {data && data.length === 0 && (
          <Empty icon="bell" title="No notifications yet">
            Reminders and decisions about your ideas appear here.
          </Empty>
        )}
        {(data || []).map((n) => (
          <button key={n.id} type="button" className="pa-card pa-tap" onClick={() => open(n)} style={!n.read ? { borderColor: "#bfe8cb", background: "#fbfefc" } : undefined}>
            <div className="pa-between" style={{ alignItems: "flex-start" }}>
              <div style={{ fontWeight: 800 }}>{n.title}</div>
              <span className="pa-muted" style={{ whiteSpace: "nowrap" }}>
                {new Date(n.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}
              </span>
            </div>
            <div className="pa-muted" style={{ fontSize: 13, marginTop: 2 }}>
              {n.body}
            </div>
          </button>
        ))}
      </main>
    </>
  );
}
