import "server-only";
import { erpList, erpListAll, erpGet, isErpConfigured } from "@/lib/erp/client";

// ---------------------------------------------------------------------------
// Farm Alert Performance App — every ERPNext read the app makes, in one
// place. READ ONLY: no erpCreate/erpUpdate import exists here, by design
// (CLAUDE.md Addendum D/F). Tasks tick and reports fill from what ERPNext
// already records; nothing the app does is ever written back.
//
// Timeouts, GET retries and outage alerts come from lib/erp/client.js
// (CLAUDE.md Section 10). Callers treat a failed read as "not ticked yet /
// figure unavailable", never as zero and never as a crash — the 15-minute
// job simply tries again.
//
// "This user" (spec 5): each rule names which ERPNext identity to match —
// the record owner (perf_staff.erp_user), the Sales Person on a sales
// document's Sales Team (erp_sales_person), or the Employee. A staff member
// with that id unset simply has nothing to match yet.
// ---------------------------------------------------------------------------

const DATETIME_FIELDS = new Set(["creation", "modified"]);
const SAFE_FIELD = /^[A-Za-z_][A-Za-z0-9_ .]*$/;
const MAX_PAGES = 10;

export function erpAvailable() {
  return isErpConfigured();
}

function identityFor(staff, ref) {
  if (ref === "erp_user") return staff.erpUser;
  if (ref === "erp_sales_person") return staff.erpSalesPerson;
  if (ref === "erp_employee") return staff.erpEmployee;
  return null;
}

function fieldFilter(field, op, value) {
  if (!SAFE_FIELD.test(field)) throw new Error("Invalid ERPNext field name: " + field);
  const dot = field.indexOf(".");
  if (dot > 0) return [field.slice(0, dot), field.slice(dot + 1), op, value];
  return [field, op, value];
}

function dateFilters(dateField, from, to) {
  if (DATETIME_FIELDS.has(dateField)) {
    return [fieldFilter(dateField, ">=", from + " 00:00:00"), fieldFilter(dateField, "<=", to + " 23:59:59")];
  }
  return [fieldFilter(dateField, ">=", from), fieldFilter(dateField, "<=", to)];
}

function cleanConditions(conditions) {
  if (!Array.isArray(conditions)) return [];
  return conditions.filter((c) => Array.isArray(c) && (c.length === 3 || c.length === 4)).map((c) => (c.length === 3 ? fieldFilter(c[0], c[1], c[2]) : c));
}

// Measures one ERPNext rule for a person over [from, to] (inclusive dates).
// Returns { measured, compliant, refs } or { unavailable: reason }.
export async function measureErpRule(rule, staff, from, to) {
  if (!isErpConfigured()) return { unavailable: "ERPNext isn't connected" };
  const who = identityFor(staff, rule.user_ref);
  if (!who) return { unavailable: "ERPNext " + (rule.user_ref || "user").replace("erp_", "").replace("_", " ") + " not linked" };

  const base = [...cleanConditions(rule.conditions), fieldFilter(rule.user_field, "=", who), ...dateFilters(rule.date_field, from, to)];
  const fields = ["name"];
  if (rule.measure === "sum" && rule.measure_field) {
    if (!SAFE_FIELD.test(rule.measure_field)) throw new Error("Invalid measure field");
    fields.push(rule.measure_field);
  }

  const rows = await erpListAll(rule.doctype_name, { filters: base, fields, pageSize: 200, maxPages: MAX_PAGES });
  // A child-table filter can return the parent once per matching child row.
  const unique = new Map();
  rows.forEach((r) => unique.set(r.name, r));
  const list = [...unique.values()];
  const refs = list.slice(0, 50).map((r) => ({ doctype: rule.doctype_name, name: r.name }));

  let measured = rule.measure === "sum" ? list.reduce((s, r) => s + (Number(r[rule.measure_field]) || 0), 0) : list.length;
  let compliant = null;
  if (rule.done_when === "all_compliant") {
    const extra = cleanConditions(rule.compliant_conditions);
    const ok = extra.length ? await erpListAll(rule.doctype_name, { filters: [...base, ...extra], fields: ["name"], pageSize: 200, maxPages: MAX_PAGES }) : list;
    compliant = new Set(ok.map((r) => r.name)).size;
    measured = list.length;
  }
  return { measured, compliant, refs };
}

// Outstanding on invoices due today for this Sales Person's Customers —
// the "amount due today" a Collect-payments task is measured against.
export async function invoicesDueToday(staff, date) {
  if (!isErpConfigured() || !staff.erpSalesPerson) return null;
  const rows = await erpListAll("Sales Invoice", {
    filters: [
      ["docstatus", "=", 1],
      ["due_date", "=", date],
      ["outstanding_amount", ">", 0],
      ["Sales Team", "sales_person", "=", staff.erpSalesPerson],
    ],
    fields: ["name", "customer", "customer_name", "outstanding_amount", "due_date", "contact_mobile"],
    pageSize: 200,
    maxPages: 5,
  });
  const unique = new Map();
  rows.forEach((r) => unique.set(r.name, r));
  const list = [...unique.values()];
  return {
    total: list.reduce((s, r) => s + (Number(r.outstanding_amount) || 0), 0),
    invoices: list.slice(0, 30).map((r) => ({
      name: r.name,
      customer: r.customer,
      customerName: r.customer_name || r.customer,
      outstanding: Number(r.outstanding_amount) || 0,
      phone: r.contact_mobile || null,
    })),
  };
}

export async function openLeadsFor(staff) {
  if (!isErpConfigured() || !staff.erpUser) return [];
  const rows = await erpList("Lead", {
    filters: [
      ["status", "in", ["Lead", "Open", "Replied", "Interested"]],
      ["lead_owner", "=", staff.erpUser],
    ],
    fields: ["name", "lead_name", "company_name", "mobile_no", "status", "creation"],
    orderBy: "creation desc",
    limit: 20,
  });
  return rows.map((r) => ({ name: r.name, title: r.company_name || r.lead_name || r.name, phone: r.mobile_no || null, status: r.status }));
}

// Partner search for Log a visit (spec 04): Customers by name, plus this
// person's own open Leads.
export async function searchVisitPartners(staff, q) {
  if (!isErpConfigured()) return [];
  const term = String(q || "").trim().slice(0, 80);
  const custFilters = [["disabled", "=", 0]];
  if (term) custFilters.push(["customer_name", "like", "%" + term + "%"]);
  const leadFilters = [["status", "in", ["Lead", "Open", "Replied", "Interested"]]];
  if (term) leadFilters.push(["lead_name", "like", "%" + term + "%"]);
  if (staff.erpUser) leadFilters.push(["lead_owner", "=", staff.erpUser]);

  const [customers, leads] = await Promise.all([
    erpList("Customer", { filters: custFilters, fields: ["name", "customer_name", "territory"], limit: 25, orderBy: "modified desc" }),
    staff.erpUser
      ? erpList("Lead", { filters: leadFilters, fields: ["name", "lead_name", "company_name"], limit: 10, orderBy: "modified desc" }).catch(() => [])
      : Promise.resolve([]),
  ]);
  return [
    ...customers.map((c) => ({ type: "customer", id: c.name, name: c.customer_name || c.name, area: c.territory || null })),
    ...leads.map((l) => ({ type: "lead", id: l.name, name: l.company_name || l.lead_name || l.name, area: "Lead" })),
  ];
}

export async function getPartnerName(type, id) {
  if (!isErpConfigured() || !id) return null;
  const doc = await erpGet(type === "lead" ? "Lead" : "Customer", id);
  if (!doc) return null;
  return type === "lead" ? doc.company_name || doc.lead_name || doc.name : doc.customer_name || doc.name;
}

// The Partner's saved map pin (spec 4: Customer custom fields latitude and
// longitude). Field names vary by instance, so both spellings are read.
export async function getCustomerPin(customerId) {
  if (!isErpConfigured() || !customerId) return null;
  const doc = await erpGet("Customer", customerId);
  if (!doc) return null;
  const lat = Number(doc.latitude ?? doc.custom_latitude);
  const lng = Number(doc.longitude ?? doc.custom_longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

// Today's Sales Orders / Invoices for a Customer, to link to a visit.
export async function ordersForCustomer(customerId, date) {
  if (!isErpConfigured() || !customerId) return [];
  const [orders, invoices] = await Promise.all([
    erpList("Sales Order", {
      filters: [["customer", "=", customerId], ["docstatus", "<", 2], ["transaction_date", "=", date]],
      fields: ["name", "grand_total", "docstatus"],
      limit: 10,
    }),
    erpList("Sales Invoice", {
      filters: [["customer", "=", customerId], ["docstatus", "<", 2], ["posting_date", "=", date]],
      fields: ["name", "grand_total", "docstatus"],
      limit: 10,
    }),
  ]);
  return [
    ...orders.map((o) => ({ doctype: "Sales Order", name: o.name, total: Number(o.grand_total) || 0 })),
    ...invoices.map((i) => ({ doctype: "Sales Invoice", name: i.name, total: Number(i.grand_total) || 0 })),
  ];
}

// Server-side check that a linked order really belongs to that Customer —
// a visit can't count as productive on someone else's order.
export async function verifyOrderForCustomer(doctype, name, customerId) {
  if (!isErpConfigured() || !name || !customerId) return false;
  const doc = await erpGet(doctype, name);
  return !!doc && doc.customer === customerId && doc.docstatus !== 2;
}

// Leave and holidays (spec 6.3: the 05:00 plan skips leave days and
// holidays). Holiday lists are cached per run — one ERPNext read per list,
// not per person. Returns { off: boolean, known: boolean }: known=false
// means ERPNext couldn't tell us (not linked / not reachable).
export async function offDayInfo(staff, date, cache = new Map()) {
  if (!isErpConfigured() || !staff.erpEmployee) return { off: false, known: false };
  try {
    const leave = await erpList("Leave Application", {
      filters: [
        ["employee", "=", staff.erpEmployee],
        ["status", "=", "Approved"],
        ["docstatus", "=", 1],
        ["from_date", "<=", date],
        ["to_date", ">=", date],
      ],
      fields: ["name"],
      limit: 1,
    });
    if (leave.length) return { off: true, known: true, reason: "leave" };

    const emp = await erpGet("Employee", staff.erpEmployee, { cacheSeconds: 3600 });
    const listName = emp?.holiday_list;
    if (!listName) return { off: false, known: true };
    if (!cache.has(listName)) {
      const doc = await erpGet("Holiday List", listName, { cacheSeconds: 3600 });
      cache.set(listName, new Set((doc?.holidays || []).map((h) => String(h.holiday_date).slice(0, 10))));
    }
    return { off: cache.get(listName).has(date), known: true, reason: "holiday" };
  } catch (err) {
    console.error("[perf-app] leave/holiday check failed for " + staff.id + ": " + err.message);
    return { off: false, known: false };
  }
}
