"use client";

import { useEffect, useRef, useState } from "react";
import { api, enqueue, uuid, AuthError } from "./client";
import { Icon, TopBar, ErrorBox, Spinner, naira } from "./ui";

// Screen 04 — Log a visit (spec 8.3). Location is captured once, when this
// screen opens, never in the background (spec 10.3). Distance from the
// Partner's saved pin is shown here for the Associate and recalculated on
// the server, which also decides whether the visit is productive (linked
// order + within 300 m, or approved). Saving goes through the offline
// queue with the original time and location, photos included.

const RADIUS = 300;

function metres(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// Shrinks a phone photo to ≤1600 px JPEG before it's queued — a few hundred
// KB instead of several MB on a slow, metered connection.
async function compress(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    return blob || file;
  } catch {
    return file;
  }
}

export default function LogVisit({ me, back, showToast, onAuthError }) {
  const [geo, setGeo] = useState({ state: "locating" });
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [partner, setPartner] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [outcomes, setOutcomes] = useState([]);
  const [order, setOrder] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const startedAt = useRef(new Date().toISOString());

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGeo({ state: "unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => setGeo({ state: "ok", lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (e) => setGeo({ state: e.code === 1 ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
    );
  }, []);

  useEffect(() => {
    if (partner) return undefined;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api("customers_for_visit", { q });
        setResults(r.data.partners || []);
      } catch (err) {
        if (err instanceof AuthError) onAuthError();
        setResults([]);
      }
      setSearching(false);
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, partner, onAuthError]);

  async function pick(p) {
    setPartner(p);
    setCtx(null);
    setOrder(null);
    if (p.type === "customer") {
      try {
        const r = await api("visit_context", { customer: p.id }, { cache: true });
        setCtx(r.data);
      } catch {
        setCtx({ pin: null, orders: [] });
      }
    } else setCtx({ pin: null, orders: [] });
  }

  function toggleOutcome(o) {
    setOutcomes((list) => (list.includes(o) ? list.filter((x) => x !== o) : [...list, o]));
  }

  async function addPhotos(e) {
    const files = [...(e.target.files || [])].slice(0, 3 - photos.length);
    const next = [];
    for (const f of files) {
      const blob = await compress(f);
      next.push({ blob, url: URL.createObjectURL(blob) });
    }
    setPhotos((p) => [...p, ...next].slice(0, 3));
    e.target.value = "";
  }

  const distance = geo.state === "ok" && ctx?.pin ? metres(geo, ctx.pin) : null;
  const far = distance !== null && distance > RADIUS;
  const orderTaken = outcomes.includes("Order taken");

  async function save() {
    setError("");
    if (!partner) return setError("Choose the Partner you visited.");
    if (outcomes.length === 0) return setError("Choose at least one outcome.");
    setBusy(true);
    const payload = {
      client_id: uuid(),
      customer: partner.type === "customer" ? partner.id : null,
      lead: partner.type === "lead" ? partner.id : null,
      partner_name: partner.name,
      visit_time: startedAt.current,
      lat: geo.state === "ok" ? geo.lat : null,
      lng: geo.state === "ok" ? geo.lng : null,
      accuracy: geo.state === "ok" ? geo.accuracy : null,
      outcomes,
      sales_order: order?.doctype === "Sales Order" ? order.name : null,
      sales_invoice: order?.doctype === "Sales Invoice" ? order.name : null,
      notes: notes.trim(),
      photos: [],
    };
    await enqueue("log_visit", payload, { files: photos.map((p) => ({ blob: p.blob, purpose: "visit_photo", field: "photos" })), label: "the visit to " + partner.name });
    showToast(navigator.onLine === false ? "Visit saved. It will send when you're back online." : "Visit saved");
    back();
  }

  return (
    <>
      <TopBar title="Log a visit" onBack={back} icon="close" />
      <main className="pa-main no-nav">
        <div className="pa-label">Partner</div>
        {partner ? (
          <div className="pa-card pa-between" style={{ alignItems: "center" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{partner.name}</div>
              <div className="pa-muted">{partner.type === "lead" ? "Lead" : partner.area || "Customer"}</div>
            </div>
            <button type="button" className="pa-link" onClick={() => setPartner(null)}>
              Change
            </button>
          </div>
        ) : (
          <>
            <input className="pa-input" type="search" placeholder="Search Customers and Leads" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search Partners" />
            <div className="pa-card pa-list" style={{ padding: 0, overflow: "hidden" }}>
              {searching && results.length === 0 && (
                <div className="pa-muted" style={{ padding: 14 }}>
                  <Spinner /> Searching
                </div>
              )}
              {!searching && results.length === 0 && (
                <div className="pa-muted" style={{ padding: 14 }}>
                  {q ? "No Partner found. Check the spelling, or create the Customer in ERPNext first." : "Type a Partner's name."}
                </div>
              )}
              {results.map((r) => (
                <button key={r.type + r.id} type="button" className="pa-search-result" onClick={() => pick(r)}>
                  <span style={{ fontWeight: 700 }}>{r.name}</span>
                  <span className="pa-muted" style={{ whiteSpace: "nowrap" }}>
                    {r.area || (r.type === "lead" ? "Lead" : "")}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className={"pa-banner" + (geo.state === "ok" && !far ? " ok" : geo.state === "locating" ? " info" : "")} role="status">
          <Icon name="pin" />
          <div>
            {geo.state === "locating" && (
              <>
                <b>Getting your location</b>Only taken now, when you log a visit.
              </>
            )}
            {geo.state === "ok" && distance === null && (
              <>
                <b>Location captured</b>
                {partner ? (partner.type === "lead" ? "Leads have no saved pin." : "This Partner has no saved pin yet.") : "Accurate to about " + geo.accuracy + " m."}
              </>
            )}
            {geo.state === "ok" && distance !== null && !far && (
              <>
                <b>Location captured</b>
                {distance} m from the Partner&apos;s pin
              </>
            )}
            {geo.state === "ok" && far && (
              <>
                <b>{distance >= 1000 ? (distance / 1000).toFixed(1) + " km" : distance + " m"} from the Partner&apos;s pin</b>
                More than 300 m away. You can still save; your supervisor will see it flagged.
              </>
            )}
            {geo.state === "denied" && (
              <>
                <b>Location is off</b>Allow location for this app in your phone settings. You can still save the visit.
              </>
            )}
            {geo.state === "unavailable" && (
              <>
                <b>Couldn&apos;t get your location</b>You can still save the visit.
              </>
            )}
          </div>
        </div>

        <div className="pa-label" style={{ marginTop: 4 }}>
          Outcome
        </div>
        <div className="pa-choices c2">
          {me.outcomes.map((o) => (
            <button key={o} type="button" className="pa-choice" aria-pressed={outcomes.includes(o)} onClick={() => toggleOutcome(o)}>
              {o}
            </button>
          ))}
        </div>

        {orderTaken && partner?.type === "customer" && (
          <div className="pa-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="pa-label">Link today&apos;s order</div>
            {!ctx && (
              <div className="pa-muted">
                <Spinner /> Looking in ERPNext
              </div>
            )}
            {ctx && ctx.orders.length === 0 && <div className="pa-muted">No Sales Order or Invoice for this Partner today yet. Save it in ERPNext, then reopen Log a visit to link it. A visit only counts as productive with a linked order.</div>}
            {ctx?.orders.map((o) => (
              <button key={o.name} type="button" className="pa-choice tall" aria-pressed={order?.name === o.name} onClick={() => setOrder(order?.name === o.name ? null : o)}>
                {o.doctype} {o.name}
                <small>{naira(o.total)} · from ERPNext</small>
              </button>
            ))}
          </div>
        )}

        <div className="pa-label" style={{ marginTop: 4 }}>
          Shelf photo <span className="pa-muted">(optional, up to 3)</span>
        </div>
        <div className="pa-photo-grid">
          {photos.map((p, i) => (
            <div key={p.url} style={{ position: "relative" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={"Shelf photo " + (i + 1)} className="pa-photo" />
              <button type="button" aria-label="Remove photo" onClick={() => setPhotos((list) => list.filter((x) => x !== p))} style={{ position: "absolute", top: 4, right: 4, width: 28, height: 28, borderRadius: 14, border: 0, background: "rgba(20,38,46,0.7)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="x" size={14} width={3} />
              </button>
            </div>
          ))}
          {photos.length < 3 && (
            <button type="button" className="pa-photo-add" onClick={() => fileRef.current?.click()} aria-label="Add a shelf photo">
              <Icon name="camera" size={24} />
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={addPhotos} />
        </div>

        <label className="pa-field" style={{ marginTop: 4 }}>
          <span className="pa-label">Notes</span>
          <textarea className="pa-textarea" placeholder="What did you see? Stock-outs, questions, follow-ups" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </label>
        <ErrorBox>{error}</ErrorBox>
      </main>
      <div className="pa-actionbar">
        <div className="pa-actionbar-inner">
          <button type="button" className="pa-btn" onClick={save} disabled={busy}>
            Save visit
          </button>
        </div>
      </div>
    </>
  );
}
