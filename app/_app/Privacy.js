"use client";

import { useState } from "react";
import { post } from "./client";
import { Icon, ErrorBox } from "./ui";

// First-use privacy notice (spec 10.3, NDPA 2023, SOP-TEC-02): what is
// collected, why, who can see it, how long it is kept, and that location is
// only taken when Log a visit is opened — never in the background.
// Retention periods are the spec's proposal, pending HR confirmation.
export default function Privacy({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setBusy(true);
    try {
      await post("privacy_ack");
      onDone();
    } catch (err) {
      setError(err.message === "offline" ? "Connect to the internet to continue." : err.message);
      setBusy(false);
    }
  }

  const rows = [
    ["What we collect", "Your tasks, daily reports, field visits with the location at the moment you save them, shelf photos, your monthly scores and ratings, and the ideas you submit."],
    ["Why", "Performance management under the Farm Alert Playbook (sections 14 and 17): your day, your report, fair scores and recognition for ideas."],
    ["Who can see it", "You, your line manager, HR (VP Finance & Admin), and the CEO, the VP AI & Digital Innovation and the Chief Internal Auditor (read-only)."],
    ["Location", "Only when you open Log a visit, to show how far you are from the Partner's pin. Never in the background."],
    ["How long", "Visits, photos and daily reports: 24 months. Monthly scores, ratings and ideas: your employment plus 6 years."],
  ];

  return (
    <div className="pa-shell">
      <div className="pa-hero">
        <div className="pa-hero-row">
          <div>
            <div className="pa-hero-kicker">Before you start</div>
            <div className="pa-hero-title">Your data in this app</div>
          </div>
          <div className="pa-icon-btn" aria-hidden="true">
            <Icon name="shield" />
          </div>
        </div>
      </div>
      <main className="pa-main no-nav">
        <div className="pa-card pad pa-list">
          {rows.map(([h, t]) => (
            <div key={h} style={{ padding: "10px 0" }}>
              <div className="pa-label">{h}</div>
              <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 2 }}>{t}</div>
            </div>
          ))}
        </div>
        <p className="pa-help">Questions or a request about your data: contact the Data Protection Officer through HR.</p>
        <ErrorBox>{error}</ErrorBox>
      </main>
      <div className="pa-actionbar">
        <div className="pa-actionbar-inner">
          <button type="button" className="pa-btn" onClick={accept} disabled={busy}>
            I understand, continue
          </button>
        </div>
      </div>
    </div>
  );
}
