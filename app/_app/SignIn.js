"use client";

import { useState } from "react";
import { signIn } from "./client";
import { ErrorBox, Spinner } from "./ui";

// Screen 01 — Sign in (spec 8.3). Work email + password from the
// Performance System's Staff Accounts. Errors spelled out per spec: wrong
// password, account disabled ("Ask HR"), no Employee linked.
export default function SignIn({ onSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Enter your work email and password.");
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError("You're offline. Connect to sign in the first time.");
      return;
    }
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      onSignedIn();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="pa-signin">
      <div className="pa-signin-top">
        <div className="pa-mark" aria-hidden="true">
          FA
        </div>
        <div style={{ position: "relative", zIndex: 1 }}>
          <div className="pa-hero-kicker" style={{ fontWeight: 700, letterSpacing: "0.08em" }}>
            FARM ALERT
          </div>
          <h1 className="pa-hero-title" style={{ fontSize: 28, margin: "4px 0 8px" }}>
            Performance
          </h1>
          <p className="pa-hero-sub" style={{ fontSize: 14, margin: 0, maxWidth: 300 }}>
            Your day, your report, your rating and your ideas, in one place.
          </p>
        </div>
      </div>
      <form className="pa-signin-card" onSubmit={submit} noValidate>
        <div className="pa-h1">Sign in</div>
        <label className="pa-field">
          <span className="pa-label">Work email</span>
          <input className="pa-input" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@farmalert.com.ng" />
        </label>
        <label className="pa-field">
          <span className="pa-label">Password</span>
          <span className="pa-pw">
            <input className="pa-input" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ paddingRight: 64 }} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}>
              {show ? "Hide" : "Show"}
            </button>
          </span>
        </label>
        <ErrorBox>{error}</ErrorBox>
        <button type="submit" className="pa-btn" disabled={busy}>
          {busy ? <Spinner /> : null}
          {busy ? "Signing in" : "Sign in"}
        </button>
        <p className="pa-help" style={{ textAlign: "center", marginTop: 4 }}>
          Same email and password as your Performance account. Forgot it? Ask the VP Finance &amp; Admin to reset it.
        </p>
        <p className="pa-help" style={{ textAlign: "center" }}>You stay signed in for 30 days on this phone.</p>
      </form>
    </div>
  );
}
