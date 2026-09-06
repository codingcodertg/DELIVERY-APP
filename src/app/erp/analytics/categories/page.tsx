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
import { Tx } from "@/components/erp/tx";

// G-10 (D-NEXT): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan aquí.
// Las categorías son dato; `period` es el valor del selector y sale tal cual.

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
  if (!canSeeCost(session.role)) redirect("/erp/catalog"); // cost/margin surface — manager/admin only (#29)
  const sp = await searchParams;
  const period = normalizePeriod(sp?.period);
  const parent = sp?.parent || null;
  const c = await getCategoryStats(period, parent);
  const rows = c?.categories ?? [];

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <h1 className="text-2xl font-semibold"><Tx en="Analytics" es="Analítica" /></h1>
        <p className="mt-1 text-sm text-slate-500">
          <Tx en="Sales + catalog rolled up by category" es="Ventas y catálogo agrupados por categoría" /> {parent ? <>· <Tx en="drilled into" es="dentro de" /> <b>{parent}</b> (L2)</> : <Tx en="(L1 — click a row to drill)" es="(L1 — clic en una fila para entrar)" />} · <Tx en="manager view (#29)." es="vista de gerente (#29)." />
        </p>
        <div className="mt-4"><AnalyticsNav /></div>
        <AnalyticsControls period={period} />

        {parent && (
          <Link href={`/erp/analytics/categories?period=${period}`} className="mb-3 inline-block text-sm text-clay-700 hover:underline"><Tx en="← All categories" es="← Todas las categorías" /></Link>
        )}

        <div className="mb-4">
          <ChartCard title={<Tx en="Net sales by period" es="Ventas netas por periodo" />} subtitle={<>{parent ?? <Tx en="all categories" es="todas las categorías" />} · <Tx en="bucketed by" es="agrupado por" /> {period} ($)</>}>
            <BarList items={c?.trend_sales ?? []} barClass="bg-clay-500" emptyText={<Tx en="No sales." es="Sin ventas." />} />
          </ChartCard>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium"><Tx en="Category" es="Categoría" /></th>
                  <th className="px-4 py-2.5 text-right font-medium"><Tx en="Net sales" es="Ventas netas" /></th>
                  <th className="px-4 py-2.5 text-right font-medium"><Tx en="Units" es="Unidades" /></th>
                  <th className="px-4 py-2.5 text-right font-medium">GM</th>
                  <th className="px-4 py-2.5 text-right font-medium"><Tx en="Sales margin" es="Margen de ventas" /></th>
                  <th className="px-4 py-2.5 text-right font-medium"><Tx en="Products" es="Productos" /></th>
                  <th className="px-4 py-2.5 text-right font-medium"><Tx en="Inv. value" es="Valor inv." /></th>
                  <th className="px-4 py-2.5 text-right font-medium"><Tx en="List margin" es="Margen de lista" /></th>
                  <th className="px-4 py-2.5 text-right font-medium"><Tx en="Below cost" es="Bajo costo" /></th>
                  <th className="px-4 py-2.5 text-right font-medium"><Tx en="Needs review" es="Requiere revisión" /></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500"><Tx en="No category data." es="Sin datos de categorías." /></td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.category} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      {parent ? r.category : (
                        <Link href={`/erp/analytics/categories?period=${period}&parent=${encodeURIComponent(r.category)}`} className="text-clay-700 hover:underline">{r.category}</Link>
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
        <p className="mt-3 text-xs text-slate-400"><b><Tx en="Sales margin" es="Margen de ventas" /></b> <Tx en="= realized (sale prices − COGS);" es="= realizado (precios de venta − COGS);" /> <b><Tx en="List margin" es="Margen de lista" /></b> <Tx en="= catalog avg (list vs cost). Inv. value = QOH × product cost." es="= promedio del catálogo (lista frente a costo). Valor inv. = QOH × costo del producto." /></p>
      </main>
    </>
  );
}
