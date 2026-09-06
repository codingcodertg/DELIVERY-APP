import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { statusLabel } from "@/lib/erp/status";
import { Tx } from "@/components/erp/tx";
import { ChartCard, BarList, Donut, CoverageStat, type BarItem } from "@/components/erp/charts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard — RTG ERP" };

// G-10 (D-NEXT): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan aquí.
// El rol y el correo son dato; los estados del donut son enumerados fijos y su etiqueta sale de
// statusLabel, pintada con <Tx>.

// Server-side aggregation over ALL products (dashboard_stats RPC), so the numbers are exact and
// not capped by PostgREST max-rows (the old client-side in-memory aggregation topped out at 1,000).
type DashStats = {
  total: number; active: number; special_order: number; inactive: number; discontinued: number;
  needs_review: number; categorized: number; priced: number; with_image: number;
  by_status: BarItem[]; by_tag: BarItem[]; top_categories: BarItem[]; top_vendors: BarItem[];
};
const EMPTY: DashStats = {
  total: 0, active: 0, special_order: 0, inactive: 0, discontinued: 0, needs_review: 0,
  categorized: 0, priced: 0, with_image: 0, by_status: [], by_tag: [], top_categories: [], top_vendors: [],
};
const STATUS_COLOR: Record<string, string> = {
  active: "#10b981", special_order: "#f59e0b", inactive: "#ef4444", discontinued: "#94a3b8",
};

function Kpi({ label: text, value, dot, href }: { label: React.ReactNode; value: number; dot: string; href?: string }) {
  const card = (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow">
      <div className="flex items-center gap-1.5 text-sm text-slate-500">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {text}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}

export default async function DashboardPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  const showCost = canSeeCost(session.role);
  const supabase = await createClient();

  const data = unwrap(await supabase.rpc("dashboard_stats"), "dashboard: dashboard_stats");
  const s: DashStats = { ...EMPTY, ...((data ?? {}) as Partial<DashStats>) };
  const statusSegments = s.by_status.map((x) => ({
    key: x.label,
    label: <Tx en={statusLabel(x.label).en} es={statusLabel(x.label).es} />,
    value: x.value,
    color: STATUS_COLOR[x.label] ?? "#cbd5e1",
  }));

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-8">
        <h1 className="text-2xl font-semibold"><Tx en="Dashboard" es="Panel" /></h1>
        <p className="mt-1 text-sm text-slate-500">
          <Tx en="Signed in as" es="Sesión de" /> {session.fullName ?? session.user.email} · {session.role} ·{" "}
          {showCost ? <Tx en="cost visible" es="costo visible" /> : <Tx en="cost hidden" es="costo oculto" />} <Tx en="(enforced at the database)" es="(lo impone la base de datos)" /> · {s.total.toLocaleString()} <Tx en="products." es="productos." />
        </p>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Kpi label={<Tx en="Products" es="Productos" />} value={s.total} dot="bg-slate-300" href="/erp/catalog" />
          <Kpi label={<Tx en="Active" es="Activos" />} value={s.active} dot="bg-emerald-400" />
          <Kpi label={<Tx en="Needs review" es="Requiere revisión" />} value={s.needs_review} dot="bg-amber-400" href="/erp/catalog?review=1" />
          <Kpi label={<Tx en="Special order" es="Pedido especial" />} value={s.special_order} dot="bg-sky-400" />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <CoverageStat label={<Tx en="Categorized" es="Con categoría" />} value={s.categorized} total={s.total} color="bg-clay-500" />
          <CoverageStat label={<Tx en="With image" es="Con imagen" />} value={s.with_image} total={s.total} color="bg-emerald-500" />
          <CoverageStat label={<Tx en="Has price" es="Con precio" />} value={s.priced} total={s.total} color="bg-sky-500" />
          <CoverageStat label={<Tx en="Flagged for review" es="Marcados para revisión" />} value={s.needs_review} total={s.total} color="bg-amber-400" />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Link href="/erp/catalog?review=1" className="lg:col-span-2">
            <ChartCard
              title={<Tx en="Review burn-down" es="Revisión pendiente" />}
              subtitle={<Tx en="open data-quality flags by type — click to work them in the catalog" es="banderas de calidad de datos abiertas por tipo — clic para trabajarlas en el catálogo" />}
              className="h-full transition-shadow hover:shadow"
            >
              <BarList items={s.by_tag} barClass="bg-amber-400" emptyText={<Tx en="No open flags. 🎉" es="Sin banderas abiertas. 🎉" />} />
            </ChartCard>
          </Link>
          <ChartCard title={<Tx en="Commercial status" es="Estado comercial" />} subtitle={<Tx en="catalog composition" es="composición del catálogo" />}>
            <Donut segments={statusSegments} />
          </ChartCard>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ChartCard title={<Tx en="Top categories" es="Categorías principales" />} subtitle={<Tx en="by product count (L1)" es="por número de productos (L1)" />}>
            <BarList items={s.top_categories} barClass="bg-clay-500" emptyText={<Tx en="No categories yet." es="Aún no hay categorías." />} />
          </ChartCard>
          <ChartCard title={<Tx en="Top vendors" es="Proveedores principales" />} subtitle={<Tx en="by product count" es="por número de productos" />}>
            <BarList items={s.top_vendors} barClass="bg-sky-400" emptyText={<Tx en="No vendors yet." es="Aún no hay proveedores." />} />
          </ChartCard>
        </div>

        <div className="mt-8">
          <Link
            href="/erp/catalog"
            className="inline-flex h-9 items-center rounded-md bg-clay-500 px-4 text-sm font-medium text-white hover:bg-clay-600"
          >
            <Tx en="Open catalog →" es="Abrir catálogo →" />
          </Link>
        </div>
      </main>
    </>
  );
}
