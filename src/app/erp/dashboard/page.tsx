import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { label } from "@/lib/erp/status";
import { ChartCard, BarList, Donut, CoverageStat, type BarItem } from "@/components/erp/charts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard — RTG ERP" };

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

function Kpi({ label: text, value, dot, href }: { label: string; value: number; dot: string; href?: string }) {
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
    label: label(x.label),
    value: x.value,
    color: STATUS_COLOR[x.label] ?? "#cbd5e1",
  }));

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-8">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Signed in as {session.fullName ?? session.user.email} · {session.role} · cost{" "}
          {showCost ? "visible" : "hidden"} (enforced at the database) · {s.total.toLocaleString()} products.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Kpi label="Products" value={s.total} dot="bg-slate-300" href="/catalog" />
          <Kpi label="Active" value={s.active} dot="bg-emerald-400" />
          <Kpi label="Needs review" value={s.needs_review} dot="bg-amber-400" href="/catalog?review=1" />
          <Kpi label="Special order" value={s.special_order} dot="bg-sky-400" />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <CoverageStat label="Categorized" value={s.categorized} total={s.total} color="bg-clay-500" />
          <CoverageStat label="With image" value={s.with_image} total={s.total} color="bg-emerald-500" />
          <CoverageStat label="Has price" value={s.priced} total={s.total} color="bg-sky-500" />
          <CoverageStat label="Flagged for review" value={s.needs_review} total={s.total} color="bg-amber-400" />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Link href="/catalog?review=1" className="lg:col-span-2">
            <ChartCard
              title="Review burn-down"
              subtitle="open data-quality flags by type — click to work them in the catalog"
              className="h-full transition-shadow hover:shadow"
            >
              <BarList items={s.by_tag} barClass="bg-amber-400" emptyText="No open flags. 🎉" />
            </ChartCard>
          </Link>
          <ChartCard title="Commercial status" subtitle="catalog composition">
            <Donut segments={statusSegments} />
          </ChartCard>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ChartCard title="Top categories" subtitle="by product count (L1)">
            <BarList items={s.top_categories} barClass="bg-clay-500" emptyText="No categories yet." />
          </ChartCard>
          <ChartCard title="Top vendors" subtitle="by product count">
            <BarList items={s.top_vendors} barClass="bg-sky-400" emptyText="No vendors yet." />
          </ChartCard>
        </div>

        <div className="mt-8">
          <Link
            href="/catalog"
            className="inline-flex h-9 items-center rounded-md bg-clay-500 px-4 text-sm font-medium text-white hover:bg-clay-600"
          >
            Open catalog →
          </Link>
        </div>
      </main>
    </>
  );
}
