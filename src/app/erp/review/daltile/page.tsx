import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/erp/header";
import { getSessionInfo } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { avisoDaltileDelDemo, confirmDaltileMatch, rejectDaltileMatch } from "@/lib/erp/daltile-actions";
import { AVISO_DEL_DEMO } from "@/lib/erp/demo-data";
import { Tx } from "@/components/erp/tx";
import { TablaDeDaltile } from "@/components/erp/tablas-de-paginas";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

// G-10 (D-204): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan aquí.
// SKU, MPN, nombre, título externo, serie, tamaño, método y código son dato.

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
export default async function DaltileReviewPage({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const { aviso } = await searchParams;
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (session.role !== "admin" && session.role !== "manager") redirect("/erp/catalog");

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
        <Link href="/erp/catalog" className="text-sm text-clay-600 hover:underline"><Tx en="← Catalog" es="← Catálogo" /></Link>
        <h1 className="mt-2 text-2xl font-semibold"><Tx en="Daltile match review" es="Revisión de coincidencias Daltile" /></h1>
        <p className="mt-1 text-sm text-slate-500">
          {refs.length} {refs.length === 1 ? <Tx en="pending suggestion." es="sugerencia pendiente." /> : <Tx en="pending suggestions." es="sugerencias pendientes." />} <Tx en="Confirming a match backfills the product's MPN from the Daltile code (only when empty) via the audited update path. Rejected matches never reappear." es="Confirmar una coincidencia rellena el MPN del producto con el código Daltile (solo si está vacío) por la ruta de actualización auditada. Las rechazadas no vuelven a aparecer." />
        </p>

        {LOCAL_MODE && aviso === "demo" && <p role="status" className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{AVISO_DEL_DEMO}</p>}

        <Group id="erp-daltile-alta" title={<><Tx en="High confidence" es="Confianza alta" /> ({high.length})</>} refs={high} pmap={pmap} />
        <Group id="erp-daltile-baja" title={<><Tx en="Name + size suggestions" es="Sugerencias por nombre y tamaño" /> ({low.length})</>} refs={low} pmap={pmap} />
        {refs.length === 0 && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
            <Tx en="Nothing to review — run the match job to generate suggestions." es="Nada que revisar — ejecuta el trabajo de coincidencias para generar sugerencias." />
          </div>
        )}
      </main>
    </>
  );
}

function Group({
  id, title, refs, pmap,
}: {
  id: string;
  title: React.ReactNode;
  refs: Ref[];
  pmap: Map<number, Prod>;
}) {
  if (refs.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      <TablaDeDaltile id={id} filas={refs.map((r) => {
        const p = pmap.get(r.product_id);
        return {
          ...r, nombre: p?.name ?? `#${r.product_id}`, sku: p?.sku ?? null, mpn: p?.mpn ?? null,
          confirmar: LOCAL_MODE ? avisoDaltileDelDemo : confirmDaltileMatch.bind(null, r.id),
          rechazar: LOCAL_MODE ? avisoDaltileDelDemo : rejectDaltileMatch.bind(null, r.id),
        };
      })} />
    </section>
  );
}
