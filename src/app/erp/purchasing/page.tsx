import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { PurchasingGroups, type PGroup } from "@/components/erp/purchasing-groups";
import { ReorderPanel, type ReorderItem } from "@/components/erp/reorder-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchasing — RTG ERP" };

const PAGE_SIZE = 25;

type Stats = { total_groups?: number; total_grouped_products?: number; groups?: PGroup[] };
type Reorder = { total?: number; store?: string | null; items?: ReorderItem[] };

export default async function PurchasingPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; store?: string }>;
}) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog"); // supplier cost comparison + reorder — manager/admin only (#29)
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp?.page ?? "1", 10) || 1);
  const store = sp?.store || null;

  const supabase = await createClient();
  // The groups RPC keeps its inline error panel (the page is still useful without it);
  // the reorder + store reads are unwrapped so a failure is raised, not rendered as
  // "nothing to reorder" (ARC-02).
  const [{ data, error }, reorderRes, storesRes] = await Promise.all([
    supabase.rpc("purchasing_groups", { p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE }),
    supabase.rpc("reorder_report", { p_store: store, p_limit: 100, p_offset: 0 }),
    supabase.from("stores").select("id,name").order("id"),
  ]);
  const reorderData = unwrap(reorderRes, "purchasing: reorder_report");
  const stores = unwrap(storesRes, "purchasing: stores");
  const d = (data ?? {}) as Stats;
  const total = d.total_groups ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const reorder = (reorderData ?? {}) as Reorder;

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Smart Purchasing</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Items at or below their reorder point (real ledger on-hand vs demand-based reorder points), then the same
              physical product grouped across SKUs &amp; suppliers so you can pick the best source. {total.toLocaleString()}{" "}
              comparison groups ({(d.total_grouped_products ?? 0).toLocaleString()} products). Comparison is read-only — it
              never merges or dup-flags.
            </p>
          </div>
          <Link
            href="/erp/purchasing/categories"
            className="shrink-0 rounded-lg border border-clay-300 bg-white px-4 py-2 text-sm font-medium text-clay-700 hover:bg-clay-50"
          >
            Browse by category →
          </Link>
        </div>

        <ReorderPanel
          items={reorder.items ?? []}
          total={reorder.total ?? 0}
          store={store}
          stores={(stores ?? []) as { id: string; name: string }[]}
        />

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Failed to load purchasing groups: {error.message}
          </p>
        ) : (
          <PurchasingGroups
            groups={d.groups ?? []}
            page={page}
            pages={pages}
            canSeeCost={canSeeCost(session.role)}
          />
        )}
      </main>
    </>
  );
}
