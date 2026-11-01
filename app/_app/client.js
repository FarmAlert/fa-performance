"use client";

// Farm Alert Performance App — browser-side data layer (spec 10.1).
//
//  - api():    GET with an on-device cache. Online: fetch and refresh the
//              cache. Offline or server down: return the last copy, marked
//              fromCache so the screen can show "Offline, last updated hh:mm".
//  - enqueue(): actions that must survive no signal (mark_task, log_visit
//              with photos, save/send report, submit_idea, rate) go into an
//              IndexedDB queue with a client_id (UUID) and the time they
//              were made. flush() sends them through POST /sync when the
//              connection returns; the server is idempotent on client_id,
//              so a retry never duplicates. A rejected item (e.g. the month
//              is locked) stays visible with its reason for the person to
//              fix or discard.
// The session itself is an httpOnly cookie the page can't read; nothing
// sensitive is kept here beyond this person's own cached screens, and
// signing out clears it all.

const DB_NAME = "fa-perf";
const DB_VERSION = 1;
let dbPromise = null;
const memory = { cache: new Map(), queue: new Map(), blobs: new Map() };

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        ["cache", "queue", "blobs"].forEach((s) => {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idb(store, mode, fn) {
  const db = await openDb();
  if (!db) return fn(null, memory[store]);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      const out = fn(os, null);
      if (out && typeof out.onsuccess !== "undefined") {
        out.onsuccess = () => resolve(out.result);
        out.onerror = () => resolve(undefined);
      } else {
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => resolve(undefined);
      }
    } catch {
      resolve(fn(null, memory[store]));
    }
  });
}

const kv = {
  get: (store, key) => idb(store, "readonly", (os, mem) => (os ? os.get(key) : mem.get(key))),
  set: (store, key, value) => idb(store, "readwrite", (os, mem) => (os ? os.put(value, key) : mem.set(key, value))),
  del: (store, key) => idb(store, "readwrite", (os, mem) => (os ? os.delete(key) : mem.delete(key))),
  all: (store) =>
    idb(store, "readonly", (os, mem) => {
      if (!os) return [...mem.values()];
      return os.getAll();
    }),
  clear: (store) => idb(store, "readwrite", (os, mem) => (os ? os.clear() : mem.clear())),
};

export class AuthError extends Error {}
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
}

function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  const s = p.toString();
  return s ? "?" + s : "";
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function api(method, params = {}, { cache = true } = {}) {
  const key = method + qs(params);
  try {
    const res = await fetch("/api/app/" + method + qs(params), { credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) throw new AuthError((await readJson(res)).error || "Please sign in again.");
    const body = await readJson(res);
    if (!res.ok) {
      if (res.status >= 500 && cache) {
        const hit = await kv.get("cache", key);
        if (hit) return { data: hit.data, fromCache: true, cachedAt: hit.at };
      }
      throw new ApiError(body.error || "Something went wrong.", res.status);
    }
    if (cache) kv.set("cache", key, { data: body, at: Date.now() });
    return { data: body, fromCache: false };
  } catch (err) {
    if (err instanceof AuthError || err instanceof ApiError) throw err;
    const hit = cache ? await kv.get("cache", key) : null;
    if (hit) return { data: hit.data, fromCache: true, cachedAt: hit.at };
    throw new ApiError("You're offline and this hasn't been loaded on this phone yet.", 0);
  }
}

export async function post(method, body = {}) {
  let res;
  try {
    res = await fetch("/api/app/" + method, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "x-perf-app": "1" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("offline", 0);
  }
  if (res.status === 401) throw new AuthError((await readJson(res)).error || "Please sign in again.");
  const data = await readJson(res);
  if (!res.ok) throw new ApiError(data.error || "Something went wrong.", res.status);
  return data;
}

export async function signIn(email, password) {
  const res = await fetch("/api/app/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "x-perf-app": "1" },
    body: JSON.stringify({ email, password }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new ApiError(data.error || "Couldn't sign you in.", res.status);
  return data;
}

export async function signOut() {
  try {
    await fetch("/api/app/logout", { method: "POST", credentials: "same-origin", headers: { "x-perf-app": "1" } });
  } catch {
    // offline: the cookie still expires; local data is cleared below
  }
  await Promise.all([kv.clear("cache"), kv.clear("queue"), kv.clear("blobs")]);
}

// ---------------------------------------------------------------------------
// Offline queue
// ---------------------------------------------------------------------------

const listeners = new Set();
export function onQueueChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
async function emit() {
  const items = await queueItems();
  listeners.forEach((fn) => fn(items));
}

export async function queueItems() {
  const items = (await kv.all("queue")) || [];
  return items.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

// files: [{ blob, purpose, field }] — uploaded before the action is sent,
// their storage paths written into payload[field] (an array).
export async function enqueue(type, payload, { files = [], label = "" } = {}) {
  const client_id = payload.client_id || uuid();
  const item = { client_id, type, payload: { ...payload, client_id }, created_at: new Date().toISOString(), status: "waiting", label, files: [] };
  for (let i = 0; i < files.length; i++) {
    const key = client_id + ":" + i;
    await kv.set("blobs", key, files[i].blob);
    item.files.push({ key, purpose: files[i].purpose, field: files[i].field, type: files[i].blob.type, size: files[i].blob.size, path: null });
  }
  await kv.set("queue", client_id, item);
  emit();
  flush();
  return item;
}

export async function discard(clientId) {
  const item = await kv.get("queue", clientId);
  if (item) for (const f of item.files || []) await kv.del("blobs", f.key);
  await kv.del("queue", clientId);
  emit();
}

async function uploadFile(f) {
  const blob = await kv.get("blobs", f.key);
  if (!blob) return null;
  const u = await post("upload_url", { purpose: f.purpose, contentType: blob.type, size: blob.size });
  const headers = { "Content-Type": blob.type, "x-upsert": "false" };
  if (u.anonKey) {
    headers.apikey = u.anonKey;
    headers.Authorization = "Bearer " + u.anonKey;
  }
  const res = await fetch(u.signedUrl, { method: "PUT", headers, body: blob });
  if (!res.ok) throw new ApiError("Photo upload failed.", res.status);
  return u.path;
}

let flushing = null;
export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    const results = { sent: 0, failed: 0 };
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return results;
      const items = (await queueItems()).filter((i) => i.status === "waiting");
      if (items.length === 0) return results;
      const ready = [];
      for (const item of items) {
        try {
          for (const f of item.files || []) {
            if (!f.path) {
              f.path = await uploadFile(f);
              await kv.set("queue", item.client_id, item);
            }
          }
          const payload = { ...item.payload };
          (item.files || []).forEach((f) => {
            if (!f.path) return;
            if (!Array.isArray(payload[f.field])) payload[f.field] = payload[f.field] ? [payload[f.field]] : [];
            if (!payload[f.field].includes(f.path)) payload[f.field].push(f.path);
          });
          (item.files || []).forEach((f) => {
            if (f.field === "photo" || f.field === "voice") payload[f.field] = payload[f.field][0] || null;
          });
          ready.push({ type: item.type, client_id: item.client_id, created_at: item.created_at, payload });
        } catch (err) {
          if (err instanceof AuthError) throw err;
          // offline or upload hiccup: leave it waiting for the next flush
        }
      }
      if (ready.length === 0) return results;
      const res = await post("sync", { items: ready });
      for (const r of res.results || []) {
        const item = await kv.get("queue", r.client_id);
        if (!item) continue;
        if (r.ok) {
          for (const f of item.files || []) await kv.del("blobs", f.key);
          await kv.del("queue", r.client_id);
          results.sent++;
        } else if (r.status && r.status < 500) {
          item.status = "rejected";
          item.error = r.error;
          await kv.set("queue", r.client_id, item);
          results.failed++;
        }
      }
    } catch (err) {
      if (err instanceof AuthError) throw err;
    } finally {
      flushing = null;
      emit();
    }
    return results;
  })();
  return flushing;
}

// Draft text for the daily report, kept on the phone so it survives a
// closed tab or no signal (spec 10.1 "the last report draft").
export async function saveLocalDraft(date, draft) {
  await kv.set("cache", "draft:" + date, { data: draft, at: Date.now() });
}
export async function loadLocalDraft(date) {
  const hit = await kv.get("cache", "draft:" + date);
  return hit ? hit.data : null;
}

export function formatClock(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
}
