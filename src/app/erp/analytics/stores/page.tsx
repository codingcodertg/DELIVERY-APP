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
import { Tx } from "@/components/erp/tx";

// G-10 (D-NEXT): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan aquí.
// Tiendas, fechas del rango y `period` son dato y salen tal cual.

export const dynamic = "force-dynamic";
export const metadata = { title: "Store analytics — RTG ERP" };

export default async function StoreAnalytics({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; store?: string }>;
}) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog"); // analytics use cost/margin — manager/admin only (#29)
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
        <h1 className="text-2xl font-semibold"><Tx en="Analytics" es="Analítica" /></h1>
        <p className="mt-1 text-sm text-slate-500">
          {s?.range_start && s?.range_end ? <><Tx en="Sales" es="Ventas" /> {s.range_start} → {s.range_end}</> : <Tx en="No sales history loaded" es="Sin historial de ventas cargado" />} · <Tx en="margin from cost (manager view, #29)." es="margen sobre costo (vista de gerente, #29)." />
        </p>
        <div className="mt-4"><AnalyticsNav /></div>
        <AnalyticsControls period={period} stores={(stores ?? []) as { id: string; name: string }[]} store={store} />

        {!s || s.txns === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            <Tx en="No sales for" es="Sin ventas de" /> {store ?? <Tx en="any store" es="ninguna tienda" />} <Tx en="in the loaded history." es="en el historial cargado." />
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label={<Tx en="Net sales" es="Ventas netas" />} value={money(s.net_sales)} />
              <Stat label={<Tx en="Units" es="Unidades" />} value={s.units.toLocaleString()} />
              <Stat label={<Tx en="Transactions" es="Transacciones" />} value={s.txns.toLocaleString()} sub={<Tx en="sales lines" es="líneas de venta" />} />
              <Stat label={<Tx en="Avg sale" es="Venta media" />} value={money(s.avg_sale)} />
              <Stat label={<Tx en="Gross margin" es="Margen bruto" />} value={money(s.gm)} sub={`COGS ${money(s.cogs)}`} />
              <Stat label={<Tx en="Margin %" es="Margen %" />} value={pct(s.margin_pct)} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ChartCard title={<Tx en="Net sales by period" es="Ventas netas por periodo" />} subtitle={<><Tx en="bucketed by" es="agrupado por" /> {period} ($)</>}>
                <BarList items={s.trend_sales} barClass="bg-clay-500" emptyText={<Tx en="No sales." es="Sin ventas." />} />
              </ChartCard>
              <ChartCard title={<Tx en="Units by period" es="Unidades por periodo" />} subtitle={<><Tx en="bucketed by" es="agrupado por" /> {period}</>}>
                <BarList items={s.trend_units} barClass="bg-sky-400" emptyText={<Tx en="No units." es="Sin unidades." />} />
              </ChartCard>
            </div>
            <div className="mt-4">
              <ChartCard title={<Tx en="Top products" es="Productos principales" />} subtitle={<Tx en="by net sales ($)" es="por ventas netas ($)" />}>
                <BarList items={s.top_products} barClass="bg-emerald-500" emptyText={<Tx en="No products." es="Sin productos." />} />
              </ChartCard>
            </div>
          </>
        )}
      </main>
    </>
  );
}
