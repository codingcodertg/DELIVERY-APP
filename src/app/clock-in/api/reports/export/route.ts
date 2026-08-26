import { NextResponse } from "next/server";
import { createClient } from "@/lib/clockin/supabase/server";
import { centralWallToUtc } from "@/lib/clockin/tz";
import { payPeriodDates } from "@/lib/clockin/schedule";
import { entryMinutes, hrs, summarize, attachLunch, lunchMinutes, type PayEntry, type LunchRow } from "@/lib/clockin/payroll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
function centralParts(iso: string) {
  const date = new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Chicago",
  });
  const time = new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
  return { date, time };
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role, company_id").eq("id", user.id).single();
  if (!me || (me.role !== "manager" && me.role !== "owner")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { data: meStore } = await supabase.from("profiles").select("store_id").eq("id", user.id).maybeSingle();
  const scopeStore = me.role === "manager" && meStore?.store_id ? (meStore.store_id as string) : null;

  const url = new URL(req.url);
  const type = url.searchParams.get("type") === "detail" ? "detail" : "summary";
  const monday = url.searchParams.get("week") || payPeriodDates()[0]; // pay week = Fri→Thu
  const startUtc = centralWallToUtc(`${monday}T00:00`);
  const endUtc = new Date(new Date(startUtc).getTime() + 7 * 86400000).toISOString();

  const peopleQuery = supabase.from("profiles").select("id, full_name").eq("company_id", me.company_id);
  if (scopeStore) peopleQuery.eq("store_id", scopeStore);
  if (me.role !== "owner") peopleQuery.neq("role", "owner"); // owner excluded from a manager's export
  const { data: people } = await peopleQuery;
  const allowedIds = (people ?? []).map((p) => p.id as string);

  const emptyIds = ["00000000-0000-0000-0000-000000000000"];
  const [{ data: entryRows }, { data: lunchRows }, { data: approvals }] = await Promise.all([
    supabase
      .from("time_entries")
      .select("id, employee_id, clock_in_at, clock_out_at, lunch_minutes, status, manual, edit_note")
      .in("employee_id", allowedIds.length ? allowedIds : emptyIds)
      .gte("clock_in_at", startUtc)
      .lt("clock_in_at", endUtc)
      .order("clock_in_at", { ascending: true }),
    supabase
      .from("exceptions")
      .select("time_entry_id, left_at, returned_at")
      .eq("reason", "lunch")
      .in("employee_id", allowedIds.length ? allowedIds : emptyIds)
      .gte("left_at", startUtc)
      .lt("left_at", endUtc),
    supabase.from("timesheet_approvals").select("employee_id").eq("period_start", monday),
  ]);

  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name as string]));
  const approvedSet = new Set((approvals ?? []).map((a) => a.employee_id as string));
  const entries = attachLunch((entryRows ?? []) as PayEntry[], (lunchRows ?? []) as LunchRow[]);

  const byEmp = new Map<string, PayEntry[]>();
  for (const e of entries) {
    const arr = byEmp.get(e.employee_id) ?? [];
    arr.push(e);
    byEmp.set(e.employee_id, arr);
  }

  let body: string;
  let filename: string;

  if (type === "summary") {
    const rows: (string | number)[][] = [
      ["Employee", "Regular Hours", "Overtime Hours", "Total Hours", "Manager Approved"],
    ];
    const ids = [...byEmp.keys()].sort((a, b) => (nameOf.get(a) ?? "").localeCompare(nameOf.get(b) ?? ""));
    let tReg = 0,
      tOt = 0,
      tTot = 0;
    for (const id of ids) {
      const s = summarize(byEmp.get(id)!);
      tReg += s.regularMin;
      tOt += s.otMin;
      tTot += s.totalMin;
      rows.push([
        nameOf.get(id) ?? "Unknown",
        hrs(s.regularMin),
        hrs(s.otMin),
        hrs(s.totalMin),
        approvedSet.has(id) ? "Yes" : "No",
      ]);
    }
    rows.push(["TOTAL", hrs(tReg), hrs(tOt), hrs(tTot), ""]);
    body = csv(rows);
    filename = `payroll-summary_${monday}.csv`;
  } else {
    const rows: (string | number)[][] = [
      ["Employee", "Date", "Clock In", "Clock Out", "Lunch (min)", "Hours", "Source", "Note"],
    ];
    const ids = [...byEmp.keys()].sort((a, b) => (nameOf.get(a) ?? "").localeCompare(nameOf.get(b) ?? ""));
    for (const id of ids) {
      for (const e of byEmp.get(id)!) {
        const ci = centralParts(e.clock_in_at);
        const co = e.clock_out_at ? centralParts(e.clock_out_at) : null;
        const source = e.manual ? "Manager-added" : e.status === "edited" ? "Edited" : "Punch";
        rows.push([
          nameOf.get(id) ?? "Unknown",
          ci.date,
          ci.time,
          co ? co.time : "— (open)",
          Math.round(lunchMinutes(e)),
          e.clock_out_at ? hrs(entryMinutes(e)) : "0.00",
          source,
          e.edit_note ?? "",
        ]);
      }
    }
    body = csv(rows);
    filename = `timesheet-detail_${monday}.csv`;
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
