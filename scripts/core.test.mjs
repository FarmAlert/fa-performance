// Unit tests for the Performance App's pure rules (lib/perf/app-core.js).
// Run: npm test   (plain node:test, no extra dependencies)
import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../lib/perf/app-core.js";

test("kpiScore: higher is better, capped at 100", () => {
  assert.equal(core.kpiScore(4400000, 5000000), 88);
  assert.equal(core.kpiScore(9, 8), 100);
  assert.equal(core.kpiScore(0, 8), 0);
  assert.equal(core.kpiScore(null, 8), null);
  assert.equal(core.kpiScore(5, 0), null);
});

test("kpiScore: lower is better, zero actual scores 100", () => {
  assert.equal(core.kpiScore(0, 30, false), 100);
  assert.equal(core.kpiScore(60, 30, false), 50);
  assert.equal(core.kpiScore(20, 30, false), 100);
});

test("monthlyScore matches spec 6.2 example (80, Amber)", () => {
  const lines = [
    { weight: 30, score: 88 },
    { weight: 20, score: 76 },
    { weight: 15, score: 100 },
    { weight: 15, score: 70 },
    { weight: 10, score: 50 },
    { weight: 10, score: 80 },
  ];
  const s = core.monthlyScore(lines);
  assert.equal(s, 80);
  assert.equal(core.bandOf(s), "amber");
});

test("monthlyScore: missing is not zero before lock, is zero after", () => {
  const lines = [
    { weight: 50, score: 90 },
    { weight: 50, score: null },
  ];
  assert.equal(core.monthlyScore(lines), 90);
  assert.equal(core.monthlyScore(lines, { missingAsZero: true }), 45);
  assert.equal(core.monthlyScore([{ weight: 100, score: null }]), null);
  assert.equal(core.monthlyScore([{ weight: 100, score: null }], { missingAsZero: true }), 0);
});

test("bands and next-band gap", () => {
  assert.equal(core.bandOf(85), "green");
  assert.equal(core.bandOf(84), "amber");
  assert.equal(core.bandOf(70), "amber");
  assert.equal(core.bandOf(69), "red");
  assert.equal(core.bandOf(null), "no_data");
  assert.deepEqual(core.nextBandGap(80), { band: "green", points: 5 });
  assert.deepEqual(core.nextBandGap(62), { band: "amber", points: 8 });
  assert.equal(core.nextBandGap(90), null);
});

test("weights must add up to 100", () => {
  assert.equal(core.weightsValid([{ weight: 60 }, { weight: 40 }]), true);
  assert.equal(core.weightsValid([{ weight: 60 }, { weight: 30 }]), false);
});

test("Lagos time helpers", () => {
  // 2026-11-02 17:30 UTC = 18:30 Lagos
  const t = new Date("2026-11-02T17:30:00Z");
  assert.equal(core.lagosDate(t), "2026-11-02");
  assert.equal(core.lagosParts(t).hour, 18);
  // 23:30 UTC is already the next day in Lagos
  assert.equal(core.lagosDate(new Date("2026-11-02T23:30:00Z")), "2026-11-03");
  assert.equal(core.lagosInstant("2026-11-02", "18:00").toISOString(), "2026-11-02T17:00:00.000Z");
  assert.equal(core.formatTime12("16:00"), "4:00pm");
  assert.equal(core.formatTime12("08:05:00"), "8:05am");
});

test("report confirmed at 18:05 is late (acceptance check 11.1)", () => {
  assert.equal(core.reportIsLate("2026-11-02", "2026-11-02T17:05:00Z"), true);
  assert.equal(core.reportIsLate("2026-11-02", "2026-11-02T16:59:00Z"), false);
});

test("templates: role/cluster match and frequency", () => {
  const staff = { role: "Sales & Marketing Manager", cluster: "Sales & Marketing" };
  assert.equal(core.templateMatchesStaff({ role: null, cluster: null }, staff), true);
  assert.equal(core.templateMatchesStaff({ cluster: "Store" }, staff), false);
  assert.equal(core.templateMatchesStaff({ role: "sales & marketing manager" }, staff), true);
  // 2026-11-02 is a Monday
  assert.equal(core.templateDueOn({ frequency: "weekly", weekday: 1 }, "2026-11-02"), true);
  assert.equal(core.templateDueOn({ frequency: "weekly", weekday: 1 }, "2026-11-03"), false);
  assert.equal(core.templateDueOn({ frequency: "monthly", month_day: 31 }, "2026-11-30"), true);
  assert.equal(core.templateDueOn({ frequency: "monthly", month_day: 2 }, "2026-11-02"), true);
  assert.equal(core.templateDueOn({ frequency: "on_event" }, "2026-11-02"), false);
});

test("auto rule completion", () => {
  assert.equal(core.ruleDone("gte_target", 6, 6), true);
  assert.equal(core.ruleDone("gte_target", 4, 6), false);
  assert.equal(core.ruleDone("gte_1", 1, null), true);
  assert.equal(core.ruleDone("all_compliant", 3, null, 3), true);
  assert.equal(core.ruleDone("all_compliant", 3, null, 2), false);
  assert.equal(core.ruleDone("all_compliant", 0, null, 0), true);
});

test("overdue uses Lagos due time", () => {
  const task = { status: "open", task_date: "2026-11-02", due_time: "12:00" };
  assert.equal(core.isOverdue(task, new Date("2026-11-02T10:59:00Z")), false);
  assert.equal(core.isOverdue(task, new Date("2026-11-02T11:01:00Z")), true);
  assert.equal(core.isOverdue({ ...task, status: "done" }, new Date("2026-11-02T13:00:00Z")), false);
});

test("visits: distance and productive rule", () => {
  const d = core.distanceMetres(9.1531, 7.3221, 9.1531, 7.3251);
  assert.ok(d > 320 && d < 340, "~330 m, got " + d);
  assert.equal(core.visitIsProductive({ salesOrder: "SO-1", distanceM: 120 }), true);
  assert.equal(core.visitIsProductive({ salesOrder: "SO-1", distanceM: 450 }), false);
  assert.equal(core.visitIsProductive({ salesOrder: "SO-1", distanceM: 450, farApproved: true }), true);
  assert.equal(core.visitIsProductive({ distanceM: 10 }), false);
  assert.equal(core.visitIsProductive({ salesInvoice: "SI-1", distanceM: null }), true);
});

test("ratings: 1–5 and comment required at 2 or below", () => {
  assert.equal(core.ratingValid({ care: 5, dare: 1, conduct: 3, teamwork: 4 }), true);
  assert.equal(core.ratingValid({ care: 6, dare: 1, conduct: 3, teamwork: 4 }), false);
  assert.equal(core.ratingNeedsComment({ care: 5, dare: 2, conduct: 3, teamwork: 4 }), true);
  assert.equal(core.ratingNeedsComment({ care: 5, dare: 3, conduct: 3, teamwork: 4 }), false);
});

test("monthly cycle phases (Day 3 / Day 5)", () => {
  assert.equal(core.monthPhase("2026-10", new Date("2026-10-20T10:00:00Z")), "live");
  assert.equal(core.monthPhase("2026-10", new Date("2026-11-03T10:00:00Z")), "live");
  assert.equal(core.monthPhase("2026-10", new Date("2026-11-04T10:00:00Z")), "incomplete");
  assert.equal(core.monthPhase("2026-10", new Date("2026-11-05T22:00:00Z")), "incomplete");
  assert.equal(core.monthPhase("2026-10", new Date("2026-11-06T08:00:00Z")), "locked");
  assert.equal(core.monthPhase("2026-10", new Date("2026-12-10T08:00:00Z")), "locked");
  assert.equal(core.ratingMonth(new Date("2026-11-02T08:00:00Z")), "2026-10");
  assert.equal(core.ratingMonth(new Date("2026-11-06T08:00:00Z")), null);
});

test("quiet hours 20:00–07:00 Lagos", () => {
  assert.equal(core.isQuietHours(new Date("2026-11-02T19:30:00Z")), true); // 20:30
  assert.equal(core.isQuietHours(new Date("2026-11-02T05:59:00Z")), true); // 06:59
  assert.equal(core.isQuietHours(new Date("2026-11-02T06:00:00Z")), false); // 07:00
});

test("working days and money formatting", () => {
  assert.equal(core.addWorkingDays("2026-10-30", 1), "2026-11-02"); // Fri -> Mon
  assert.equal(core.addWorkingDays("2026-11-02", 10), "2026-11-16");
  assert.equal(core.formatNaira(450000), "₦450,000");
  assert.equal(core.formatNairaShort(2400000), "₦2.4m");
});

test("centre display names", () => {
  assert.equal(core.centreLabel("ABUJA"), "Abuja");
  assert.equal(core.centreLabel("PHC"), "Port Harcourt");
  assert.equal(core.centreLabel("Head Office"), "Head Office");
  assert.equal(core.centreLabel("Technology & Media (HQ)"), "Technology & Media (HQ)");
});
