"use client";

import { useEffect, useState, useCallback } from "react";

// Shared pieces for the Performance App screens. Band colour is never the
// only signal (spec 8.2): every score shows its number and the band word.

const PATHS = {
  bell: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  back: <path d="m15 18-6-6 6-6" />,
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  pin: (
    <>
      <path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  plus: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ),
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />,
  day: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  report: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </>
  ),
  rating: <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />,
  idea: (
    <>
      <path d="M9 18h6M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.74V16h8v-1.26A7 7 0 0 0 12 2z" />
    </>
  ),
  team: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  stars: (
    <>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </>
  ),
  camera: (
    <>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  mic: (
    <>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
    </>
  ),
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M8 16H3v5" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  cloudOff: (
    <>
      <path d="m2 2 20 20" />
      <path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 9.7 5.07" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>
  ),
  shield: <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />,
  trophy: (
    <>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2z" />
    </>
  ),
};

export function Icon({ name, size = 20, stroke = "currentColor", width = 2, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {PATHS[name]}
    </svg>
  );
}

const WORD = { green: "GREEN", amber: "AMBER", red: "RED", no_data: "NO DATA" };

export function ScorePill({ score, band, size = "" }) {
  const b = band || "no_data";
  return (
    <div className={"pa-score band-" + b + (size ? " " + size : "")} role="img" aria-label={score === null || score === undefined ? "No score yet" : "Score " + score + ", " + WORD[b]}>
      <div className="pa-score-n">{score === null || score === undefined ? "–" : score}</div>
      {size !== "sm" && <div className="pa-score-w">{WORD[b]}</div>}
    </div>
  );
}

export function bandOfScore(s) {
  if (s === null || s === undefined) return "no_data";
  if (s >= 85) return "green";
  if (s >= 70) return "amber";
  return "red";
}

export function BandText({ score, band }) {
  const b = band || bandOfScore(score);
  const color = { green: "var(--band-green-fg)", amber: "var(--band-amber-fg)", red: "var(--band-red-fg)", no_data: "var(--muted)" }[b];
  return <span style={{ color, fontWeight: 800 }}>{score === null || score === undefined ? "–" : score}</span>;
}

export function Tag({ kind = "", children }) {
  return <span className={"pa-tag " + kind}>{children}</span>;
}

export function Empty({ icon = "sun", title, children }) {
  return (
    <div className="pa-empty">
      <div className="pa-empty-icon">
        <Icon name={icon} size={26} />
      </div>
      <b>{title}</b>
      <div className="pa-muted">{children}</div>
    </div>
  );
}

export function Skeleton({ rows = 3 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="pa-skel" />
      ))}
    </div>
  );
}

export function Spinner() {
  return <span className="pa-spin" aria-hidden="true" />;
}

export function ErrorBox({ children }) {
  if (!children) return null;
  return (
    <div className="pa-error" role="alert">
      {children}
    </div>
  );
}

export function TopBar({ title, sub, onBack, icon = "back", right }) {
  return (
    <header className="pa-topbar">
      {onBack && (
        <button type="button" className="pa-back" onClick={onBack} aria-label={icon === "close" ? "Close" : "Back"}>
          <Icon name={icon} />
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="pa-topbar-title">{title}</div>
        {sub && <div className="pa-topbar-sub">{sub}</div>}
      </div>
      {right}
    </header>
  );
}

export function Sheet({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="pa-sheet-back" onClick={onClose}>
      <div className="pa-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="pa-sheet-grip" />
        <div className="pa-between">
          <div className="pa-h2">{title}</div>
          <button type="button" className="pa-back" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback((text) => {
    setToast({ text, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);
  const node = toast ? (
    <div className="pa-toast" role="status" aria-live="polite">
      <Icon name="check" size={18} stroke="#2ECC52" width={3} />
      {toast.text}
    </div>
  ) : null;
  return [node, show];
}

export function BottomNav({ items, current, onGo }) {
  return (
    <nav className="pa-nav" aria-label="Main">
      <div className="pa-nav-inner">
        {items.map((it) => (
          <button key={it.view} type="button" aria-current={current === it.view ? "page" : undefined} onClick={() => onGo(it.view)}>
            <Icon name={it.icon} size={22} width={current === it.view ? 2.4 : 2} />
            {it.label}
            {it.badge ? <span className="badge">{it.badge}</span> : null}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function naira(n) {
  return "₦" + Math.round(Number(n) || 0).toLocaleString("en-NG");
}

export function nairaShort(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e6) return "₦" + (Math.round(v / 1e5) / 10).toString() + "m";
  if (Math.abs(v) >= 1e3) return "₦" + Math.round(v / 1e3) + "k";
  return naira(v);
}

export function prettyDate(d) {
  if (!d) return "";
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export function greeting() {
  const h = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Africa/Lagos" }));
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
