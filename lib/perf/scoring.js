// Farm Alert Performance System — cluster definitions, daily/monthly log
// field schemas, and the 8 scoring formulas, ported near-verbatim from the
// standalone Firebase prototype (Isaac's "PMS Phase 1 Framework"). Pure JS
// math over plain arrays — no Firebase, no Supabase, no React — so the same
// module is shared with VetXpress (lib/perf/scoring.js there drives the widget routes and the
// VetXpress admin dashboard (app/admin/performance/*).
//
// Callers must pass `logs` shaped like { personId, personName, outlet,
// cluster, date, ...clusterFields } and `monthlyInputs` keyed by
// "<staffId>|<YYYY-MM>" — see lib/db/perf-staff.js's getLogsForScoring/
// getMonthlyInputsForScoring, which reshape Supabase rows into exactly this
// shape so this file never has to know about the database.

export const CLUSTERS = [
  "Outlet Leadership",
  "Sales & Marketing",
  "Store",
  "Fulfilment",
  "Experience",
  "Production",
  "Support/Admin",
  "Veterinary/Clinical",
  "Technology & Media",
  "Technology & Media Leadership",
  "Internal Audit",
  "Internal Audit Leadership",
  "Brand Leadership",
  "Experience Leadership",
  "Impact",
  "Accounts",
  "Accounts Leadership",
  "Operations & Procurement Leadership",
];

export const OUTLET_REGION = {
  ABUJA: "South",
  IBADAN: "South",
  LAGOS: "South",
  PHC: "South",
  KANO: "North",
  GEMBU: "North",
  YOLA: "North",
  MONROVIA: "International",
};

// perf_staff.outlet's literal stored value for HQ/functional-cluster staff
// with no physical outlet of their own (migrations 098/099) — a code, not
// something meant to be read by a human. Display-only: outletLabel() never
// changes what's stored, grouped, or filtered on anywhere else in this
// system (RollupGroups/CeoDashboardView group by the raw code exactly as
// before) — it only swaps the rendered text. Any outlet not listed here —
// every real, physical outlet (ABUJA, LAGOS, ...) — passes through
// unchanged, same "clean for display only, never rewrite the source"
// principle CLAUDE.md's Addendum K established for cityDisplayName().
export const OUTLET_LABELS = {
  TECH_MEDIA: "Technology & Media (HQ)",
  AUDIT: "Internal Audit (HQ)",
  ACCOUNTS: "Accounts (HQ)",
  CENTRAL: "Head Office",
};
// Canonical outlet code: trimmed, upper-case. The roster picked up mixed
// spellings of the same outlet ("Lagos" vs "LAGOS", "Central" vs "CENTRAL")
// from registrations and hand edits, which split one outlet into two on
// every dashboard. Writes are normalized with this (lib/db/perf-staff.js,
// migration 118 fixes existing rows) and reads group by it too.
export function outletKey(outlet) {
  return String(outlet || "").trim().toUpperCase();
}
export function outletLabel(outlet) {
  return OUTLET_LABELS[outlet] || OUTLET_LABELS[outletKey(outlet)] || outlet;
}

export const REGION_DIRECTOR = {
  South: "Dr. Ayo Awilagbara — Director of Sales, Southern Nigeria",
  North: "Dr. Janet Maiyaki — Director of Sales, Northern Nigeria",
  International: "Dr. Tosin Poroye — Director of Int'l Sales, West Africa",
};

// VP/Function View rollup owner per cluster — deliberately mirrors each cluster's real computed
// scoring dependency (see the scoreXxxLeadership functions below), not a flat "everyone but Sales
// & Marketing goes to the COO" default. Isaac's Technology & Media Leadership score already feeds
// 50% of Jeremiah's own Brand Leadership score (Jeremiah is the overall team lead Isaac deputizes
// for, per Isaac Wada's 1 Sep 2026 clarification) — so the whole Technology, Media & Brand group
// (Isaac's team included) rolls up to Jeremiah here, not to Isaac or the COO. Same reasoning for
// Internal Audit -> Monday, Experience -> Zachariah (company-wide, not just his own outlet — see
// scoreExperienceLeadership's own comment), and Accounts -> Ndubuisi. Every cluster with no
// distinct departmental VP of its own (Outlet Leadership, Store, Fulfilment, Support/Admin,
// Production, Veterinary/Clinical, Impact, and Ijeoma's own Operations & Procurement Leadership)
// stays under Ijeoma as COO, matching her real company-wide Outlet Leadership team rollup.
export const CLUSTER_VP = (c) => {
  switch (c) {
    case "Sales & Marketing":
      return "Nancy Eni-Otu — VP Sales & Marketing";
    case "Technology & Media":
    case "Technology & Media Leadership":
    case "Brand Leadership":
      return "Jeremiah Shiaka — VP, Brand & Corporate Communication";
    case "Internal Audit":
    case "Internal Audit Leadership":
      return "Monday Negedu — Chief Internal Auditor";
    case "Experience":
    case "Experience Leadership":
      return "Zachariah Precious — Experience Manager";
    case "Accounts":
    case "Accounts Leadership":
      return "Ndubuisi Ndulue — Accounts Manager";
    default:
      return "Onwuka Ijeoma Precious — COO";
  }
};

// Store (warehouse) sits organizationally under Operations, so it shares Outlet Leadership's
// "routine / system improvement / warehouse arrangement" log shape. Fulfilment is the delivery
// team — separate from Store — scored on delivery completion, not warehouse tasks. VetXpress
// order/delivery tracking stays with Experience (formerly Customer Satisfaction) since that's
// the customer-facing team and VetXpress serves the end customer directly.
export const KPI_LABELS = {
  "Outlet Leadership": ["Revenue vs Target (30%)", "Warehouse Organization (15%)", "Stock Audit Accuracy (20%)", "Team Score (15%)", "Attendance (10%)", "Initiative (10%)"],
  "Sales & Marketing": ["Revenue vs Target (35%)", "New Partner Acquisition (20%)", "Collections Health (15%)", "Market Coverage (15%)", "Product Mix (15%)"],
  Store: ["Warehouse Organization (35%)", "Stock Audit Accuracy (30%)", "Inventory Turnover (20%)", "Initiative (15%)"],
  Fulfilment: ["On-Time Delivery Rate (50%)", "Failed Delivery Control (30%)", "Vehicle/Route Incident-Free (20%)"],
  Experience: ["CSAT Score (25%)", "Complaint Resolution (20%)", "Order Fulfilment SLA (20%)", "VetXpress Delivery SLA (15%)", "Repeat Rate (10%)", "Response Time (10%)"],
  Production: ["Output vs Plan (30%)", "Quality/Rejection (25%)", "Cost per Unit (20%)", "Downtime & Safety (25%)"],
  "Support/Admin": ["Task Completion (35%)", "Attendance (30%)", "Supervisor Rating (20%)", "Safety Record (15%)"],
  "Veterinary/Clinical": ["Case Load vs Capacity (25%)", "Treatment Outcome Rate (35%)", "Clinical Revenue vs Target (40%)"],
  "Technology & Media": [
    "IT Reliability & Backups (up to 30%)",
    "Bug/Change Throughput (up to 25%)",
    "On-Ground Technical (up to 20%)",
    "Creative/Media Output (up to 25%) — weights renormalize to whichever work areas were actually logged that month",
  ],
  "Technology & Media Leadership": ["Team Score (40%)", "Oversight Activity (30%)", "Policy Compliance (20%)", "Training/Onboarding (10%)"],
  "Internal Audit": ["Outlet Coverage (60%)", "Audit Frequency/Consistency (40%)"],
  "Internal Audit Leadership": ["Team Score — Chinenye's audit coverage (60%)", "Own Review Activity (40%)"],
  "Brand Leadership": ["Team Score — Isaac's Technology & Media score (50%)", "Own Creative Output: adverts + flyers (50%)"],
  "Experience Leadership": ["Team Score — company-wide Experience average (70%)", "Own Oversight Activity (30%)"],
  Impact: [
    "Agrovet Stores Served (16.7%)",
    "Direct Jobs Created (16.7%)",
    "Vet Jobs via Empowerment Initiative (16.7%)",
    "Training Certificates Issued (16.7%)",
    "Vets/Healthcare Professionals/Farmers Trained (16.7%)",
    "Awareness Campaigns Conducted (16.7%)",
  ],
  Accounts: ["Processing Volume (60%)", "Reconciliation Activity (40%)"],
  "Accounts Leadership": ["Team Score — Raphael's accounts processing (60%)", "Own Review/Approval Activity (40%)"],
  "Operations & Procurement Leadership": [
    "Team Score — company-wide Outlet Leadership average (50%)",
    "Procurement Activity (30%)",
    "Operations Oversight Activity (20%)",
  ],
};

// Every cluster's real, live weight array — same order as that cluster's
// own KPI_LABELS entries above (and the `kpis` array each scoreXxx()
// function below builds). This is the single source of truth the scoring
// functions actually compute with; KPI_LABELS' own baked-in "(35%)" text
// is just documentation of these SAME numbers at the time it was written —
// once an admin overrides a cluster's weights (app/admin/performance/
// scoring, gated on the managePerformanceScoring permission), the label
// text elsewhere is not live-updated to match (a known, deliberate scope
// limit — see that page's own comment) but the actual math always uses
// whatever resolveWeights() below resolves to.
export const DEFAULT_WEIGHTS = {
  "Outlet Leadership": [0.3, 0.15, 0.2, 0.15, 0.1, 0.1],
  "Sales & Marketing": [0.35, 0.2, 0.15, 0.15, 0.15],
  Store: [0.35, 0.3, 0.2, 0.15],
  Fulfilment: [0.5, 0.3, 0.2],
  Experience: [0.25, 0.2, 0.2, 0.15, 0.1, 0.1],
  Production: [0.3, 0.25, 0.2, 0.25],
  "Support/Admin": [0.35, 0.3, 0.2, 0.15],
  "Veterinary/Clinical": [0.25, 0.35, 0.4],
  // Positional, not sequential-as-logged: index 0 = IT Systems/Uptime &
  // Backups, 1 = Bug Tracking & ERPNext Support, 2 = On-Ground Technical,
  // 3 = Media Production/AI Media & Design — scoreTechMedia() below only
  // ever includes the weight for a work area actually logged that month,
  // then renormalizes across whichever of these were active, so these four
  // are relative priorities among active areas, not a fixed 100% split.
  "Technology & Media": [0.3, 0.25, 0.2, 0.25],
  "Technology & Media Leadership": [0.4, 0.3, 0.2, 0.1],
  "Internal Audit": [0.6, 0.4],
  "Internal Audit Leadership": [0.6, 0.4],
  "Brand Leadership": [0.5, 0.5],
  "Experience Leadership": [0.7, 0.3],
  Impact: [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6],
  Accounts: [0.6, 0.4],
  "Accounts Leadership": [0.6, 0.4],
  "Operations & Procurement Leadership": [0.5, 0.3, 0.2],
};

// Resolves the effective weight array for a cluster: an admin-set override
// (app_settings' perf_cluster_weights key, lib/db/settings.js) when one
// exists and is structurally valid for this cluster, DEFAULT_WEIGHTS
// otherwise. Validated defensively here (not just at write time) so a
// corrupted or stale settings row degrades to the known-good default
// rather than silently miscomputing everyone's score — same "a config
// outage falls back to code defaults" principle lib/db/settings.js's own
// getAppSettings() already documents. Real input validation (numbers,
// non-negative, summing to ~100%) happens once, at write time
// (app/api/admin/performance/scoring-weights/route.js), so a bad save is
// never possible in the first place — this is a second, cheap safety net,
// not the primary guard.
export function resolveWeights(cluster, overrides) {
  const fallback = DEFAULT_WEIGHTS[cluster];
  const override = overrides ? overrides[cluster] : null;
  if (Array.isArray(override) && fallback && override.length === fallback.length && override.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) {
    return override;
  }
  return fallback;
}

export function defaultTargets(cluster) {
  switch (cluster) {
    case "Outlet Leadership":
      return { revenueTarget: 15000000 };
    case "Sales & Marketing":
      return { visitTarget: 40, callTarget: 20, revenueTarget: 3000000, newPartnerTarget: 4, budget: 60000 };
    case "Experience":
      return { responseTargetHrs: 4 };
    case "Production":
      return { monthlyPlanUnits: 5000, standardUnitCost: 500 };
    // Placeholder figures — Liberia has no baseline yet. Confirm real monthly case capacity and
    // revenue targets with Dr. Fortune Onomia before this cluster's scores mean anything.
    case "Veterinary/Clinical":
      return { caseCapacityTarget: 60, clinicalRevenueTarget: 2000000 };
    case "Technology & Media":
    case "Technology & Media Leadership":
    case "Internal Audit":
    case "Internal Audit Leadership":
    case "Brand Leadership":
    case "Experience Leadership":
    case "Accounts":
    case "Accounts Leadership":
    case "Operations & Procurement Leadership":
      return {};
    // 2026 goals not yet set — using 2025's actuals as a placeholder floor ("at least sustain
    // last year") from the BI Impact Metrics sheet. Replace with real 2026 targets once set —
    // these numbers read like lender/DFI impact covenants, so precision matters here.
    case "Impact":
      return {
        agrovetStoresGoal: 1031,
        directJobsGoal: 82,
        vetJobsGoal: 32,
        certificatesGoal: 1021,
        trainedGoal: 6802,
        campaignsGoal: 15,
      };
    default:
      return {};
  }
}

/* ---------------------------------------------------------
   DAILY LOG FIELD DEFINITIONS PER CLUSTER
--------------------------------------------------------- */
export const DAILY_FIELDS = {
  "Outlet Leadership": [
    { key: "focus", label: "Today's focus", type: "select", options: ["Routine Operations", "System Improvement"] },
    { key: "warehouseArrangement", label: "Warehouse arrangement today", type: "select", options: ["Excellent", "Good", "Fair", "Poor"] },
    { key: "note", label: "Note (what was improved / anything flagged)", type: "text", span2: true },
  ],
  "Sales & Marketing": [
    { key: "activityType", label: "Activity type", type: "select", options: ["Visit", "Call"] },
    { key: "partner", label: "Partner / outlet name", type: "text", span2: true },
    { key: "newOrRepeat", label: "New or repeat", type: "select", options: ["Repeat", "New"] },
    { key: "category", label: "Product category", type: "select", options: ["Nutrition", "Healthcare", "Other"] },
    { key: "outcome", label: "Outcome", type: "select", options: ["Order Placed", "Follow-up Needed", "No Interest", "Info Only"] },
    { key: "revenue", label: "Revenue generated (₦)", type: "number" },
    { key: "collections", label: "Collections received (₦)", type: "number" },
    { key: "transport", label: "Transport (₦)", type: "number" },
    { key: "airtime", label: "Airtime (₦)", type: "number" },
    { key: "lodging", label: "Lodging (₦)", type: "number" },
    { key: "meals", label: "Meals (₦)", type: "number" },
  ],
  Store: [
    { key: "focus", label: "Today's focus", type: "select", options: ["Routine Operations", "System Improvement"] },
    { key: "warehouseArrangement", label: "Warehouse arrangement today", type: "select", options: ["Excellent", "Good", "Fair", "Poor"] },
    { key: "stockReceived", label: "Stock received today (units)", type: "number" },
    { key: "stockDispatched", label: "Stock dispatched today (units)", type: "number" },
    { key: "note", label: "Note (what was improved / anything flagged)", type: "text", span2: true },
  ],
  Fulfilment: [
    { key: "deliveriesAttempted", label: "Deliveries attempted today", type: "number" },
    { key: "deliveriesOnTime", label: "Delivered on-time", type: "number" },
    { key: "failedDeliveries", label: "Failed / returned deliveries", type: "number" },
    { key: "vehicleIssue", label: "Vehicle or route issue today?", type: "select", options: ["No", "Yes"] },
    { key: "note", label: "Note (what happened, if any)", type: "text", span2: true },
  ],
  Experience: [
    { key: "complaintsReceived", label: "Complaints received", type: "number" },
    { key: "complaintsResolved", label: "Resolved same day", type: "number" },
    { key: "csatResponses", label: "CSAT responses collected", type: "number" },
    { key: "csatScoreSum", label: "Sum of CSAT scores (0-100 each)", type: "number" },
    { key: "repeatCustomers", label: "Repeat customers served", type: "number" },
    { key: "avgResponseHrs", label: "Avg. response time today (hrs)", type: "number" },
    { key: "ordersReceived", label: "Orders received today", type: "number" },
    { key: "ordersOnTime", label: "Orders fulfilled on-time", type: "number" },
    { key: "stockout", label: "Stockout affected a customer order?", type: "select", options: ["No", "Yes"] },
    { key: "vetOrders", label: "VetXpress orders (online store)", type: "number" },
    { key: "vetOnTime", label: "VetXpress delivered on-time", type: "number" },
  ],
  Production: [
    { key: "unitsProduced", label: "Units produced", type: "number" },
    { key: "unitsRejected", label: "Units rejected (QC fail)", type: "number" },
    { key: "costIncurred", label: "Production cost incurred (₦)", type: "number" },
    { key: "downtimeHours", label: "Downtime (hrs)", type: "number" },
    { key: "safetyIncident", label: "Safety incident?", type: "select", options: ["No", "Yes"] },
  ],
  "Support/Admin": [
    { key: "tasksAssigned", label: "Tasks assigned", type: "number" },
    { key: "tasksCompleted", label: "Tasks completed on-time", type: "number" },
    { key: "attendance", label: "Attendance", type: "select", options: ["Present", "Late", "Absent"] },
    { key: "safetyIncident", label: "Safety / conduct incident?", type: "select", options: ["No", "Yes"] },
  ],
  "Veterinary/Clinical": [
    { key: "casesSeen", label: "Cases seen / consulted today", type: "number" },
    { key: "casesClosed", label: "Cases closed today (treatment concluded)", type: "number" },
    { key: "casesClosedPositive", label: "Of those, positive outcome (recovered/resolved)", type: "number" },
    { key: "revenue", label: "Clinical revenue today (currency TBD — see note)", type: "number" },
    { key: "note", label: "Note (notable case, outbreak flag, etc.)", type: "text", span2: true },
  ],
  // "workArea" lets one shared form serve very different jobs (IT ops, on-ground technical,
  // creative/media) fairly — scoring only counts the KPI(s) matching whatever was actually
  // logged that day, so someone who never touches bug-tracking isn't penalized for a 0 there.
  "Technology & Media": [
    {
      key: "workArea",
      label: "Main work area today",
      type: "select",
      options: ["IT Systems / Uptime & Backups", "Bug Tracking & ERPNext Support", "On-Ground Technical (CCTV/Hardware)", "Media Production", "AI Media & Design"],
    },
    { key: "uptimeIncident", label: "Uptime incident today?", type: "select", options: ["No", "Yes"] },
    { key: "downtimeMinutes", label: "Downtime today (minutes)", type: "number" },
    { key: "backupCompleted", label: "Backup completed today?", type: "select", options: ["No", "Yes"] },
    { key: "bugsLogged", label: "Bugs logged today", type: "number" },
    { key: "bugsClosed", label: "Bugs closed today", type: "number" },
    { key: "cctvIncident", label: "CCTV / hardware incident today?", type: "select", options: ["No", "Yes"] },
    { key: "assetsProduced", label: "Media/creative assets produced today", type: "number" },
    { key: "assetsApproved", label: "Assets submitted for approval today", type: "number" },
    { key: "note", label: "Note", type: "text", span2: true },
  ],
  "Technology & Media Leadership": [
    { key: "approvalsGiven", label: "System / data-access approvals given today", type: "number" },
    { key: "bugsPrioritized", label: "Bugs reviewed & prioritized today", type: "number" },
    { key: "releaseExecuted", label: "Release executed today?", type: "select", options: ["No", "Yes"] },
    { key: "note", label: "Note", type: "text", span2: true },
  ],
  "Internal Audit": [
    { key: "auditedOutlet", label: "Outlet audited today", type: "select", options: ["ABUJA", "IBADAN", "GEMBU", "KANO", "LAGOS", "PHC", "YOLA", "MONROVIA"] },
    { key: "discrepanciesFound", label: "Discrepancies / variances found", type: "number" },
    { key: "auditResultPct", label: "Stock accuracy result (%) — for the record; doesn't yet feed the outlet's own monthly figure automatically", type: "number" },
    { key: "note", label: "Note", type: "text", span2: true },
  ],
  "Internal Audit Leadership": [
    { key: "findingsReviewed", label: "Audit findings reviewed today", type: "number" },
    { key: "complianceCheck", label: "Compliance check completed today?", type: "select", options: ["No", "Yes"] },
    { key: "note", label: "Note", type: "text", span2: true },
  ],
  "Brand Leadership": [
    { key: "advertVideosProduced", label: "Advert videos produced today", type: "number" },
    { key: "flyersProduced", label: "Flyers produced today", type: "number" },
    { key: "note", label: "Note", type: "text", span2: true },
  ],
  "Experience Leadership": [
    { key: "escalationsReviewed", label: "Customer escalations reviewed today", type: "number" },
    { key: "coachingSession", label: "Coaching / review session held today?", type: "select", options: ["No", "Yes"] },
    { key: "note", label: "Note", type: "text", span2: true },
  ],
  // The official 6 impact numbers are cumulative year-to-date totals (see Monthly Figures below),
  // not daily counts — this log is just for visibility into what activity is actually happening.
  Impact: [
    { key: "activityType", label: "Activity today", type: "select", options: ["Training Session", "Awareness Campaign", "Vet Placement Support", "Agrovet Store Onboarding Support", "Other"] },
    { key: "peopleTrained", label: "People trained (if training session)", type: "number" },
    { key: "certificatesIssued", label: "Certificates issued (if training session)", type: "number" },
    { key: "note", label: "Note", type: "text", span2: true },
  ],
  Accounts: [
    { key: "invoicesProcessed", label: "Invoices processed today", type: "number" },
    { key: "paymentsProcessed", label: "Payments processed today", type: "number" },
    { key: "reconciliationsCompleted", label: "Bank/account reconciliations completed today", type: "number" },
    { key: "discrepanciesFound", label: "Discrepancies / variances found today", type: "number" },
    { key: "note", label: "Note", type: "text", span2: true },
  ],
  "Accounts Leadership": [
    { key: "paymentsApproved", label: "Payments / invoices approved today", type: "number" },
    { key: "variancesReviewed", label: "Variances / discrepancies reviewed today", type: "number" },
    { key: "reportSubmitted", label: "Financial report/reconciliation submitted today?", type: "select", options: ["No", "Yes"] },
    { key: "note", label: "Note", type: "text", span2: true },
  ],
  // Ijeoma's role spans two distinct areas (procurement across every centre, and oversight of
  // every centre's own operations) — both logged on one form rather than a workArea gate, since
  // unlike Isaac's team (where each person specializes in one area), her role covers both daily.
  "Operations & Procurement Leadership": [
    { key: "poRaised", label: "Purchase orders raised today", type: "number" },
    { key: "poApproved", label: "Purchase orders approved today", type: "number" },
    { key: "suppliersEngaged", label: "Suppliers engaged / negotiated with today", type: "number" },
    { key: "stockoutsResolved", label: "Stockout escalations resolved today", type: "number" },
    { key: "outletsReviewed", label: "Outlets/centres reviewed or checked in on today", type: "number" },
    { key: "escalationsHandled", label: "Operational escalations handled today", type: "number" },
    { key: "note", label: "Note", type: "text", span2: true },
  ],
};

export const MONTHLY_ONLY_FIELDS = {
  "Outlet Leadership": [
    { key: "stockAuditPct", label: "Stock audit accuracy this month (%)", type: "number" },
    { key: "attendancePct", label: "Team attendance this month (%)", type: "number" },
  ],
  Store: [
    { key: "stockAuditPct", label: "Stock audit accuracy this month (%)", type: "number" },
    { key: "inventoryTurnoverPct", label: "Inventory turnover vs. benchmark (%)", type: "number" },
  ],
  "Support/Admin": [{ key: "supervisorRating", label: "Supervisor rating this month (1-5)", type: "number" }],
  "Technology & Media Leadership": [
    { key: "backupPolicyConfirmed", label: "Backup & recovery policy confirmed followed this month?", type: "select", options: ["No", "Yes"] },
    { key: "traineeOnboarded", label: "Interns/staff onboarded or trained this month", type: "number" },
  ],
  Impact: [
    { key: "agrovetStoresYTD", label: "Agrovet stores served (cumulative, year-to-date)", type: "number" },
    { key: "directJobsYTD", label: "Direct jobs created (cumulative, year-to-date)", type: "number" },
    { key: "vetJobsYTD", label: "Vet jobs via empowerment initiative (cumulative, year-to-date)", type: "number" },
    { key: "certificatesYTD", label: "Training certificates issued (cumulative, year-to-date)", type: "number" },
    { key: "trainedYTD", label: "Vets/healthcare professionals/farmers trained (cumulative, year-to-date)", type: "number" },
    { key: "campaignsYTD", label: "Awareness campaigns conducted (cumulative, year-to-date)", type: "number" },
  ],
};

// Which of a person's `targets` (jsonb) are meaningful and editable, per
// cluster — only listing the keys each cluster's own scoreXxx() function
// above actually reads. Store, Fulfilment, and Support/Admin never read
// person.targets at all (their scoring is pass/fail or ratio-based off the
// logs themselves), so they have no entry here and the admin UI shows
// nothing to edit for them, rather than a form for numbers nothing uses.
export const TARGET_FIELDS = {
  "Outlet Leadership": [{ key: "revenueTarget", label: "Outlet revenue target this month (₦)", type: "number" }],
  "Sales & Marketing": [
    { key: "visitTarget", label: "Visit target this month", type: "number" },
    { key: "callTarget", label: "Call target this month", type: "number" },
    { key: "revenueTarget", label: "Revenue target this month (₦)", type: "number" },
    { key: "newPartnerTarget", label: "New partner target this month", type: "number" },
    { key: "budget", label: "Monthly spend budget (₦)", type: "number" },
  ],
  Experience: [{ key: "responseTargetHrs", label: "Response time target (hrs)", type: "number" }],
  Production: [
    { key: "monthlyPlanUnits", label: "Monthly production plan (units)", type: "number" },
    { key: "standardUnitCost", label: "Standard cost per unit (₦)", type: "number" },
  ],
  "Veterinary/Clinical": [
    { key: "caseCapacityTarget", label: "Monthly case capacity target", type: "number" },
    { key: "clinicalRevenueTarget", label: "Monthly clinical revenue target (₦)", type: "number" },
  ],
  // Impact is the one new (31 Aug 2026) cluster whose score reads person.targets — the other six
  // (Technology & Media, its Leadership, Internal Audit, its Leadership, Brand Leadership,
  // Experience Leadership) are all activity/team-rollup scored, no targets to edit.
  Impact: [
    { key: "agrovetStoresGoal", label: "Agrovet stores served — 2026 goal", type: "number" },
    { key: "directJobsGoal", label: "Direct jobs created — 2026 goal", type: "number" },
    { key: "vetJobsGoal", label: "Vet jobs via empowerment initiative — 2026 goal", type: "number" },
    { key: "certificatesGoal", label: "Training certificates issued — 2026 goal", type: "number" },
    { key: "trainedGoal", label: "Vets/healthcare professionals/farmers trained — 2026 goal", type: "number" },
    { key: "campaignsGoal", label: "Awareness campaigns conducted — 2026 goal", type: "number" },
  ],
};

/* ---------------------------------------------------------
   HELPERS
--------------------------------------------------------- */
export function monthKey(dateStr) {
  if (!dateStr) return "";
  return String(dateStr).slice(0, 7);
}
function cap(x, m) {
  return Math.min(x, m === undefined ? 1.2 : m);
}
export function clamp0100(x) {
  return Math.max(0, Math.min(100, x));
}
export function ragOf(score) {
  if (score === null || score === undefined) return "muted";
  if (score >= 85) return "green";
  if (score >= 70) return "amber";
  return "red";
}
export function ragLabel(score) {
  if (score === null || score === undefined) return "No data";
  if (score >= 85) return "Green";
  if (score >= 70) return "Amber";
  return "Red";
}

/* ---------------------------------------------------------
   SCORING — mirrors PMS Phase 1 Framework weights
--------------------------------------------------------- */
function aggDaily(logs, personId, month) {
  return logs.filter((l) => l.personId === personId && monthKey(l.date) === month);
}

function scoreSalesMarketing(person, logs, month, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  if (rel.length === 0) return null;
  const t = person.targets || {};
  const visits = rel.filter((l) => l.activityType === "Visit").length;
  const calls = rel.filter((l) => l.activityType === "Call").length;
  const totalActivities = visits + calls;
  const newOutlets = rel.filter((l) => l.newOrRepeat === "New").length;
  const revenue = rel.reduce((s, l) => s + (Number(l.revenue) || 0), 0);
  const collections = rel.reduce((s, l) => s + (Number(l.collections) || 0), 0);
  const nhRevenue = rel.filter((l) => l.category === "Nutrition" || l.category === "Healthcare").reduce((s, l) => s + (Number(l.revenue) || 0), 0);
  const revenueAchv = t.revenueTarget ? revenue / t.revenueTarget : 0;
  const coverageTarget = (Number(t.visitTarget) || 0) + (Number(t.callTarget) || 0);
  const coverageAchv = coverageTarget ? totalActivities / coverageTarget : 0;
  const newPartnerAchv = t.newPartnerTarget ? newOutlets / t.newPartnerTarget : 0;
  const collectionsHealth = revenue ? Math.min(collections / revenue, 1) : collections > 0 ? 1 : 0;
  const productMix = revenue ? nhRevenue / revenue : 0;
  const kpis = [cap(revenueAchv) * 100, cap(newPartnerAchv) * 100, collectionsHealth * 100, cap(coverageAchv) * 100, productMix * 100];
  const weights = resolveWeights("Sales & Marketing", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: { visits, calls, revenue, collections, newOutlets } };
}

const WAREHOUSE_SCORE_MAP = { Excellent: 100, Good: 80, Fair: 55, Poor: 25 };

function scoreStore(person, logs, month, monthlyInputs, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  const mi = monthlyInputs[person.id + "|" + month] || {};
  if (rel.length === 0 && mi.stockAuditPct === undefined && mi.inventoryTurnoverPct === undefined) return null;
  const warehouseDays = rel.filter((l) => l.warehouseArrangement);
  const warehouseScore = warehouseDays.length ? warehouseDays.reduce((s, l) => s + (WAREHOUSE_SCORE_MAP[l.warehouseArrangement] || 0), 0) / warehouseDays.length : 0;
  const stockAccuracy = mi.stockAuditPct !== undefined ? Number(mi.stockAuditPct) : 0;
  const inventoryTurnover = mi.inventoryTurnoverPct !== undefined ? Number(mi.inventoryTurnoverPct) : 0;
  const improvementCount = rel.filter((l) => l.focus === "System Improvement").length;
  const initiativeScore = improvementCount >= 1 ? 100 : 0;
  const stockReceived = rel.reduce((s, l) => s + (Number(l.stockReceived) || 0), 0);
  const stockDispatched = rel.reduce((s, l) => s + (Number(l.stockDispatched) || 0), 0);
  const kpis = [clamp0100(warehouseScore), clamp0100(stockAccuracy), clamp0100(inventoryTurnover), initiativeScore];
  const weights = resolveWeights("Store", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  // stockReceived/stockDispatched are logged for the record but not yet weighted into the score —
  // there's no throughput target to measure them against yet (see chat note).
  return { overall: clamp0100(overall), kpis, extra: { warehouseDays: warehouseDays.length, improvementCount, stockReceived, stockDispatched } };
}

function scoreFulfilment(person, logs, month, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  if (rel.length === 0) return null;
  const attempted = rel.reduce((s, l) => s + (Number(l.deliveriesAttempted) || 0), 0);
  const onTime = rel.reduce((s, l) => s + (Number(l.deliveriesOnTime) || 0), 0);
  const failed = rel.reduce((s, l) => s + (Number(l.failedDeliveries) || 0), 0);
  const incidents = rel.filter((l) => l.vehicleIssue === "Yes").length;
  const onTimeRate = attempted ? (onTime / attempted) * 100 : 100;
  const failedRate = attempted ? (failed / attempted) * 100 : 0;
  const failedScore = clamp0100(100 - failedRate * 3);
  const incidentScore = clamp0100(100 - incidents * 20);
  const kpis = [clamp0100(onTimeRate), failedScore, incidentScore];
  const weights = resolveWeights("Fulfilment", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: { attempted, onTime, failed, incidents } };
}

function scoreExperience(person, logs, month, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  if (rel.length === 0) return null;
  const t = person.targets || {};
  const complaintsReceived = rel.reduce((s, l) => s + (Number(l.complaintsReceived) || 0), 0);
  const complaintsResolved = rel.reduce((s, l) => s + (Number(l.complaintsResolved) || 0), 0);
  const csatResponses = rel.reduce((s, l) => s + (Number(l.csatResponses) || 0), 0);
  const csatScoreSum = rel.reduce((s, l) => s + (Number(l.csatScoreSum) || 0), 0);
  const repeatCustomers = rel.reduce((s, l) => s + (Number(l.repeatCustomers) || 0), 0);
  const responseDays = rel.filter((l) => l.avgResponseHrs !== undefined && l.avgResponseHrs !== "");
  const avgResponseHrs = responseDays.length ? responseDays.reduce((s, l) => s + (Number(l.avgResponseHrs) || 0), 0) / responseDays.length : t.responseTargetHrs || 4;
  const ordersReceived = rel.reduce((s, l) => s + (Number(l.ordersReceived) || 0), 0);
  const ordersOnTime = rel.reduce((s, l) => s + (Number(l.ordersOnTime) || 0), 0);
  const stockoutCount = rel.filter((l) => l.stockout === "Yes").length;
  const vetOrders = rel.reduce((s, l) => s + (Number(l.vetOrders) || 0), 0);
  const vetOnTime = rel.reduce((s, l) => s + (Number(l.vetOnTime) || 0), 0);

  const csatAvg = csatResponses ? csatScoreSum / csatResponses : 0;
  const resolutionScore = complaintsReceived ? (complaintsResolved / complaintsReceived) * 100 : 100;
  const repeatRate = csatResponses ? Math.min(repeatCustomers / csatResponses, 1) * 100 : 0;
  const target = t.responseTargetHrs || 4;
  const responseScore = clamp0100(100 - Math.max(0, avgResponseHrs - target) * 10);
  const fulfilSLARaw = ordersReceived ? (ordersOnTime / ordersReceived) * 100 : 100;
  const fulfilSLA = clamp0100(fulfilSLARaw - stockoutCount * 10); // stockouts penalize fulfilment SLA
  const vetSLA = vetOrders ? (vetOnTime / vetOrders) * 100 : 100;

  const kpis = [clamp0100(csatAvg), clamp0100(resolutionScore), fulfilSLA, clamp0100(vetSLA), clamp0100(repeatRate), responseScore];
  const weights = resolveWeights("Experience", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: { complaintsReceived, csatResponses, ordersReceived, vetOrders } };
}

function scoreProduction(person, logs, month, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  if (rel.length === 0) return null;
  const t = person.targets || {};
  const unitsProduced = rel.reduce((s, l) => s + (Number(l.unitsProduced) || 0), 0);
  const unitsRejected = rel.reduce((s, l) => s + (Number(l.unitsRejected) || 0), 0);
  const costIncurred = rel.reduce((s, l) => s + (Number(l.costIncurred) || 0), 0);
  const downtimeHours = rel.reduce((s, l) => s + (Number(l.downtimeHours) || 0), 0);
  const safetyIncidents = rel.filter((l) => l.safetyIncident === "Yes").length;
  const outputAchv = t.monthlyPlanUnits ? unitsProduced / t.monthlyPlanUnits : 0;
  const rejectRate = unitsProduced ? unitsRejected / unitsProduced : 0;
  const qualityScore = clamp0100(100 - rejectRate * 100 * 2);
  const actualUnitCost = unitsProduced ? costIncurred / unitsProduced : 0;
  const costScore = actualUnitCost && t.standardUnitCost ? clamp0100((t.standardUnitCost / actualUnitCost) * 100) : 100;
  const downtimeSafetyScore = clamp0100(100 - downtimeHours * 2 - safetyIncidents * 20);
  const kpis = [clamp0100(cap(outputAchv) * 100), qualityScore, costScore, downtimeSafetyScore];
  const weights = resolveWeights("Production", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: { unitsProduced, unitsRejected } };
}

function scoreSupportAdmin(person, logs, month, monthlyInputs, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  const mi = monthlyInputs[person.id + "|" + month] || {};
  if (rel.length === 0 && mi.supervisorRating === undefined) return null;
  const tasksAssigned = rel.reduce((s, l) => s + (Number(l.tasksAssigned) || 0), 0);
  const tasksCompleted = rel.reduce((s, l) => s + (Number(l.tasksCompleted) || 0), 0);
  const taskScore = tasksAssigned ? (tasksCompleted / tasksAssigned) * 100 : 100;
  const attendanceDays = rel.filter((l) => l.attendance);
  const presentDays = attendanceDays.filter((l) => l.attendance === "Present").length;
  const attendanceScore = attendanceDays.length ? (presentDays / attendanceDays.length) * 100 : 100;
  const supervisorRating = mi.supervisorRating !== undefined ? Number(mi.supervisorRating) : 0;
  const supervisorScore = clamp0100((supervisorRating / 5) * 100);
  const safetyIncidents = rel.filter((l) => l.safetyIncident === "Yes").length;
  const safetyScore = clamp0100(100 - safetyIncidents * 25);
  const kpis = [clamp0100(taskScore), clamp0100(attendanceScore), supervisorScore, safetyScore];
  const weights = resolveWeights("Support/Admin", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: { tasksAssigned, tasksCompleted } };
}

function scoreVeterinary(person, logs, month, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  if (rel.length === 0) return null;
  const t = person.targets || {};
  const casesSeen = rel.reduce((s, l) => s + (Number(l.casesSeen) || 0), 0);
  const casesClosed = rel.reduce((s, l) => s + (Number(l.casesClosed) || 0), 0);
  const casesClosedPositive = rel.reduce((s, l) => s + (Number(l.casesClosedPositive) || 0), 0);
  const revenue = rel.reduce((s, l) => s + (Number(l.revenue) || 0), 0);
  const caseLoadAchv = t.caseCapacityTarget ? casesSeen / t.caseCapacityTarget : 0;
  const outcomeRate = casesClosed ? (casesClosedPositive / casesClosed) * 100 : 100; // no closures yet this month = neutral, not penalized
  const revenueAchv = t.clinicalRevenueTarget ? revenue / t.clinicalRevenueTarget : 0;
  const kpis = [clamp0100(cap(caseLoadAchv) * 100), clamp0100(outcomeRate), clamp0100(cap(revenueAchv) * 100)];
  const weights = resolveWeights("Veterinary/Clinical", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: { casesSeen, casesClosed, casesClosedPositive, revenue } };
}

function scoreOutletLeadership(person, allPeople, logs, month, monthlyInputs, scoredCache, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  const mi = monthlyInputs[person.id + "|" + month] || {};
  const team = allPeople.filter((p) => p.outlet === person.outlet && p.cluster !== "Outlet Leadership");
  const teamScores = team.map((p) => scoredCache[p.id]).filter((s) => s !== null && s !== undefined);
  const teamAvg = teamScores.length ? teamScores.reduce((s, x) => s + x, 0) / teamScores.length : null;
  if (rel.length === 0 && mi.stockAuditPct === undefined && teamAvg === null) return null;
  const t = person.targets || {};
  const outletRevenue = logs
    .filter((l) => monthKey(l.date) === month && l.cluster === "Sales & Marketing" && l.outlet === person.outlet)
    .reduce((s, l) => s + (Number(l.revenue) || 0), 0);
  const warehouseDays = rel.filter((l) => l.warehouseArrangement);
  const warehouseScore = warehouseDays.length ? warehouseDays.reduce((s, l) => s + (WAREHOUSE_SCORE_MAP[l.warehouseArrangement] || 0), 0) / warehouseDays.length : 0;
  const improvementCount = rel.filter((l) => l.focus === "System Improvement").length;
  const revenueAchv = t.revenueTarget ? outletRevenue / t.revenueTarget : 0;
  const stockScore = mi.stockAuditPct !== undefined ? Number(mi.stockAuditPct) : 0;
  const attendanceScore = mi.attendancePct !== undefined ? Number(mi.attendancePct) : 0;
  const initiativeScore = improvementCount >= 1 ? 100 : 0;
  const teamScore = teamAvg !== null ? teamAvg : 0;
  const kpis = [clamp0100(cap(revenueAchv) * 100), clamp0100(warehouseScore), clamp0100(stockScore), clamp0100(teamScore), clamp0100(attendanceScore), initiativeScore];
  const weights = resolveWeights("Outlet Leadership", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: { outletRevenue, teamAvg, warehouseDays: warehouseDays.length } };
}

// One shared form serves three quite different jobs (IT ops, on-ground technical, creative/media).
// Rather than force everyone through all 4 KPI categories — which would unfairly punish, say, a
// designer for never logging bug-tracking numbers — each KPI only counts if the person actually
// logged that work area at least once this month, and the weights renormalize across whichever
// categories were active. See chat note on this tradeoff.
function scoreTechMedia(person, logs, month, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  if (rel.length === 0) return null;
  const byArea = (area) => rel.filter((l) => l.workArea === area);
  const w = resolveWeights("Technology & Media", weightOverrides);
  const kpis = [];
  const weights = [];

  const itDays = byArea("IT Systems / Uptime & Backups");
  if (itDays.length) {
    const incidents = itDays.filter((l) => l.uptimeIncident === "Yes").length;
    const downtime = itDays.reduce((s, l) => s + (Number(l.downtimeMinutes) || 0), 0);
    const backupsDone = itDays.filter((l) => l.backupCompleted === "Yes").length;
    const backupRate = (backupsDone / itDays.length) * 100;
    const reliabilityScore = clamp0100(100 - incidents * 15 - downtime * 0.1);
    kpis.push(clamp0100((reliabilityScore + backupRate) / 2));
    weights.push(w[0]);
  }
  const bugDays = byArea("Bug Tracking & ERPNext Support");
  if (bugDays.length) {
    const logged = bugDays.reduce((s, l) => s + (Number(l.bugsLogged) || 0), 0);
    const closed = bugDays.reduce((s, l) => s + (Number(l.bugsClosed) || 0), 0);
    kpis.push(logged ? clamp0100((closed / logged) * 100) : 100);
    weights.push(w[1]);
  }
  const groundDays = byArea("On-Ground Technical (CCTV/Hardware)");
  if (groundDays.length) {
    const incidents = groundDays.filter((l) => l.cctvIncident === "Yes").length;
    kpis.push(clamp0100(100 - incidents * 15));
    weights.push(w[2]);
  }
  const mediaDays = byArea("Media Production").concat(byArea("AI Media & Design"));
  if (mediaDays.length) {
    const produced = mediaDays.reduce((s, l) => s + (Number(l.assetsProduced) || 0), 0);
    const approved = mediaDays.reduce((s, l) => s + (Number(l.assetsApproved) || 0), 0);
    const approvalRate = produced ? Math.min(approved / produced, 1) * 100 : 100;
    const volumeScore = clamp0100(cap(produced / Math.max(mediaDays.length, 1)) * 100);
    kpis.push(clamp0100((approvalRate + volumeScore) / 2));
    weights.push(w[3]);
  }

  if (kpis.length === 0) return null;
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * (weights[i] / totalWeight), 0));
  return { overall: clamp0100(overall), kpis, extra: { activeAreas: weights.length } };
}

function scoreTechMediaLeadership(person, allPeople, logs, month, monthlyInputs, scoredCache, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  const mi = monthlyInputs[person.id + "|" + month] || {};
  const team = allPeople.filter((p) => p.outlet === person.outlet && p.cluster === "Technology & Media");
  const teamScores = team.map((p) => scoredCache[p.id]).filter((s) => s !== null && s !== undefined);
  const teamAvg = teamScores.length ? teamScores.reduce((s, x) => s + x, 0) / teamScores.length : null;
  if (rel.length === 0 && mi.backupPolicyConfirmed === undefined && teamAvg === null) return null;
  const approvalsGiven = rel.reduce((s, l) => s + (Number(l.approvalsGiven) || 0), 0);
  const bugsPrioritized = rel.reduce((s, l) => s + (Number(l.bugsPrioritized) || 0), 0);
  const releaseDays = rel.filter((l) => l.releaseExecuted === "Yes").length;
  const activityScore = clamp0100((approvalsGiven + bugsPrioritized) * 5 + releaseDays * 10);
  const policyScore = mi.backupPolicyConfirmed === "Yes" ? 100 : 0;
  const trainingCount = mi.traineeOnboarded !== undefined ? Number(mi.traineeOnboarded) : 0;
  const trainingScore = trainingCount >= 1 ? 100 : 0;
  const teamScore = teamAvg !== null ? teamAvg : 0;
  const kpis = [teamScore, activityScore, policyScore, trainingScore];
  const weights = resolveWeights("Technology & Media Leadership", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: { teamAvg, approvalsGiven, bugsPrioritized } };
}

// Shared helper: "single direct report" leadership pattern — this leader's team score is just
// their one report's own already-computed score, not a re-averaged blend of that report's team.
function directReportScore(person, allPeople, logs, month, scoredCache, reportCluster) {
  const report = allPeople.find((p) => p.outlet === person.outlet && p.cluster === reportCluster);
  return report ? (scoredCache[report.id] !== undefined ? scoredCache[report.id] : null) : null;
}

function scoreInternalAudit(person, logs, month, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  if (rel.length === 0) return null;
  const TOTAL_OUTLETS = 8; // 7 Nigerian outlets + Monrovia
  const SOFT_AUDIT_DAYS_TARGET = 15; // placeholder — confirm a real monthly audit-day expectation
  const outletsAudited = new Set(rel.map((l) => l.auditedOutlet).filter(Boolean)).size;
  const coverageScore = clamp0100(cap(outletsAudited / TOTAL_OUTLETS) * 100);
  const frequencyScore = clamp0100(cap(rel.length / SOFT_AUDIT_DAYS_TARGET) * 100);
  const kpis = [coverageScore, frequencyScore];
  const weights = resolveWeights("Internal Audit", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: { outletsAudited, auditDays: rel.length } };
}

function scoreInternalAuditLeadership(person, allPeople, logs, month, monthlyInputs, scoredCache, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  const teamScore = directReportScore(person, allPeople, logs, month, scoredCache, "Internal Audit");
  if (rel.length === 0 && teamScore === null) return null;
  const findingsReviewed = rel.reduce((s, l) => s + (Number(l.findingsReviewed) || 0), 0);
  const complianceDays = rel.filter((l) => l.complianceCheck === "Yes").length;
  const activityScore = clamp0100(findingsReviewed * 5 + complianceDays * 10);
  const kpis = [teamScore !== null ? teamScore : 0, activityScore];
  const weights = resolveWeights("Internal Audit Leadership", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: { teamScore, findingsReviewed } };
}

function scoreBrandLeadership(person, allPeople, logs, month, monthlyInputs, scoredCache, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  const teamScore = directReportScore(person, allPeople, logs, month, scoredCache, "Technology & Media Leadership");
  if (rel.length === 0 && teamScore === null) return null;
  const SOFT_OUTPUT_TARGET = 10; // placeholder combined videos+flyers/month — confirm a real target
  const videos = rel.reduce((s, l) => s + (Number(l.advertVideosProduced) || 0), 0);
  const flyers = rel.reduce((s, l) => s + (Number(l.flyersProduced) || 0), 0);
  const outputScore = clamp0100(cap((videos + flyers) / SOFT_OUTPUT_TARGET) * 100);
  const kpis = [teamScore !== null ? teamScore : 0, outputScore];
  const weights = resolveWeights("Brand Leadership", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: { teamScore, videos, flyers } };
}

// Zachariah's team spans five physical outlets, not one — company-wide cluster match instead
// of the outlet-based "direct report" pattern the other leadership roles use.
function scoreExperienceLeadership(person, allPeople, logs, month, monthlyInputs, scoredCache, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  const team = allPeople.filter((p) => p.cluster === "Experience");
  const teamScores = team.map((p) => scoredCache[p.id]).filter((s) => s !== null && s !== undefined);
  const teamAvg = teamScores.length ? teamScores.reduce((s, x) => s + x, 0) / teamScores.length : null;
  if (rel.length === 0 && teamAvg === null) return null;
  const escalationsReviewed = rel.reduce((s, l) => s + (Number(l.escalationsReviewed) || 0), 0);
  const coachingDays = rel.filter((l) => l.coachingSession === "Yes").length;
  const activityScore = clamp0100(escalationsReviewed * 5 + coachingDays * 15);
  const kpis = [teamAvg !== null ? teamAvg : 0, activityScore];
  const weights = resolveWeights("Experience Leadership", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: { teamAvg, escalationsReviewed } };
}

// Impact metrics are official cumulative year-to-date figures (matches the BI Impact Metrics
// sheet: agrovet stores served, jobs created, vet empowerment, certificates, training, campaigns),
// not daily counts — score reads the latest monthly-reported YTD snapshot against each goal.
// Kept unweighted/even across all six since no guidance was given on relative priority.
function scoreImpact(person, logs, month, monthlyInputs, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  const mi = monthlyInputs[person.id + "|" + month] || {};
  const t = person.targets || {};
  const hasMonthly = ["agrovetStoresYTD", "directJobsYTD", "vetJobsYTD", "certificatesYTD", "trainedYTD", "campaignsYTD"].some((k) => mi[k] !== undefined);
  if (rel.length === 0 && !hasMonthly) return null;
  const pct = (val, target) => (target ? clamp0100(cap((Number(val) || 0) / target) * 100) : 0);
  const kpis = [pct(mi.agrovetStoresYTD, t.agrovetStoresGoal), pct(mi.directJobsYTD, t.directJobsGoal), pct(mi.vetJobsYTD, t.vetJobsGoal), pct(mi.certificatesYTD, t.certificatesGoal), pct(mi.trainedYTD, t.trainedGoal), pct(mi.campaignsYTD, t.campaignsGoal)];
  const weights = resolveWeights("Impact", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: {} };
}

function scoreAccounts(person, logs, month, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  if (rel.length === 0) return null;
  const SOFT_VOLUME_TARGET = 300; // placeholder monthly invoices+payments combined — confirm a real target
  const SOFT_RECON_TARGET = 20; // placeholder monthly reconciliation count — confirm a real target
  const volume = rel.reduce((s, l) => s + (Number(l.invoicesProcessed) || 0) + (Number(l.paymentsProcessed) || 0), 0);
  const reconciliations = rel.reduce((s, l) => s + (Number(l.reconciliationsCompleted) || 0), 0);
  const volumeScore = clamp0100(cap(volume / SOFT_VOLUME_TARGET) * 100);
  const reconScore = clamp0100(cap(reconciliations / SOFT_RECON_TARGET) * 100);
  const kpis = [volumeScore, reconScore];
  const weights = resolveWeights("Accounts", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: { volume, reconciliations } };
}

function scoreAccountsLeadership(person, allPeople, logs, month, monthlyInputs, scoredCache, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  const teamScore = directReportScore(person, allPeople, logs, month, scoredCache, "Accounts");
  if (rel.length === 0 && teamScore === null) return null;
  const paymentsApproved = rel.reduce((s, l) => s + (Number(l.paymentsApproved) || 0), 0);
  const variancesReviewed = rel.reduce((s, l) => s + (Number(l.variancesReviewed) || 0), 0);
  const reportDays = rel.filter((l) => l.reportSubmitted === "Yes").length;
  const activityScore = clamp0100((paymentsApproved + variancesReviewed) * 5 + reportDays * 10);
  const kpis = [teamScore !== null ? teamScore : 0, activityScore];
  const weights = resolveWeights("Accounts Leadership", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: { teamScore, paymentsApproved, variancesReviewed } };
}

// Ijeoma (COO) oversees every centre's own operations company-wide, not one outlet — same
// company-wide cluster-match pattern as scoreExperienceLeadership, but matched against Outlet
// Leadership instead of Experience. Her own procurement + oversight activity is scored
// separately alongside that team rollup, since — unlike Isaac's or Monday's single direct
// report — her role isn't just leading one cluster, it's two distinct hands-on work areas too.
function scoreOperationsLeadership(person, allPeople, logs, month, monthlyInputs, scoredCache, weightOverrides) {
  const rel = aggDaily(logs, person.id, month);
  const team = allPeople.filter((p) => p.cluster === "Outlet Leadership");
  const teamScores = team.map((p) => scoredCache[p.id]).filter((s) => s !== null && s !== undefined);
  const teamAvg = teamScores.length ? teamScores.reduce((s, x) => s + x, 0) / teamScores.length : null;
  if (rel.length === 0 && teamAvg === null) return null;
  const SOFT_PROCUREMENT_TARGET = 40; // placeholder combined monthly PO/supplier/stockout actions — confirm a real target
  const SOFT_OVERSIGHT_TARGET = 20; // placeholder combined monthly outlet-review/escalation actions — confirm a real target
  const procurementActs = rel.reduce((s, l) => s + (Number(l.poRaised) || 0) + (Number(l.poApproved) || 0) + (Number(l.suppliersEngaged) || 0) + (Number(l.stockoutsResolved) || 0), 0);
  const oversightActs = rel.reduce((s, l) => s + (Number(l.outletsReviewed) || 0) + (Number(l.escalationsHandled) || 0), 0);
  const procurementScore = clamp0100(cap(procurementActs / SOFT_PROCUREMENT_TARGET) * 100);
  const oversightScore = clamp0100(cap(oversightActs / SOFT_OVERSIGHT_TARGET) * 100);
  const teamScore = teamAvg !== null ? teamAvg : 0;
  const kpis = [teamScore, procurementScore, oversightScore];
  const weights = resolveWeights("Operations & Procurement Leadership", weightOverrides);
  const overall = Math.round(kpis.reduce((s, k, i) => s + k * weights[i], 0));
  return { overall: clamp0100(overall), kpis, extra: { teamAvg, procurementActs, oversightActs } };
}

// Three-pass company-wide scorer:
//   Pass 1 — clusters with no dependency on anyone else's score.
//   Pass 2 — leadership roles whose team rollup depends only on Pass-1 results.
//   Pass 3 — leadership roles that depend on a Pass-2 result: Brand Leadership on Isaac's
//            Technology & Media Leadership score, Operations & Procurement Leadership on the
//            company-wide Outlet Leadership average (both read scoredCache from Pass 2).
// `people` items need at least {id, cluster, outlet, targets}; `logs` items need
// {personId, cluster, outlet, date, ...clusterFields} — see this file's header comment.
// `weightOverrides` (optional) is app_settings' perf_cluster_weights value
// (lib/db/settings.js's getAppSettings()) — {cluster: [w0, w1, ...]} for any
// cluster an admin has adjusted away from DEFAULT_WEIGHTS. Every caller of
// computeAllScores should pass this (fetched once per request), so the
// dashboard, the widget's own score view, and every export always agree on
// which weights are actually in effect — never a second, stale copy.
// Omitting it (or passing {}) just means "use DEFAULT_WEIGHTS everywhere,"
// exactly today's behavior.
export function computeAllScores(people, logs, month, monthlyInputs, weightOverrides = {}) {
  const cache = {};
  const results = {};
  const PASS2_LEADERSHIP = ["Outlet Leadership", "Technology & Media Leadership", "Internal Audit Leadership", "Experience Leadership", "Accounts Leadership"];
  const PASS3_LEADERSHIP = ["Brand Leadership", "Operations & Procurement Leadership"];

  people.forEach((p) => {
    if (PASS2_LEADERSHIP.includes(p.cluster) || PASS3_LEADERSHIP.includes(p.cluster)) return;
    let r = null;
    if (p.cluster === "Sales & Marketing") r = scoreSalesMarketing(p, logs, month, weightOverrides);
    else if (p.cluster === "Store") r = scoreStore(p, logs, month, monthlyInputs, weightOverrides);
    else if (p.cluster === "Fulfilment") r = scoreFulfilment(p, logs, month, weightOverrides);
    else if (p.cluster === "Experience") r = scoreExperience(p, logs, month, weightOverrides);
    else if (p.cluster === "Production") r = scoreProduction(p, logs, month, weightOverrides);
    else if (p.cluster === "Support/Admin") r = scoreSupportAdmin(p, logs, month, monthlyInputs, weightOverrides);
    else if (p.cluster === "Veterinary/Clinical") r = scoreVeterinary(p, logs, month, weightOverrides);
    else if (p.cluster === "Technology & Media") r = scoreTechMedia(p, logs, month, weightOverrides);
    else if (p.cluster === "Internal Audit") r = scoreInternalAudit(p, logs, month, weightOverrides);
    else if (p.cluster === "Impact") r = scoreImpact(p, logs, month, monthlyInputs, weightOverrides);
    else if (p.cluster === "Accounts") r = scoreAccounts(p, logs, month, weightOverrides);
    results[p.id] = r;
    cache[p.id] = r ? r.overall : null;
  });
  people.forEach((p) => {
    if (!PASS2_LEADERSHIP.includes(p.cluster)) return;
    let r = null;
    if (p.cluster === "Outlet Leadership") r = scoreOutletLeadership(p, people, logs, month, monthlyInputs, cache, weightOverrides);
    else if (p.cluster === "Technology & Media Leadership") r = scoreTechMediaLeadership(p, people, logs, month, monthlyInputs, cache, weightOverrides);
    else if (p.cluster === "Internal Audit Leadership") r = scoreInternalAuditLeadership(p, people, logs, month, monthlyInputs, cache, weightOverrides);
    else if (p.cluster === "Experience Leadership") r = scoreExperienceLeadership(p, people, logs, month, monthlyInputs, cache, weightOverrides);
    else if (p.cluster === "Accounts Leadership") r = scoreAccountsLeadership(p, people, logs, month, monthlyInputs, cache, weightOverrides);
    results[p.id] = r;
    cache[p.id] = r ? r.overall : null;
  });
  people.forEach((p) => {
    if (!PASS3_LEADERSHIP.includes(p.cluster)) return;
    let r = null;
    if (p.cluster === "Brand Leadership") r = scoreBrandLeadership(p, people, logs, month, monthlyInputs, cache, weightOverrides);
    else if (p.cluster === "Operations & Procurement Leadership") r = scoreOperationsLeadership(p, people, logs, month, monthlyInputs, cache, weightOverrides);
    results[p.id] = r;
    cache[p.id] = r ? r.overall : null;
  });
  return results;
}
