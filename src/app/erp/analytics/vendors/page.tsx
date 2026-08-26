import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { getVendorStats } from "@/lib/erp/actions";
import { normalizePeriod } from "@/lib/erp/analytics";
import { AnalyticsNav } from "@/components/erp/analytics-nav";
import { AnalyticsControls } from "@/components/erp/analytics-controls";
import { ChartCard, BarList } from "@/components/erp/charts";
import { money } from "@/lib/erp/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vendor analytics — RTG ERP" };

const pct = (v: number | null) => (v == null ? "—" : `${v}%`);

export default async function VendorAnalytics({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog"); // cost/margin surface — manager/admin only (#29)
  const sp = await searchParams;
  const period = normalizePeriod(sp?.period);
  const v = await getVendorStats(period);
  const vendors = v?.vendors ?? [];

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">Sales rolled up by vendor (realized margin from cost) + catalog stats · manager view (#29).</p>
        <div className="mt-4"><AnalyticsNav /></div>
        <AnalyticsControls period={period} />

        <div className="mb-4">
          <ChartCard title="Net sales by period" subtitle={`all vendors · bucketed by ${period} ($)`}>
            <BarList items={v?.trend_sales ?? []} barClass="bg-clay-500" emptyText="No sales." />
          </ChartCard>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Vendor</th>
                  <th className="px-4 py-2.5 text-right font-medium">Net sales</th>
                  <th className="px-4 py-2.5 text-right font-medium">Units</th>
                  <th className="px-4 py-2.5 text-right font-medium">GM</th>
                  <th className="px-4 py-2.5 text-right font-medium">Sales margin</th>
                  <th className="px-4 py-2.5 text-right font-medium">Products</th>
                  <th className="px-4 py-2.5 text-right font-medium">Inv. value</th>
                  <th className="px-4 py-2.5 text-right font-medium">List margin</th>
                  <th className="px-4 py-2.5 text-right font-medium">Below cost</th>
                  <th className="px-4 py-2.5 text-right font-medium">Needs review</th>
                </tr>
              </thead>
              <tbody>
                {vendors.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500">No vendor data.</td></tr>
                )}
                {vendors.map((r) => (
                  <tr key={r.vendor_id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{r.vendor}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(r.net_sales)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{r.units.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(r.gm)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{pct(r.margin_pct)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{r.product_count.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{money(r.inventory_value)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{pct(r.avg_margin_pct)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${r.below_cost > 0 ? "text-red-600" : "text-slate-400"}`}>{r.below_cost}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${r.needs_review > 0 ? "text-amber-700" : "text-slate-400"}`}>{r.needs_review}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">Top 30 by net sales. <b>Sales margin</b> = realized (actual sale prices − COGS); <b>List margin</b> = catalog avg (list price vs cost). Inv. value = QOH × product cost.</p>
      </main>
    </>
  );
}
