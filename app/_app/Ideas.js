"use client";

import { useEffect, useRef, useState } from "react";
import { useData } from "./useData";
import { enqueue, uuid } from "./client";
import { Icon, Tag, ErrorBox, Skeleton, Empty } from "./ui";

// Screen 07 — Submit an idea + My ideas (spec 8.3, SOP-GRO-01). Improvement
// ideas go to the line manager (decision within 10 working days); Growth
// ideas are scored at the monthly Growth review. Optional photo and voice
// note (up to 2 minutes). Works offline: the idea is queued with its media
// and sent when the signal returns. +1 Dare point on submission.

const STATUS_KIND = { received: "", scored: "amber", in_test: "amber", adopted: "erp", scaled: "erp", parked: "grey", no: "red" };
const MAX_VOICE_MS = 2 * 60 * 1000;

function pickAudioType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["audio/webm", "audio/mp4", "audio/ogg"]) if (MediaRecorder.isTypeSupported?.(t)) return t;
  return "";
}

function VoiceNote({ value, onChange }) {
  const [rec, setRec] = useState(null);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState("");
  const timer = useRef(null);

  useEffect(() => () => clearInterval(timer.current), []);

  async function start() {
    setErr("");
    const type = pickAudioType();
    if (type === null || !navigator.mediaDevices?.getUserMedia) {
      setErr("Voice notes aren't supported on this phone's browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timer.current);
        const base = (mr.mimeType || type || "audio/webm").split(";")[0];
        const blob = new Blob(chunks, { type: base });
        onChange({ blob, url: URL.createObjectURL(blob) });
        setRec(null);
      };
      mr.start();
      setRec(mr);
      setSecs(0);
      const began = Date.now();
      timer.current = setInterval(() => {
        const s = Math.floor((Date.now() - began) / 1000);
        setSecs(s);
        if (Date.now() - began >= MAX_VOICE_MS) mr.stop();
      }, 250);
    } catch {
      setErr("Allow the microphone to record a voice note.");
    }
  }

  if (value) {
    return (
      <div className="pa-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <audio controls src={value.url} style={{ width: "100%" }} />
        <button type="button" className="pa-link" style={{ alignSelf: "flex-start", padding: 0, minHeight: 32 }} onClick={() => onChange(null)}>
          Remove voice note
        </button>
      </div>
    );
  }
  return (
    <>
      <button type="button" className="pa-choice" style={{ borderStyle: "dashed", minHeight: 50 }} onClick={rec ? () => rec.stop() : start} aria-live="polite">
        <span className="pa-row" style={{ justifyContent: "center", gap: 6 }}>
          <Icon name="mic" size={18} />
          {rec ? "Stop · " + Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0") + " / 2:00" : "+ Voice note"}
        </span>
      </button>
      {err && <span className="pa-help">{err}</span>}
    </>
  );
}

export default function Ideas({ onAuthError, markOffline, showToast }) {
  const { data, loading, error, fromCache, cachedAt, setData } = useData("my_ideas", {}, { onAuthError });
  const [kind, setKind] = useState("improvement");
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState("");
  const [est, setEst] = useState("");
  const [photo, setPhoto] = useState(null);
  const [voice, setVoice] = useState(null);
  const [formError, setFormError] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    if (data) markOffline(fromCache, cachedAt);
  }, [data, fromCache, cachedAt, markOffline]);

  async function submit() {
    setFormError("");
    if (!title.trim()) {
      setFormError("Write your idea in one line.");
      return;
    }
    const files = [];
    if (photo) files.push({ blob: photo.blob, purpose: "idea_photo", field: "photo" });
    if (voice) files.push({ blob: voice.blob, purpose: "idea_voice", field: "voice" });
    const item = await enqueue("submit_idea", { client_id: uuid(), kind, title: title.trim(), problem: problem.trim(), benefit: "", est: est.trim() }, { files, label: "your idea" });
    setData((d) => ({
      totalPoints: (d?.totalPoints || 0) + 1,
      ideas: [{ id: item.client_id, kind, title: title.trim(), statusLabel: "Received", status: "received", points: 1, est: est.trim(), pending: true }, ...(d?.ideas || [])],
    }));
    setTitle("");
    setProblem("");
    setEst("");
    setPhoto(null);
    setVoice(null);
    showToast("Idea received, +1 Dare point");
  }

  return (
    <>
      <div className="pa-hero">
        <div className="pa-hero-title">Submit an idea</div>
        <div className="pa-hero-sub" style={{ fontSize: 13, marginTop: 2 }}>
          Every idea gets an answer with a reason.
        </div>
      </div>
      <main className="pa-main">
        <div className="pa-choices c2" role="group" aria-label="Type of idea">
          <button type="button" className="pa-choice" aria-pressed={kind === "improvement"} onClick={() => setKind("improvement")}>
            Improvement
          </button>
          <button type="button" className="pa-choice" aria-pressed={kind === "growth"} onClick={() => setKind("growth")}>
            Growth
          </button>
        </div>
        <p className="pa-help" style={{ margin: 0 }}>
          {kind === "improvement"
            ? "Improvement: save cost, work faster, serve better. Your line manager decides within 10 working days."
            : "Growth: a new product, centre, country or VetX feature. Scored at the monthly Growth review."}
        </p>
        <label className="pa-field">
          <span className="pa-label">Your idea, in one line</span>
          <input className="pa-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="e.g. Text Partners when their order leaves the store" />
        </label>
        <label className="pa-field">
          <span className="pa-label">The problem and who benefits</span>
          <textarea className="pa-textarea" value={problem} onChange={(e) => setProblem(e.target.value)} maxLength={2000} />
        </label>
        <label className="pa-field">
          <span className="pa-label">Rough saving or margin</span>
          <input className="pa-input" value={est} onChange={(e) => setEst(e.target.value)} maxLength={200} placeholder="e.g. About 1 hour of CSO time a day" />
        </label>
        <div className="pa-choices c2">
          {photo ? (
            <div style={{ position: "relative" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="Idea photo" className="pa-photo" style={{ width: "100%", height: 96 }} />
              <button type="button" aria-label="Remove photo" onClick={() => setPhoto(null)} style={{ position: "absolute", top: 6, right: 6, width: 30, height: 30, borderRadius: 15, border: 0, background: "rgba(20,38,46,0.7)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="x" size={14} width={3} />
              </button>
            </div>
          ) : (
            <button type="button" className="pa-choice" style={{ borderStyle: "dashed", minHeight: 50 }} onClick={() => fileRef.current?.click()}>
              <span className="pa-row" style={{ justifyContent: "center", gap: 6 }}>
                <Icon name="camera" size={18} />+ Photo
              </span>
            </button>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <VoiceNote value={voice} onChange={setVoice} />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPhoto({ blob: f, url: URL.createObjectURL(f) });
              e.target.value = "";
            }}
          />
        </div>
        <ErrorBox>{formError}</ErrorBox>
        <button type="button" className="pa-btn green" onClick={submit}>
          Submit idea
        </button>

        <div className="pa-h2" style={{ marginTop: 12 }}>
          My ideas{data ? " · " + data.totalPoints + " Dare points" : ""}
        </div>
        {loading && !data && <Skeleton rows={2} />}
        <ErrorBox>{!data && error}</ErrorBox>
        {data && data.ideas.length === 0 && (
          <Empty icon="idea" title="No ideas yet">
            Your first idea earns 1 Dare point. A tested idea earns 3, an adopted one 5.
          </Empty>
        )}
        {(data?.ideas || []).map((i) => (
          <div key={i.id} className="pa-card">
            <div className="pa-between" style={{ alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div className="pa-task-title">{i.title}</div>
                <div className="pa-task-meta">
                  {i.kind === "growth" ? "Growth" : "Improvement"}
                  {i.est ? " · " + i.est : ""}
                  {i.scores ? " · Gate 1 score " + ((i.scores.value + i.scores.margin + i.scores.cost + i.scores.fit) / 4).toFixed(1) : ""}
                </div>
              </div>
              <Tag kind={i.pending ? "grey" : STATUS_KIND[i.status]}>{i.pending ? "Waiting to send" : i.statusLabel}</Tag>
            </div>
            {i.reason && (
              <p className="pa-muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
                <b style={{ color: "var(--ink)" }}>{i.decidedBy || "Decision"}:</b> {i.reason}
              </p>
            )}
            {!i.reason && i.decideByLabel && i.status === "received" && <p className="pa-muted" style={{ margin: "8px 0 0" }}>Decision due by {i.decideByLabel}</p>}
            <div className="pa-tags">
              {i.points > 0 && <Tag kind="erp">+{i.points} Dare</Tag>}
              {i.ideaOfMonth && (
                <Tag kind="amber">
                  <span className="pa-row" style={{ gap: 4 }}>
                    <Icon name="trophy" size={11} width={2.5} />
                    Idea of the Month
                  </span>
                </Tag>
              )}
            </div>
          </div>
        ))}
      </main>
    </>
  );
}
