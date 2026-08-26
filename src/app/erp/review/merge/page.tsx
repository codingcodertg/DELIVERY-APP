import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { MergeTool, type MergePair } from "@/components/erp/merge-tool";

export const dynamic = "force-dynamic";
export const metadata = { title: "Merge — RTG ERP" };

const FIELDS =
  "id,sku,name,mpn,status,record_status,category_path,vendor_name,size_in,base_unit,sf_per_box,price,cost,margin_pct,image_url";

export default async function MergePage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog");
  const supabase = await createClient();

  // Unwrapped (ARC-02): merge archives a product and aliases its SKU, so a failed read
  // must raise, never render as "no duplicates" or a pair with no candidates.
  const merges = unwrap(
    await supabase
      .from("app_products")
      .select(FIELDS)
      .ilike("sku", "%~MERGE%")
      .neq("record_status", "archived")
      .order("name"),
    "review/merge: ~MERGE losers",
  );

  const mpns = [...new Set((merges ?? []).map((m) => m.mpn).filter(Boolean))] as string[];
  const cands = mpns.length
    ? unwrap(
        await supabase.from("app_products").select(FIELDS).in("mpn", mpns).neq("record_status", "archived"),
        "review/merge: survivor candidates",
      )
    : [];

  const pairs: MergePair[] = (merges ?? []).map((loser) => ({
    loser,
    candidates: (cands ?? []).filter((c) => c.mpn === loser.mpn && c.id !== loser.id),
  }));

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <Link href="/erp/review" className="text-sm text-clay-600 hover:underline">
          ← Review queue
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Duplicate merge</h1>
        <p className="mb-5 text-sm text-slate-500">
          The M0 <span className="font-mono">~MERGE</span> pairs. Pick the survivor — the loser is archived and its
          SKU is aliased to the survivor (old tickets/QB refs still resolve). Audited.
        </p>
        <MergeTool pairs={pairs} canSeeCost={canSeeCost(session.role)} />
      </main>
    </>
  );
}
