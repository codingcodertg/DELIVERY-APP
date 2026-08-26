import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { RequestReview, type ReviewRequest } from "@/components/erp/request-review";

export const dynamic = "force-dynamic";
export const metadata = { title: "Request approvals — RTG ERP" };

const EDITABLE = [
  "name", "price", "cost", "base_unit", "sf_per_box", "pieces_per_box",
  "size_in", "size_cm", "material", "finish", "mpn",
];

export default async function RequestsPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/");
  const supabase = await createClient();

  // Unwrapped (ARC-02): the approvals queue drives writes to the golden record, so a
  // failed read must raise rather than render as "nothing pending" / a request with no
  // product to compare against.
  const reqs = unwrap(
    await supabase
      .from("product_requests")
      .select("id,type,product_id,payload,reason,requester,requester_store,created_at")
      .eq("status", "pending")
      .in("type", ["edit", "reactivate", "deactivate"])
      .order("created_at", { ascending: true }),
    "requests: pending product_requests",
  );

  const productIds = [...new Set((reqs ?? []).map((r) => r.product_id).filter(Boolean))] as number[];
  const requesterIds = [...new Set((reqs ?? []).map((r) => r.requester).filter(Boolean))] as string[];

  const prods = productIds.length
    ? unwrap(
        await supabase
          .from("app_products")
          .select("id,sku,name,status,price,cost,base_unit,sf_per_box,pieces_per_box,size_in,size_cm,material,finish,mpn")
          .in("id", productIds),
        "requests: app_products",
      )
    : [];
  const profs = requesterIds.length
    ? unwrap(await supabase.schema("public").from("profiles").select("id,full_name").in("id", requesterIds), "requests: profiles")
    : [];
  const { count: newCount } = await supabase
    .from("product_requests")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending")
    .eq("type", "new");

  const prodMap = new Map((prods ?? []).map((p) => [p.id, p]));
  const profMap = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
  const enriched: ReviewRequest[] = (reqs ?? []).map((r) => ({
    ...r,
    product: r.product_id ? prodMap.get(r.product_id) ?? null : null,
    requester_name: r.requester ? profMap.get(r.requester) ?? null : null,
  }));

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <h1 className="text-2xl font-semibold">Request approvals</h1>
        <p className="mb-5 text-sm text-slate-500">
          Pending edit / reactivate / deactivate requests. Approve applies the change (audited); reject sends it back
          with a note.
          {newCount ? ` ${newCount} new-item draft(s) await publishing in the Catalog (Drafts tab).` : ""}
        </p>
        <RequestReview requests={enriched} canSeeCost={canSeeCost(session.role)} editable={EDITABLE} />
      </main>
    </>
  );
}
