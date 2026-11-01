import ExcelJS from "exceljs";
import { requireAppAdmin } from "@/lib/perf/admin-auth";
import { exportRows, monthLabel } from "@/lib/db/perf-app-scores";
import { isValidMonth } from "@/lib/perf/app-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// export_scores (build spec 6.3): CSV or Excel of one month's scores,
// bands, ratings and Dare points, for HR and Finance. Performance admins
// and viewers (lib/perf/admin-auth.js).
// Spreadsheet-formula injection is neutralised in every text cell.

const COLUMNS = [
  ["name", "Name"],
  ["outlet", "Centre"],
  ["role", "Role"],
  ["lineManager", "Line manager"],
  ["score", "Score"],
  ["band", "Band"],
  ["status", "Status"],
  ["source", "Source"],
  ["verified", "Verified (SOP-PPL-06)"],
  ["care", "Care"],
  ["dare", "Dare"],
  ["conduct", "Conduct"],
  ["teamwork", "Teamwork"],
  ["ratingComment", "Supervisor comment"],
  ["darePoints", "Dare points (month)"],
];

function safe(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v;
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

export async function GET(request) {
  const admin = await requireAppAdmin(request);
  if (admin.error) return Response.json({ error: admin.error }, { status: admin.status });
  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  if (!isValidMonth(month)) return Response.json({ error: "Invalid month." }, { status: 400 });

  try {
    const rows = await exportRows(month);
    const filename = "farm-alert-scores-" + month + "." + format;
    if (format === "csv") {
      const esc = (v) => {
        const s = String(safe(v));
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const csv = [COLUMNS.map((c) => c[1]).join(","), ...rows.map((r) => COLUMNS.map((c) => esc(r[c[0]])).join(","))].join("\n");
      return new Response("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="' + filename + '"', "Cache-Control": "no-store" } });
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Farm Alert Performance";
    const ws = wb.addWorksheet("Scores " + monthLabel(month));
    ws.columns = COLUMNS.map(([key, header]) => ({ key, header, width: key === "ratingComment" ? 50 : key === "name" ? 28 : 16 }));
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D3B4F" } };
    rows.forEach((r) => ws.addRow(Object.fromEntries(COLUMNS.map(([k]) => [k, safe(r[k])]))));

    const lines = wb.addWorksheet("KPI lines");
    lines.columns = [
      { key: "name", header: "Name", width: 28 },
      { key: "kpi", header: "KPI", width: 34 },
      { key: "weight", header: "Weight", width: 10 },
      { key: "actual", header: "Actual", width: 14 },
      { key: "target", header: "Target", width: 14 },
      { key: "score", header: "Score 0–100", width: 12 },
      { key: "weighted", header: "Weighted", width: 12 },
    ];
    lines.getRow(1).font = { bold: true };
    rows.forEach((r) => (r.lines || []).forEach((l) => lines.addRow({ name: safe(r.name), kpi: safe(l.kpi), weight: l.weight, actual: l.actual ?? "", target: l.target ?? "", score: l.score ?? "", weighted: l.weighted ?? "" })));

    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="' + filename + '"', "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/export] failed: " + err.message);
    return Response.json({ error: "Couldn't build the export." }, { status: 500 });
  }
}
