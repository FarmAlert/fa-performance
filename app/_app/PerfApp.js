"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, AuthError, flush, onQueueChange, queueItems, discard, signOut, formatClock } from "./client";
import { BottomNav, Skeleton, useToast } from "./ui";
import SignIn from "./SignIn";
import Privacy from "./Privacy";
import MyDay from "./MyDay";
import TaskDetail from "./TaskDetail";
import LogVisit from "./LogVisit";
import DailyReport from "./DailyReport";
import MyRating from "./MyRating";
import Ideas from "./Ideas";
import Team from "./Team";
import PersonDay from "./PersonDay";
import Ratings from "./Ratings";
import Rate from "./Rate";
import Decide from "./Decide";
import Inbox from "./Inbox";

// Farm Alert Performance App — root. Holds the signed-in person (`me`),
// routes between screens with ?view= (real history entries, so the phone's
// back button works and ScrollRestoration keeps your place, Addendum E),
// shows the offline / waiting-to-send bars, and flushes the offline queue
// whenever the connection returns.

const ASSOCIATE_TABS = [
  { view: "day", label: "My day", icon: "day" },
  { view: "report", label: "Report", icon: "report" },
  { view: "rating", label: "My rating", icon: "rating" },
  { view: "ideas", label: "Ideas", icon: "idea" },
];
const SUPERVISOR_TABS = [
  { view: "team", label: "Team", icon: "team" },
  { view: "ratings", label: "Ratings", icon: "stars" },
  { view: "decide", label: "Decide", icon: "idea" },
  { view: "day", label: "My day", icon: "day" },
];

function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}

export default function PerfApp() {
  const router = useRouter();
  const sp = useSearchParams();
  const [me, setMe] = useState(undefined); // undefined = loading, null = signed out
  const [offline, setOffline] = useState(false);
  const [cachedAt, setCachedAt] = useState(null);
  const [queue, setQueue] = useState([]);
  const [toast, showToast] = useToast();

  const loadMe = useCallback(async () => {
    try {
      const r = await api("me");
      setMe(r.data);
      setOffline(r.fromCache);
      setCachedAt(r.cachedAt || null);
    } catch (err) {
      if (err instanceof AuthError) setMe(null);
      else setMe((m) => (m === undefined ? null : m));
    }
  }, []);

  useEffect(() => {
    registerServiceWorker();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMe();
    queueItems().then(setQueue);
    const off = onQueueChange(setQueue);
    const goOnline = () => {
      setOffline(false);
      flush().then((r) => {
        if (r?.sent) showToast(r.sent === 1 ? "1 saved item sent" : r.sent + " saved items sent");
      });
    };
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    if (navigator.onLine === false) setOffline(true);
    else flush();
    return () => {
      off();
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [loadMe, showToast]);

  const onAuthError = useCallback(() => setMe(null), []);
  const markOffline = useCallback((fromCache, at) => {
    setOffline(!!fromCache);
    if (fromCache) setCachedAt(at || null);
  }, []);

  const go = useCallback(
    (view, extra = {}) => {
      const p = new URLSearchParams({ view, ...extra });
      router.push("/?" + p.toString());
    },
    [router]
  );
  const back = useCallback(() => {
    if (window.history.length > 1) router.back();
    else go(me?.isSupervisor ? "team" : "day");
  }, [router, go, me]);

  if (me === undefined) {
    return (
      <div className="pa-shell">
        <div className="pa-hero" style={{ height: 120 }} />
        <main className="pa-main">
          <Skeleton rows={4} />
        </main>
      </div>
    );
  }
  if (me === null) return <SignIn onSignedIn={loadMe} />;
  if (!me.privacyAcked) return <Privacy onDone={loadMe} />;

  const view = sp.get("view") || (me.isSupervisor ? "team" : "day");
  const tabs = me.isSupervisor ? SUPERVISOR_TABS : ASSOCIATE_TABS;
  const isTab = tabs.some((t) => t.view === view) || (!me.isSupervisor && view === "inbox");
  const common = { me, go, back, onAuthError, markOffline, showToast, reloadMe: loadMe };

  async function logout() {
    await signOut();
    setMe(null);
    router.replace("/");
  }

  let screen;
  switch (view) {
    case "task":
      screen = <TaskDetail {...common} id={sp.get("id")} />;
      break;
    case "visit":
      screen = <LogVisit {...common} />;
      break;
    case "report":
      screen = <DailyReport {...common} />;
      break;
    case "rating":
      screen = <MyRating {...common} month={sp.get("month")} />;
      break;
    case "ideas":
      screen = <Ideas {...common} />;
      break;
    case "team":
      screen = <Team {...common} filter={sp.get("filter") || "all"} />;
      break;
    case "person":
      screen = <PersonDay {...common} personId={sp.get("person")} />;
      break;
    case "ratings":
      screen = <Ratings {...common} />;
      break;
    case "rate":
      screen = <Rate {...common} personId={sp.get("person")} month={sp.get("month")} />;
      break;
    case "decide":
      screen = <Decide {...common} />;
      break;
    case "inbox":
      screen = <Inbox {...common} />;
      break;
    default:
      screen = <MyDay {...common} onLogout={logout} />;
  }

  const waiting = queue.filter((q) => q.status === "waiting");
  const rejected = queue.filter((q) => q.status === "rejected");
  const navCurrent = view === "inbox" ? "day" : view;

  return (
    <div className="pa-shell">
      {offline && <div className="pa-offline">Offline{cachedAt ? ", last updated " + formatClock(cachedAt) : ""}</div>}
      {waiting.length > 0 && (
        <div className="pa-queue" role="status">
          {waiting.length === 1 ? "1 item" : waiting.length + " items"} waiting to send
        </div>
      )}
      {rejected.map((q) => (
        <div key={q.client_id} className="pa-banner" style={{ margin: "10px 16px 0", borderRadius: 12 }} role="alert">
          <div style={{ flex: 1 }}>
            <b>Couldn&apos;t send {q.label || "a saved item"}</b>
            {q.error}
          </div>
          <button type="button" className="pa-link" onClick={() => discard(q.client_id)}>
            Discard
          </button>
        </div>
      ))}
      {screen}
      {isTab && <BottomNav items={tabs} current={navCurrent} onGo={(v) => go(v)} />}
      {toast}
    </div>
  );
}
