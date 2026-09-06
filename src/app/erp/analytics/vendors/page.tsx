import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { getVendorStats } from "@/lib/erp/actions";
import { normalizePeriod } from "@/lib/erp/analytics";
import { AnalyticsNav } from "@/components/erp/analytics-nav";
import { AnalyticsControls } from "@/components/erp/analytics-controls";
import { ChartCard, BarList } from "@/components/erp/charts";
import { money } from "@/lib/erp/utils";
import { Tx } from "@/components/erp/tx";

// G-10 (D-NEXT): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan aquí.
// Los proveedores son dato; `period` es el valor del selector y sale tal cual.

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
        <h1 className="text-2xl font-semibold"><Tx en="Analytics" es="Analítica" /></h1>
        <p className="mt-1 text-sm text-slate-500"><Tx en="Sales rolled up by vendor (realized margin from cost) + catalog stats · manager view (#29)." es="Ventas agrupadas por proveedor (margen realizado sobre costo) y estadísticas del catálogo · vista de gerente (#29)." /></p>
        <div className="mt-4"><AnalyticsNav /></div>
        <AnalyticsControls period={period} />

        <div className="mb-4">
          <ChartCard title={<Tx en="Net sales by period" es="Ventas netas por periodo" />} subtitle={<><Tx en="all vendors · bucketed by" es="todos los proveedores · agrupado por" /> {period} ($)</>}>
            <BarList items={v?.trend_sales ?? []} barClass="bg-clay-500" emptyText={<Tx en="No sales." es="Sin ventas." />} />
          </ChartCard>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium"><Tx en="Vendor" es="Proveedor" /></th>
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
                {vendors.length === 0 && (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500"><Tx en="No vendor data." es="Sin datos de proveedores." /></td></tr>
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
        <p className="mt-3 text-xs text-slate-400"><Tx en="Top 30 by net sales." es="Los 30 primeros por ventas netas." /> <b><Tx en="Sales margin" es="Margen de ventas" /></b> <Tx en="= realized (actual sale prices − COGS);" es="= realizado (precios reales de venta − COGS);" /> <b><Tx en="List margin" es="Margen de lista" /></b> <Tx en="= catalog avg (list price vs cost). Inv. value = QOH × product cost." es="= promedio del catálogo (precio de lista frente a costo). Valor inv. = QOH × costo del producto." /></p>
      </main>
    </>
  );
}
