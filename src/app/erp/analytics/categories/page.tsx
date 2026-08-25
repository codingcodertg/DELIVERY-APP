import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { getCategoryStats } from "@/lib/erp/actions";
import { normalizePeriod } from "@/lib/erp/analytics";
import { AnalyticsNav } from "@/components/erp/analytics-nav";
import { AnalyticsControls } from "@/components/erp/analytics-controls";
import { ChartCard, BarList } from "@/components/erp/charts";
import { money } from "@/lib/erp/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Category analytics — RTG ERP" };

const pct = (v: number | null) => (v == null ? "—" : `${v}%`);

export default async function CategoryAnalytics({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; parent?: string }>;
}) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/"); // cost/margin surface — manager/admin only (#29)
  const sp = await searchParams;
  const period = normalizePeriod(sp?.period);
  const parent = sp?.parent || null;
  const c = await getCategoryStats(period, parent);
  const rows = c?.categories ?? [];

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sales + catalog rolled up by category {parent ? <>· drilled into <b>{parent}</b> (L2)</> : "(L1 — click a row to drill)"} · manager view (#29).
        </p>
        <div className="mt-4"><AnalyticsNav /></div>
        <AnalyticsControls period={period} />

        {parent && (
          <Link href={`/analytics/categories?period=${period}`} className="mb-3 inline-block text-sm text-clay-700 hover:underline">← All categories</Link>
        )}

        <div className="mb-4">
          <ChartCard title="Net sales by period" subtitle={`${parent ?? "all categories"} · bucketed by ${period} ($)`}>
            <BarList items={c?.trend_sales ?? []} barClass="bg-clay-500" emptyText="No sales." />
          </ChartCard>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Category</th>
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
                {rows.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500">No category data.</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.category} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      {parent ? r.category : (
                        <Link href={`/analytics/categories?period=${period}&parent=${encodeURIComponent(r.category)}`} className="text-clay-700 hover:underline">{r.category}</Link>
                      )}
                    </td>
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
        <p className="mt-3 text-xs text-slate-400"><b>Sales margin</b> = realized (sale prices − COGS); <b>List margin</b> = catalog avg (list vs cost). Inv. value = QOH × product cost.</p>
      </main>
    </>
  );
}
