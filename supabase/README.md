# Database

This app has no database of its own. It uses the Performance System tables
in the **VetXpress Supabase project**, the same `perf_staff` roster, logins,
logs and HQ tasks the VetXpress Performance dashboard and the WordPress
widget use.

The app's own tables (tasks, visits, daily reports, scorecards, monthly
scores, ratings, ideas, Dare points, push subscriptions, notifications) are
created by **migration 122** in the VetXpress repo:
`supabase/migrations/122_perf_app.sql` (rollback:
`supabase/rollbacks/122_perf_app_down.sql`). Migrations stay in one place
so the shared database has a single history; apply 122 there before the
first deploy of this app.
