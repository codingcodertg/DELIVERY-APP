import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { RequestForm } from "@/components/erp/request-form";
import { Badge } from "@/components/erp/ui/badge";
import { PILL, label } from "@/lib/erp/status";

export const dynamic = "force-dynamic";
export const metadata = { title: "Request — RTG ERP" };

const statusPill: Record<string, string> = {
  pending: PILL.amber,
  approved: PILL.green,
  rejected: PILL.red,
};

export default async function RequestPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  const supabase = await createClient();

  // Unwrapped (ARC-02): a failed read used to render the request form with empty
  // category / vendor / vocabulary pickers, which silently changes what can be submitted.
  const [catRes, vendorRes, vocabRes, myReqRes] = await Promise.all([
    supabase.from("categories").select("id,path").order("path"),
    supabase.from("vendors").select("id,name").order("name"),
    // PRF-04: this used to pull the whole catalog (`.limit(10000)`, silently capped at 1,000 of 6,528)
    // purely to derive three DISTINCT vocabularies — so ~5,500 products never contributed a value to
    // the pickers. One small aggregate instead (product_vocabulary, v4_65).
    supabase.rpc("product_vocabulary"),
    supabase
      .from("product_requests")
      .select("id,type,status,created_at,decision_note")
      .eq("requester", session.user.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const cats = unwrap(catRes, "request: categories");
  const vendors = unwrap(vendorRes, "request: vendors");
  const vocab = unwrap(vocabRes, "request: product_vocabulary") as {
    base_unit: string[];
    material: string[];
    finish: string[];
  } | null;
  const myReqs = unwrap(myReqRes, "request: my product_requests");

  const uniq = (k: "base_unit" | "material" | "finish") => vocab?.[k] ?? [];

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-semibold">New item request</h1>
        <p className="mb-5 text-sm text-slate-500">
          Submit a new product (lands as a <span className="font-medium">draft</span> for an admin to publish), or
          request an edit / reactivate / deactivate on an existing one.
        </p>
        <RequestForm
          categories={cats ?? []}
          vendors={vendors ?? []}
          baseUnits={uniq("base_unit")}
          materials={uniq("material")}
          finishes={uniq("finish")}
          canSeeCost={canSeeCost(session.role)}
        />

        {(myReqs?.length ?? 0) > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-slate-500">Your recent requests</h2>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {myReqs!.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                  <Badge className={statusPill[r.status] ?? PILL.gray}>{r.status}</Badge>
                  <span className="capitalize text-slate-600">{label(r.type)}</span>
                  {r.decision_note && <span className="text-xs text-slate-500">&ldquo;{r.decision_note}&rdquo;</span>}
                  <span className="ml-auto text-xs text-slate-400">
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
