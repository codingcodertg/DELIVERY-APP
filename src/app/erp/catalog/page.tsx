import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { CatalogTable } from "@/components/erp/catalog-table";
import { queryCatalog } from "@/lib/erp/actions";
import { CATALOG_PAGE, type CatalogFacets } from "@/lib/erp/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Catalog — RTG ERP" };

const EMPTY_FACETS: CatalogFacets = {
  total: 0, active: 0, special_order: 0, needs_review: 0,
  by_record: { all: 0, published: 0, draft: 0, pending_approval: 0, archived: 0 },
};

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ review?: string }>;
}) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  const sp = await searchParams;
  const reviewOnly = sp?.review === "1";
  const initialView = (await cookies()).get("catalog_view")?.value === "cards" ? "cards" : "table";

  const supabase = await createClient();
  // queryCatalog already returns its own error (rendered inline by CatalogTable); the
  // facet + saved-view reads are unwrapped so a failure raises instead of quietly
  // reporting "0 products" / "no saved views" (ARC-02).
  const [first, facetRes, viewRes] = await Promise.all([
    queryCatalog({ reviewOnly, offset: 0, limit: CATALOG_PAGE }),
    supabase.rpc("catalog_facets"),
    supabase.from("saved_views").select("id,name,state").eq("scope", "catalog").order("created_at"),
  ]);
  const facets = unwrap(facetRes, "catalog: catalog_facets");
  const views = unwrap(viewRes, "catalog: saved_views");
  const f = (facets ?? EMPTY_FACETS) as CatalogFacets;

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">Catalog</h1>
          <p className="text-sm text-slate-500">
            Golden-record product catalog · {f.total.toLocaleString()} products.
          </p>
        </div>
        <CatalogTable
          initialRows={first.rows}
          initialTotal={first.total}
          facets={f}
          pageSize={CATALOG_PAGE}
          canSeeCost={canSeeCost(session.role)}
          initialReviewOnly={reviewOnly}
          savedViews={(views ?? []) as { id: number; name: string; state: Record<string, unknown> }[]}
          initialError={first.error ?? null}
          initialView={initialView}
        />
      </main>
    </>
  );
}
