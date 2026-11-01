import "server-only";
import { getServiceClient } from "./serviceClient";
import { ownMediaPath, signedMediaUrls } from "./perf-app-media";
import { evaluateAutoTasks } from "./perf-app-tasks";
import { lagosDate, addDays, distanceMetres, visitIsProductive, VISIT_OUTCOMES, PRODUCTIVE_RADIUS_M, isFieldRole, monthOf, monthPhase } from "../perf/app-core";
import { searchVisitPartners, getCustomerPin, getPartnerName, ordersForCustomer, verifyOrderForCustomer, erpAvailable } from "../perf/app-erp";

// ---------------------------------------------------------------------------
// Farm Alert Performance App — field visits (spec 4 FA Visit, screen 04).
//
// - Idempotent on client_id: a visit queued offline and retried any number
//   of times is stored once, with the phone's original time and location
//   (acceptance check 11.1).
// - Distance from the Partner's saved pin and "productive" are decided
//   here, on the server, never trusted from the phone. A linked order must
//   really belong to that Customer in ERPNext.
// - Location is only what the phone captured when Log a visit was opened —
//   never a background trail (spec 10.3).
// ---------------------------------------------------------------------------

export class AppVisitError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "AppVisitError";
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERP_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,139}$/;

function num(v, min, max) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function shapeVisit(v, urls) {
  return {
    id: v.id,
    clientId: v.client_id,
    partner: v.partner_name || v.erp_customer || v.erp_lead,
    customer: v.erp_customer,
    lead: v.erp_lead,
    time: v.visit_time,
    date: v.visit_date,
    distanceM: v.distance_from_pin_m === null ? null : Number(v.distance_from_pin_m),
    farFromPin: v.far_from_pin,
    farApproved: v.far_approved,
    outcomes: v.outcomes || [],
    salesOrder: v.sales_order,
    salesInvoice: v.sales_invoice,
    productive: v.productive,
    notes: v.notes,
    photos: (v.photo_paths || []).map((p) => (urls ? urls.get(p) || null : null)).filter(Boolean),
  };
}

export async function partnersForVisit(staff, q) {
  if (!isFieldRole(staff)) throw new AppVisitError("Log a visit is for field roles.", 403);
  const sb = getServiceClient();
  const since = addDays(lagosDate(), -30);
  const { data } = await sb
    .from("perf_visits")
    .select("erp_customer, erp_lead, partner_name, visit_time")
    .eq("staff_id", staff.id)
    .gte("visit_date", since)
    .order("visit_time", { ascending: false })
    .limit(40);
  const recent = [];
  const seen = new Set();
  for (const v of data || []) {
    const id = v.erp_customer || v.erp_lead;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    recent.push({ type: v.erp_customer ? "customer" : "lead", id, name: v.partner_name || id, area: "Visited recently", recent: true });
  }
  const term = String(q || "").trim().toLowerCase();
  let results = [];
  try {
    results = await searchVisitPartners(staff, q);
  } catch (err) {
    console.error("[perf-app] partner search failed: " + err.message);
  }
  const recentMatches = term ? recent.filter((r) => r.name.toLowerCase().includes(term)) : recent.slice(0, 8);
  const rest = results.filter((r) => !seen.has(r.id));
  return { erpConnected: erpAvailable(), partners: [...recentMatches, ...rest].slice(0, 40) };
}

export async function visitContext(staff, { customer, date }) {
  if (!isFieldRole(staff)) throw new AppVisitError("Log a visit is for field roles.", 403);
  const d = date || lagosDate();
  if (!customer || !ERP_NAME.test(customer)) return { pin: null, orders: [] };
  const [pin, orders] = await Promise.all([
    getCustomerPin(customer).catch(() => null),
    ordersForCustomer(customer, d).catch(() => []),
  ]);
  return { pin, orders, radiusM: PRODUCTIVE_RADIUS_M };
}

export async function logVisit(staff, p) {
  if (!isFieldRole(staff)) throw new AppVisitError("Log a visit is for field roles. Ask HR if you do field visits.", 403);
  const clientId = String(p.client_id || "");
  if (!UUID.test(clientId)) throw new AppVisitError("Missing visit id.");

  const sb = getServiceClient();
  const { data: existing } = await sb.from("perf_visits").select("*").eq("client_id", clientId).maybeSingle();
  if (existing) {
    if (existing.staff_id !== staff.id) throw new AppVisitError("Visit id already used.", 409);
    return { ok: true, duplicate: true, visit: shapeVisit(existing) };
  }

  const customer = p.customer ? String(p.customer).trim() : null;
  const lead = p.lead ? String(p.lead).trim() : null;
  if (!customer && !lead) throw new AppVisitError("Choose the Partner you visited.");
  if ((customer && !ERP_NAME.test(customer)) || (lead && !ERP_NAME.test(lead))) throw new AppVisitError("Invalid Partner.");

  const t = new Date(p.visit_time);
  if (Number.isNaN(t.getTime())) throw new AppVisitError("Invalid visit time.");
  if (t.getTime() > Date.now() + 5 * 60 * 1000) throw new AppVisitError("Visit time is in the future.");
  const visitDate = lagosDate(t);
  if (visitDate < addDays(lagosDate(), -7)) throw new AppVisitError("This visit is more than 7 days old and can't be added.", 409);
  if (monthPhase(monthOf(visitDate)) === "locked") throw new AppVisitError("That month is locked. Ask HR to add it.", 409);

  const lat = num(p.lat, -90, 90);
  const lng = num(p.lng, -180, 180);
  const accuracy = num(p.accuracy, 0, 100000);
  const outcomes = [...new Set((Array.isArray(p.outcomes) ? p.outcomes : []).filter((o) => VISIT_OUTCOMES.includes(o)))];
  if (outcomes.length === 0) throw new AppVisitError("Choose at least one outcome.");

  let salesOrder = p.sales_order ? String(p.sales_order).trim() : null;
  let salesInvoice = p.sales_invoice ? String(p.sales_invoice).trim() : null;
  if ((salesOrder && !ERP_NAME.test(salesOrder)) || (salesInvoice && !ERP_NAME.test(salesInvoice))) throw new AppVisitError("Invalid order.");
  if ((salesOrder || salesInvoice) && !customer) throw new AppVisitError("Orders can only be linked to a Customer visit.");
  if (salesOrder || salesInvoice) {
    try {
      const ok = salesOrder ? await verifyOrderForCustomer("Sales Order", salesOrder, customer) : await verifyOrderForCustomer("Sales Invoice", salesInvoice, customer);
      if (!ok) throw new AppVisitError("That order isn't for this Partner.");
    } catch (err) {
      if (err instanceof AppVisitError) throw err;
      // ERPNext unreachable: keep the link; the supervisor can still see it.
      console.error("[perf-app] order check failed, keeping link: " + err.message);
    }
  }

  const photos = (Array.isArray(p.photos) ? p.photos : []).slice(0, 3);
  if (!photos.every((ph) => ownMediaPath(staff.id, ph, "visit_photo"))) throw new AppVisitError("Invalid photo.");

  let distance = null;
  let partnerName = null;
  try {
    const [pin, name] = await Promise.all([customer ? getCustomerPin(customer) : null, getPartnerName(customer ? "customer" : "lead", customer || lead)]);
    partnerName = name;
    if (pin && lat !== null && lng !== null) distance = distanceMetres(lat, lng, pin.lat, pin.lng);
  } catch (err) {
    console.error("[perf-app] visit pin lookup failed: " + err.message);
  }
  if (!partnerName) partnerName = String(p.partner_name || customer || lead).slice(0, 140);

  const far = distance !== null && distance > PRODUCTIVE_RADIUS_M;
  const row = {
    staff_id: staff.id,
    client_id: clientId,
    erp_customer: customer,
    erp_lead: customer ? null : lead,
    partner_name: partnerName,
    visit_time: t.toISOString(),
    visit_date: visitDate,
    latitude: lat,
    longitude: lng,
    accuracy_m: accuracy,
    distance_from_pin_m: distance,
    far_from_pin: far,
    outcomes,
    sales_order: salesOrder,
    sales_invoice: salesInvoice,
    photo_paths: photos,
    notes: p.notes ? String(p.notes).slice(0, 1000) : null,
    productive: visitIsProductive({ salesOrder, salesInvoice, distanceM: distance, farApproved: false }),
  };
  const { data, error } = await sb.from("perf_visits").insert(row).select("*").single();
  if (error) {
    if (error.code === "23505") {
      const { data: again } = await sb.from("perf_visits").select("*").eq("client_id", clientId).maybeSingle();
      if (again && again.staff_id === staff.id) return { ok: true, duplicate: true, visit: shapeVisit(again) };
    }
    throw error;
  }

  try {
    await evaluateAutoTasks(staff, visitDate);
  } catch (err) {
    console.error("[perf-app] post-visit evaluation failed: " + err.message);
  }
  return { ok: true, visit: shapeVisit(data) };
}

export async function listVisits(staffId, date) {
  const { data, error } = await getServiceClient().from("perf_visits").select("*").eq("staff_id", staffId).eq("visit_date", date).order("visit_time");
  if (error) throw error;
  const urls = await signedMediaUrls((data || []).flatMap((v) => v.photo_paths || []));
  return (data || []).map((v) => shapeVisit(v, urls));
}

// Supervisor approves a visit more than 300 m from the pin, so it can count
// as productive (spec 4: "within 300 m (or approved)").
export async function approveFarVisit(me, visitId) {
  if (!UUID.test(visitId || "")) throw new AppVisitError("Visit not found.", 404);
  const sb = getServiceClient();
  const { data: v, error } = await sb.from("perf_visits").select("*, staff:perf_staff!perf_visits_staff_id_fkey(id, reports_to)").eq("id", visitId).maybeSingle();
  if (error) throw error;
  if (!v) throw new AppVisitError("Visit not found.", 404);
  if (v.staff?.reports_to !== me.id && !me.isAdmin && me.accessLevel !== "admin") throw new AppVisitError("Only their line manager can approve this visit.", 403);
  if (monthPhase(monthOf(v.visit_date)) === "locked") throw new AppVisitError("That month is locked.", 409);
  const productive = visitIsProductive({ salesOrder: v.sales_order, salesInvoice: v.sales_invoice, distanceM: v.distance_from_pin_m, farApproved: true });
  const { error: upErr } = await sb.from("perf_visits").update({ far_approved: true, productive }).eq("id", visitId);
  if (upErr) throw upErr;
  return { ok: true };
}
