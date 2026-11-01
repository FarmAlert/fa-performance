import "server-only";
import crypto from "node:crypto";
import { getServiceClient } from "./serviceClient";

// ---------------------------------------------------------------------------
// Farm Alert Performance App — private media (spec 4 photos/voice notes,
// 10.2). Visit shelf photos and idea photos/voice notes go phone ->
// Supabase Storage directly through a signed upload URL for ONE
// server-chosen path under "<staff id>/" (same pattern and reasoning as
// lib/db/perf-task-updates.js: a phone photo would overflow Vercel's
// request-body limit). The bucket is private; reads are only ever
// short-lived signed URLs, handed out after the caller has already passed
// assertCanSee for that employee.
// ---------------------------------------------------------------------------

const BUCKET = "perf-app-media";
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024; // matches migration 122
const READ_TTL_SECONDS = 60 * 60;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];
const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac"];

export class AppMediaError extends Error {
  constructor(message) {
    super(message);
    this.name = "AppMediaError";
    this.status = 400;
  }
}

export async function createMediaUpload(staffId, { purpose, contentType, size }) {
  if (purpose !== "visit_photo" && purpose !== "idea_photo" && purpose !== "idea_voice") throw new AppMediaError("Unknown upload type.");
  const allowed = purpose === "idea_voice" ? AUDIO_TYPES : IMAGE_TYPES;
  const type = String(contentType || "").split(";")[0].trim();
  if (!allowed.includes(type)) throw new AppMediaError(purpose === "idea_voice" ? "That audio format isn't supported." : "Use a photo (JPG, PNG, WebP or HEIC).");
  if (typeof size === "number" && size > MAX_MEDIA_BYTES) throw new AppMediaError("That file is larger than 10 MB.");
  const ext = type.split("/")[1].replace("mpeg", "mp3").replace("jpeg", "jpg");
  const path = staffId + "/" + purpose + "/" + Date.now() + "-" + crypto.randomBytes(6).toString("hex") + "." + ext;
  const { data, error } = await getServiceClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return { path: data.path, signedUrl: data.signedUrl };
}

// A path is only accepted if this person's own upload call could have
// minted it.
export function ownMediaPath(staffId, path, purpose) {
  return typeof path === "string" && path.startsWith(staffId + "/" + purpose + "/") && !path.includes("..") && path.length < 300;
}

export async function signedMediaUrls(paths) {
  const list = (paths || []).filter(Boolean);
  if (list.length === 0) return new Map();
  const { data, error } = await getServiceClient().storage.from(BUCKET).createSignedUrls(list, READ_TTL_SECONDS);
  if (error) {
    console.error("[perf-app] signed media URLs failed: " + error.message);
    return new Map();
  }
  return new Map((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}
