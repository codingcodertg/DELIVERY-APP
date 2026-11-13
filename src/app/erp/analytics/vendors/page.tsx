import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { getVendorStats } from "@/lib/erp/actions";
import { normalizePeriod } from "@/lib/erp/analytics";
import { GroupTabs } from "@/components/erp/group-tabs";
import { AnalyticsControls } from "@/components/erp/analytics-controls";
import { ChartCard, BarList } from "@/components/erp/charts";
import { money } from "@/lib/erp/utils";
import { Tx } from "@/components/erp/tx";
import { TablaDeAnalitica } from "@/components/erp/tablas-de-paginas";

// G-10 (D-204): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan aquí.
// Los proveedores son dato; `period` es el valor del selector y sale tal cual.

export const dynamic = "force-dynamic";
export const metadata = { title: "Vendor analytics — RTG Inventory" };

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
        <div className="mt-4"><GroupTabs grupo="analytics" role={session.role} /></div>
        <AnalyticsControls period={period} />

        <div className="mb-4">
          <ChartCard title={<Tx en="Net sales by period" es="Ventas netas por periodo" />} subtitle={<><Tx en="all vendors · bucketed by" es="todos los proveedores · agrupado por" /> {period} ($)</>}>
            <BarList items={v?.trend_sales ?? []} barClass="bg-clay-500" emptyText={<Tx en="No sales." es="Sin ventas." />} />
          </ChartCard>
        </div>

        <TablaDeAnalitica id="erp-analitica-proveedores" de="proveedor" filas={vendors.map((r) => ({ ...r, nombre: r.vendor, clave: String(r.vendor_id) }))} />
        <p className="mt-3 text-xs text-slate-400"><Tx en="Top 30 by net sales." es="Los 30 primeros por ventas netas." /> <b><Tx en="Sales margin" es="Margen de ventas" /></b> <Tx en="= realized (actual sale prices − COGS);" es="= realizado (precios reales de venta − COGS);" /> <b><Tx en="List margin" es="Margen de lista" /></b> <Tx en="= catalog avg (list price vs cost). Inv. value = QOH × product cost." es="= promedio del catálogo (precio de lista frente a costo). Valor inv. = QOH × costo del producto." /></p>
      </main>
    </>
  );
}
