import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/erp/header";
import { getSessionInfo } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { confirmDaltileMatch, rejectDaltileMatch } from "@/lib/erp/daltile-actions";

export const dynamic = "force-dynamic";

interface Ref {
  id: number; product_id: number; external_sku: string | null; external_url: string | null;
  external_title: string | null; series_name: string | null; nominal_size: string | null;
  match_method: string | null; match_confidence: number | null;
}

type Prod = { id: number; sku: string; name: string; mpn: string | null };

// Manager review of 'auto' Daltile suggestions (like /review/merge). High-confidence
// matches (sku/mpn/name_code) are listed first for quick confirmation; name_size
// suggestions follow. Confirm backfills products.mpn (audited) when empty.
//
// ARC-01: the product lookup used to read the BASE table `products`, on which
// `authenticated` holds no SELECT, and swallowed the resulting error — so every row
// rendered as an anonymous `#<id>` and managers confirmed matches blind into the
// golden record. It reads the app_products view now (id/sku/name/mpn are non-cost
// and already exposed there, exactly as /requests does), and both reads are
// unwrapped: a failure raises a visible error instead of an empty, confirmable list.
export default async function DaltileReviewPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (session.role !== "admin" && session.role !== "manager") redirect("/");

  const supabase = await createClient();
  const refs = unwrap(
    await supabase
      .from("product_external_refs")
      .select("id, product_id, external_sku, external_url, external_title, series_name, nominal_size, match_method, match_confidence")
      .eq("match_status", "auto")
      .order("match_confidence", { ascending: false }),
    "review/daltile: product_external_refs",
  ) as Ref[];

  const ids = refs.map((r) => r.product_id);
  const prods = ids.length
    ? (unwrap(
        await supabase.from("app_products").select("id, sku, name, mpn").in("id", ids),
        "review/daltile: app_products lookup",
      ) as Prod[])
    : [];
  const pmap = new Map(prods.map((p) => [p.id, p]));

  const high = refs.filter((r) => (r.match_confidence ?? 0) >= 0.9);
  const low = refs.filter((r) => (r.match_confidence ?? 0) < 0.9);

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-xl px-4 py-6">
        <Link href="/catalog" className="text-sm text-clay-600 hover:underline">← Catalog</Link>
        <h1 className="mt-2 text-2xl font-semibold">Daltile match review</h1>
        <p className="mt-1 text-sm text-slate-500">
          {refs.length} pending suggestion{refs.length === 1 ? "" : "s"}. Confirming a match backfills the product&apos;s
          MPN from the Daltile code (only when empty) via the audited update path. Rejected matches never reappear.
        </p>

        <Group title={`High confidence (${high.length})`} refs={high} pmap={pmap} />
        <Group title={`Name + size suggestions (${low.length})`} refs={low} pmap={pmap} />
        {refs.length === 0 && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
            Nothing to review — run the match job to generate suggestions.
          </div>
        )}
      </main>
    </>
  );
}

function Group({
  title, refs, pmap,
}: {
  title: string;
  refs: Ref[];
  pmap: Map<number, Prod>;
}) {
  if (refs.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">ERP product</th>
              <th className="px-3 py-2 text-left font-medium">→ Daltile</th>
              <th className="px-3 py-2 text-left font-medium">Method</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {refs.map((r) => {
              const p = pmap.get(r.product_id);
              return (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <Link href={`/product/${r.product_id}`} className="font-medium text-clay-600 hover:underline">
                      {p?.name ?? `#${r.product_id}`}
                    </Link>
                    <div className="font-mono text-xs text-slate-400">{p?.sku}{p?.mpn ? ` · mpn ${p.mpn}` : " · no mpn"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.external_title ?? "—"}</div>
                    <div className="text-xs text-slate-500">{[r.series_name, r.nominal_size].filter(Boolean).join(" · ")}</div>
                    {r.external_url && (
                      <a href={r.external_url} target="_blank" rel="noopener nofollow" className="text-xs text-clay-600 hover:underline">daltile.com ↗</a>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {r.match_method} · code {r.external_sku}
                    {r.match_confidence != null ? ` · ${Math.round(r.match_confidence * 100)}%` : ""}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <form action={confirmDaltileMatch.bind(null, r.id)}>
                        <button className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700">Confirm</button>
                      </form>
                      <form action={rejectDaltileMatch.bind(null, r.id)}>
                        <button className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Reject</button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
