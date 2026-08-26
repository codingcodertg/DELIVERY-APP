import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { ReviewQueue, type ReviewRow, type TagFacet } from "@/components/erp/review-queue";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review queue — RTG ERP" };

// PRF-01: this page used one `.limit(10000)` request. The PostgREST cap is 1,000, so 1,350 of the
// 2,350 flagged products were invisible — deterministically the same tail, ordered by name, with no
// error surfaced. It is now server-paged with an exact count, and the burn-down pills come from an
// aggregate over the WHOLE flagged set (review_tag_facets, v4_65) rather than from whatever rows the
// page happened to load — the pills under-reported by the same ~57% before.
const PAGE_SIZE = 250;

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ issue?: string; q?: string; page?: string }>;
}) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog");

  const sp = await searchParams;
  const issue = sp.issue?.trim() || "all";
  const q = sp.q?.trim() || "";
  const page = Math.max(1, Number(sp.page) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();

  let qb = supabase
    .from("app_products")
    .select(
      "id,sku,name,status,category_path,vendor_name,price,cost,margin_pct,review_tags,sf_per_box,base_unit",
      { count: "exact" }
    )
    .eq("needs_review", true);
  if (issue !== "all") qb = qb.contains("review_tags", [issue]);
  if (q) {
    const safe = q.replace(/[%,()]/g, "");
    qb = qb.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,vendor_name.ilike.%${safe}%`);
  }

  const [queueRes, viewRes, facetRes] = await Promise.all([
    qb.order("name").range(from, from + PAGE_SIZE - 1),
    supabase.from("saved_views").select("id,name,state").eq("scope", "review").order("created_at"),
    supabase.rpc("review_tag_facets"),
  ]);

  // The queue read keeps its inline error panel; the others are unwrapped so a failure raises
  // instead of silently rendering an empty queue or zeroed pills (ARC-02).
  const views = unwrap(viewRes, "review: saved_views");
  const facets = unwrap(facetRes, "review: review_tag_facets") as {
    total: number;
    tags: TagFacet[];
  } | null;

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Review queue</h1>
            <p className="text-sm text-slate-500">
              Resolve M0 data-quality flags — edit a value (drawer) or clear a tag. Every change is audited.
            </p>
          </div>
          <Link
            href="/erp/review/merge"
            className="inline-flex h-9 shrink-0 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Duplicate merge →
          </Link>
        </div>
        {queueRes.error ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {queueRes.error.message}
          </p>
        ) : (
          <ReviewQueue
            rows={(queueRes.data ?? []) as ReviewRow[]}
            matching={queueRes.count ?? 0}
            flaggedTotal={facets?.total ?? 0}
            facets={facets?.tags ?? []}
            issue={issue}
            q={q}
            page={page}
            pageSize={PAGE_SIZE}
            canSeeCost={canSeeCost(session.role)}
            savedViews={(views ?? []) as { id: number; name: string; state: Record<string, unknown> }[]}
          />
        )}
      </main>
    </>
  );
}
