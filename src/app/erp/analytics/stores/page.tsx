import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { getStoreStats } from "@/lib/erp/actions";
import { normalizePeriod } from "@/lib/erp/analytics";
import { AnalyticsNav } from "@/components/erp/analytics-nav";
import { AnalyticsControls } from "@/components/erp/analytics-controls";
import { ChartCard, BarList, Stat } from "@/components/erp/charts";
import { money } from "@/lib/erp/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Store analytics — RTG ERP" };

export default async function StoreAnalytics({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; store?: string }>;
}) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/"); // analytics use cost/margin — manager/admin only (#29)
  const sp = await searchParams;
  const period = normalizePeriod(sp?.period);
  const store = sp?.store || null;

  const supabase = await createClient();
  const [storeRes, s] = await Promise.all([
    supabase.from("stores").select("id,name").order("id"),
    getStoreStats(period, store),
  ]);
  const stores = unwrap(storeRes, "analytics/stores: stores");
  const pct = (v: number | null) => (v == null ? "—" : `${v}%`);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">
          {s?.range_start && s?.range_end ? `Sales ${s.range_start} → ${s.range_end}` : "No sales history loaded"} · margin from cost (manager view, #29).
        </p>
        <div className="mt-4"><AnalyticsNav /></div>
        <AnalyticsControls period={period} stores={(stores ?? []) as { id: string; name: string }[]} store={store} />

        {!s || s.txns === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            No sales for {store ?? "any store"} in the loaded history.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Net sales" value={money(s.net_sales)} />
              <Stat label="Units" value={s.units.toLocaleString()} />
              <Stat label="Transactions" value={s.txns.toLocaleString()} sub="sales lines" />
              <Stat label="Avg sale" value={money(s.avg_sale)} />
              <Stat label="Gross margin" value={money(s.gm)} sub={`COGS ${money(s.cogs)}`} />
              <Stat label="Margin %" value={pct(s.margin_pct)} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ChartCard title="Net sales by period" subtitle={`bucketed by ${period} ($)`}>
                <BarList items={s.trend_sales} barClass="bg-clay-500" emptyText="No sales." />
              </ChartCard>
              <ChartCard title="Units by period" subtitle={`bucketed by ${period}`}>
                <BarList items={s.trend_units} barClass="bg-sky-400" emptyText="No units." />
              </ChartCard>
            </div>
            <div className="mt-4">
              <ChartCard title="Top products" subtitle="by net sales ($)">
                <BarList items={s.top_products} barClass="bg-emerald-500" emptyText="No products." />
              </ChartCard>
            </div>
          </>
        )}
      </main>
    </>
  );
}
