# Farm Alert Performance

The staff phone app and its admin, from the *Farm Alert Performance App: build specification and UI/UX design* (v1.0, 1 Nov 2026). It's a standalone Next.js app with its own deployment and its own address. It runs on the same Performance System data as VetXpress (Supabase `perf_*` tables), so the VetXpress Performance dashboard, the WordPress widget and the staff roster stay in step.

| Address | Who | What |
|---|---|---|
| `/` | Every Associate | Phone app, installable from the browser: My day, Task detail, Log a visit, Daily report, My rating, Ideas. Supervisors also get Team today, Ratings and Ideas to decide. Works offline. |
| `/admin` | HR (VP Finance & Admin) and the CTO; read-only for the CEO, VP AI & Digital Innovation and Chief Internal Auditor | Reporting lines and ERPNext ids per person, task templates, auto-tick rules, scorecards, manual KPI actuals, month rebuild and lock, score corrections with a reason, Internal Audit verified flag, Excel/CSV export, ideas register. |

Sign-in for both is the staff email and password from the Performance System. No VetXpress admin account is needed.

## How it fits together

```
Phone (PWA) ──HTTPS──> this app (Vercel) ──> Supabase (shared with VetXpress: perf_* tables, staff logins)
                              │
                              └──read-only──> ERPNext (sales, payments, Partners, deliveries, leave)
VPS crontab ──every 15 min──> /api/cron/tick (day plans, auto-ticks, reminders, scores, month lock)
```

- **ERPNext is read-only.** `lib/erp/client.js` has no create or update function at all (VetXpress CLAUDE.md Addendum D/F).
- **Still managed in VetXpress:** staff logins (Admin → Performance → Staff Accounts), HQ-assigned tasks (Tasks board) and cluster scoring weights. This app reads them, and staff can update the status of their HQ tasks from My day.
- **Scores:** people whose role or cluster has a scorecard are scored from ERPNext figures. Everyone else keeps the Performance System's existing cluster formula (`lib/perf/scoring.js`, shared with VetXpress), so the numbers match the VetXpress dashboard.

## Setup

1. **Database:** apply migration 122 in the VetXpress repo (see `supabase/README.md`).
2. **Vercel:** create a new project from this repo, set the variables from `.env.example`, and add the app's domain (for example `performance.farmalert.com.ng`).
3. **ERPNext:** give the read-only API user read access to Payment Entry, Sales Invoice, Sales Order, Customer, Lead, Delivery Note, Purchase Receipt, Stock Entry, Material Request, Employee, Leave Application and Holiday List.
4. **Tick:** add to the VPS crontab:
   `*/15 * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://performance.farmalert.com.ng/api/cron/tick`
5. **People:** in `/admin` → People & reporting, set each person's line manager and ERPNext user, Sales Person and Employee.
6. **Push (optional):** `npx web-push generate-vapid-keys`, then set the three `PERF_PUSH_VAPID_*` variables.

## Development

```
npm install
cp .env.example .env.local   # fill in staging values
npm run dev
npm test                     # scoring, bands, lateness, schedules, month cycle
npm run lint
```

## Security

- Every API call is authenticated on the server. The session is a 30-day httpOnly, Secure, SameSite=Strict cookie signed with `PERF_APP_SESSION_SECRET`, and every POST needs the `x-perf-app` header.
- Supervisors see and rate only their direct reports; anything else gets a 403.
- Offline actions carry a `client_id`, so a retry never duplicates anything.
- Photos and voice notes go in a private storage bucket and are only read through short-lived signed URLs.
- Location is taken only when Log a visit is opened, never in the background. A privacy notice is shown on first use (NDPA 2023).
- Security headers and a Content Security Policy are set in `next.config.mjs`.
