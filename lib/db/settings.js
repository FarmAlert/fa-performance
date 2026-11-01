import "server-only";
import { getServiceClient } from "./serviceClient";

// Reads the shared app_settings table for the one key this app needs:
// perf_cluster_weights (set on VetXpress → Admin → Performance → Scoring
// weights), so cluster scores here use the same weights as the dashboard.
// Short in-memory cache; on a read failure, the last good value, then {}
// (the code defaults in lib/perf/scoring.js).
const TTL_MS = 60 * 1000;
let cached = null;
let cachedAt = 0;

export async function getAppSettings() {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  try {
    const { data, error } = await getServiceClient().from("app_settings").select("key, value").eq("key", "perf_cluster_weights");
    if (error) throw error;
    cached = { perf_cluster_weights: data?.[0]?.value || {} };
    cachedAt = Date.now();
    return cached;
  } catch (err) {
    console.error("[db] settings read failed, using defaults: " + err.message);
    return cached || { perf_cluster_weights: {} };
  }
}
