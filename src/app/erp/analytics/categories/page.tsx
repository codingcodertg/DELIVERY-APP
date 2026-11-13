import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { getCategoryStats } from "@/lib/erp/actions";
import { normalizePeriod } from "@/lib/erp/analytics";
import { GroupTabs } from "@/components/erp/group-tabs";
import { AnalyticsControls } from "@/components/erp/analytics-controls";
import { ChartCard, BarList } from "@/components/erp/charts";
import { Tx } from "@/components/erp/tx";
import { TablaDeAnalitica } from "@/components/erp/tablas-de-paginas";

// G-10 (D-204): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan aquí.
// Las categorías son dato; `period` es el valor del selector y sale tal cual.

export const dynamic = "force-dynamic";
export const metadata = { title: "Category analytics — RTG Inventory" };

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
        <div className="mt-4"><GroupTabs grupo="analytics" role={session.role} /></div>
        <AnalyticsControls period={period} />

        {parent && (
          <Link href={`/erp/analytics/categories?period=${period}`} className="mb-3 inline-block text-sm text-clay-700 hover:underline"><Tx en="← All categories" es="← Todas las categorías" /></Link>
        )}

        <div className="mb-4">
          <ChartCard title={<Tx en="Net sales by period" es="Ventas netas por periodo" />} subtitle={<>{parent ?? <Tx en="all categories" es="todas las categorías" />} · <Tx en="bucketed by" es="agrupado por" /> {period} ($)</>}>
            <BarList items={c?.trend_sales ?? []} barClass="bg-clay-500" emptyText={<Tx en="No sales." es="Sin ventas." />} />
          </ChartCard>
        </div>

        <TablaDeAnalitica id="erp-analitica-categorias" de="categoria" filas={rows.map((r) => ({
          ...r, nombre: r.category, clave: r.category,
          href: parent ? undefined : `/erp/analytics/categories?period=${period}&parent=${encodeURIComponent(r.category)}`,
        }))} />
        <p className="mt-3 text-xs text-slate-400"><b><Tx en="Sales margin" es="Margen de ventas" /></b> <Tx en="= realized (sale prices − COGS);" es="= realizado (precios de venta − COGS);" /> <b><Tx en="List margin" es="Margen de lista" /></b> <Tx en="= catalog avg (list vs cost). Inv. value = QOH × product cost." es="= promedio del catálogo (lista frente a costo). Valor inv. = QOH × costo del producto." /></p>
      </main>
    </>
  );
}
