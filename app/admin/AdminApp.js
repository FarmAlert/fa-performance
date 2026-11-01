"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SignIn from "../_app/SignIn";
import { signOut } from "../_app/client";
import SetupClient from "./SetupClient";

// Admin shell: brand bar, who's signed in, link to the phone app, sign out.
// A 401 from the admin API shows the same staff sign-in as the phone app;
// a 403 explains who has access rather than showing an empty page.
export default function AdminApp() {
  const [state, setState] = useState("loading"); // loading | signedout | denied | ready
  const [me, setMe] = useState(null);
  const [message, setMessage] = useState("");

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/admin?probe=1", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) return setState("signedout");
      if (res.status === 403) {
        setMessage(body.error || "");
        return setState("denied");
      }
      if (!res.ok) throw new Error(body.error || "Couldn't load.");
      setMe(body.me || null);
      setState("ready");
    } catch (err) {
      setMessage(err.message);
      setState("denied");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    check();
  }, [check]);

  async function logout() {
    await signOut();
    setState("signedout");
  }

  if (state === "signedout") {
    return (
      <div className="pa">
        <SignIn onSignedIn={check} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-gradient-to-r from-[#0f4a63] via-navy to-[#082733] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" width={36} height={36} className="rounded-lg" />
            <div className="leading-tight">
              <div className="text-[11px] font-bold tracking-widest text-[#c7dce3]">FARM ALERT</div>
              <div className="font-extrabold">Performance admin</div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 text-sm">
            {me && <span className="hidden sm:inline text-[#c7dce3]">{me.name}</span>}
            <Link href="/" className="rounded-lg px-3 h-9 inline-flex items-center font-semibold bg-white/10 hover:bg-white/20">
              Phone app
            </Link>
            {state !== "loading" && (
              <button type="button" onClick={logout} className="rounded-lg px-3 h-9 font-semibold hover:bg-white/10">
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {state === "loading" && <div className="bg-white rounded-2xl border border-slate-200 p-6 text-slate-400 text-sm">Loading…</div>}
        {state === "denied" && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-xl">
            <h1 className="text-navy font-extrabold text-xl">No admin access</h1>
            <p className="text-slate-600 text-sm mt-2">{message || "Admin is for HR (VP Finance & Admin) and the CTO, with read-only access for the CEO, the VP AI & Digital Innovation and the Chief Internal Auditor."}</p>
            <Link href="/" className="inline-flex mt-4 h-11 px-5 items-center rounded-xl bg-navy text-white font-bold text-sm">
              Open the phone app
            </Link>
          </div>
        )}
        {state === "ready" && <SetupClient onSignedOut={() => setState("signedout")} />}
      </main>
    </div>
  );
}
