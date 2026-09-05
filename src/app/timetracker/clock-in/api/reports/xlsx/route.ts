import { NextResponse } from "next/server";
import { visibleStores } from "@/lib/clockin/scope";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/clockin/supabase/server";
import { centralWallToUtc } from "@/lib/clockin/tz";
import { payPeriodDates } from "@/lib/clockin/schedule";
import { hrs, entryMinutes, attachLunch, type PayEntry, type LunchRow } from "@/lib/clockin/payroll";
import { businessTimeZone } from "@/lib/timetracker/timezone-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Entry = PayEntry;
type Lunch = LunchRow;

// G-25 (D-198): la zona viene del ajuste de Time Tracker (timetracker.settings), no de
// "America/Chicago" a pelo; en servidor se lee la fila, con Chicago de defecto.
function cDate(iso: string, timeZone: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  });
}
function cTime(iso: string | null, timeZone: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const tz = await businessTimeZone(supabase);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: me } = await supabase
    .from("profiles")
    .select("role, company_id, store_id, extra_store_ids")
    .eq("id", user.id)
    .single();
  if (!me || (me.role !== "manager" && me.role !== "owner")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const scopeStore = visibleStores(me.role, (me.store_id as string) ?? null, (me as { extra_store_ids?: string[] }).extra_store_ids);

  const url = new URL(req.url);
  const monday = url.searchParams.get("week") || payPeriodDates()[0]; // pay week = Fri→Thu
  const startUtc = centralWallToUtc(`${monday}T00:00`);
  const endUtc = new Date(new Date(startUtc).getTime() + 7 * 86400000).toISOString();

  // Employees (scoped), sites (for tab names), entries + lunch breaks for the week.
  let peopleQ = supabase
    .from("profiles")
    .select("id, full_name, store_id")
    .eq("company_id", me.company_id)
    .eq("active", true);
  if (scopeStore) peopleQ = peopleQ.in("store_id", scopeStore);
  if (me.role !== "owner") peopleQ = peopleQ.neq("role", "owner"); // owner excluded from a manager's export
  const { data: people } = await peopleQ;
  const allowed = new Set((people ?? []).map((p) => p.id as string));
  const allowedIds = [...allowed];

  const [{ data: sites }, { data: entryRows }, { data: lunchRows }] = await Promise.all([
    supabase.from("job_sites").select("id, name").eq("company_id", me.company_id),
    supabase
      .from("time_entries")
      .select("id, employee_id, clock_in_at, clock_out_at, lunch_minutes")
      .in("employee_id", allowedIds.length ? allowedIds : ["00000000-0000-0000-0000-000000000000"])
      .gte("clock_in_at", startUtc)
      .lt("clock_in_at", endUtc)
      .order("clock_in_at", { ascending: true }),
    supabase
      .from("exceptions")
      .select("time_entry_id, left_at, returned_at")
      .eq("type", "leaving_while_clocked_in")
      .eq("reason", "lunch")
      .in("employee_id", allowedIds.length ? allowedIds : ["00000000-0000-0000-0000-000000000000"])
      .gte("left_at", startUtc)
      .lt("left_at", endUtc),
  ]);

  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name as string]));
  const storeOf = new Map((people ?? []).map((p) => [p.id, (p.store_id as string) ?? "none"]));
  const siteName = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]));
  const lunchList = (lunchRows ?? []) as Lunch[];
  const lunchByEntry = new Map<string, Lunch>();
  for (const l of lunchList) if (l.time_entry_id) lunchByEntry.set(l.time_entry_id, l);
  // Same lunch-aware math as the reports page + CSV: attach punched lunch, then
  // worked hours come from the shared entryMinutes().
  const entries = attachLunch((entryRows ?? []) as Entry[], lunchList);

  // Group employees -> store -> entries.
  const byStore = new Map<string, Map<string, Entry[]>>(); // storeId -> empId -> entries
  for (const e of entries) {
    const store = storeOf.get(e.employee_id) ?? "none";
    if (!byStore.has(store)) byStore.set(store, new Map());
    const emp = byStore.get(store)!;
    if (!emp.has(e.employee_id)) emp.set(e.employee_id, []);
    emp.get(e.employee_id)!.push(e);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "RTG Clock-In";

  const HEADER = ["Employee", "Date", "Clock In", "Out for lunch", "Back from lunch", "Clock Out", "Hours"];

  // Sort stores by name; "none" (unassigned) last.
  const storeIds = [...byStore.keys()].sort((a, b) => {
    if (a === "none") return 1;
    if (b === "none") return -1;
    return (siteName.get(a) ?? "").localeCompare(siteName.get(b) ?? "");
  });

  for (const store of storeIds) {
    const tabName = (store === "none" ? "Unassigned" : siteName.get(store) ?? "Store").slice(0, 31);
    const ws = wb.addWorksheet(tabName, { views: [{ state: "frozen", ySplit: 1 }] });
    // Summary rows sit ABOVE each employee's (collapsible) daily detail, so the
    // default view is one clean line per person with their total — expand one to
    // see their day-by-day clock in / lunch / out.
    ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
    ws.columns = [{ width: 24 }, { width: 16 }, { width: 12 }, { width: 14 }, { width: 15 }, { width: 12 }, { width: 11 }];
    const head = ws.addRow(HEADER);
    head.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16A34A" } };
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    });

    const empMap = byStore.get(store)!;
    const empIds = [...empMap.keys()].sort((a, b) => (nameOf.get(a) ?? "").localeCompare(nameOf.get(b) ?? ""));
    let storeTotal = 0;
    for (const empId of empIds) {
      const name = nameOf.get(empId) ?? "Unknown";
      const rows = empMap.get(empId)!;
      const dayData = rows.map((e) => {
        const mins = entryMinutes(e);
        return {
          mins,
          row: [
            name,
            cDate(e.clock_in_at, tz),
            cTime(e.clock_in_at, tz),
            cTime(lunchByEntry.get(e.id)?.left_at ?? null, tz),
            cTime(lunchByEntry.get(e.id)?.returned_at ?? null, tz),
            cTime(e.clock_out_at, tz),
            e.clock_out_at ? Number(hrs(mins)) : "open",
          ] as (string | number)[],
        };
      });
      const empTotal = dayData.reduce((s, d) => s + d.mins, 0);
      storeTotal += empTotal;

      // Visible summary line: name + their total.
      const sr = ws.addRow([name, "", "", "", "", "TOTAL", Number(hrs(empTotal))]);
      sr.font = { bold: true };
      sr.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } }));
      // Collapsed daily detail underneath.
      for (const d of dayData) {
        const r = ws.addRow(d.row);
        r.outlineLevel = 1;
        r.hidden = true;
      }
    }
    const grand = ws.addRow(["STORE TOTAL", "", "", "", "", "", Number(hrs(storeTotal))]);
    grand.font = { bold: true, size: 12 };
    grand.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } }));
  }

  if (storeIds.length === 0) {
    const ws = wb.addWorksheet("No data");
    ws.addRow(["No punches for this week."]);
  }

  const buf = await wb.xlsx.writeBuffer();
  const label = scopeStore && scopeStore.length === 1
    ? (siteName.get(scopeStore[0]) ?? "store").replace(/\s+/g, "-")
    : scopeStore ? `${scopeStore.length}-stores` : "all-stores";
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="RTG-payroll_${label}_${monday}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
