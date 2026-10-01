import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { RequestForm, type Vocabulario } from "@/components/erp/request-form";
import { RequestReadyToggle } from "@/components/erp/request-ready-toggle";
import { Badge } from "@/components/erp/ui/badge";
import { PILL, statusLabel } from "@/lib/erp/status";
import { Tx } from "@/components/erp/tx";

// G-10 (D-204): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan aquí.
// Estado y tipo de cada solicitud son enumerados fijos: statusLabel pintado con <Tx>. La nota de
// decisión es dato.

export const dynamic = "force-dynamic";
export const metadata = { title: "Request — RTG ERP" };

const statusPill: Record<string, string> = {
  pending: PILL.amber,
  approved: PILL.green,
  rejected: PILL.red,
};

type MiSolicitud = {
  id: number;
  type: string;
  status: string;
  created_at: string;
  decision_note: string | null;
  requester_store: string | null;
  /** Columna de la 158; sin ella aplicada no viene (por eso el select es `*`, no una lista). */
  requester_status?: string | null;
};

export default async function RequestPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  const supabase = await createClient();

  // Unwrapped (ARC-02): a failed read used to render the request form with empty
  // category / vendor / vocabulary pickers, which silently changes what can be submitted.
  const [catRes, vendorRes, storeRes, vocabRes, myReqRes] = await Promise.all([
    supabase.from("categories").select("id,path").order("path"),
    supabase.from("vendors").select("id,name").order("name"),
    supabase.from("stores").select("id,name").order("id"),
    // PRF-04: this used to pull the whole catalog (`.limit(10000)`, silently capped at 1,000 of 6,528)
    // purely to derive three DISTINCT vocabularies — so ~5,500 products never contributed a value to
    // the pickers. One small aggregate instead (product_vocabulary, v4_65; style y color desde la 158).
    supabase.rpc("product_vocabulary"),
    // `*` a propósito: requester_status solo existe con la 158 aplicada; una lista de columnas
    // tumbaría la página entera hasta entonces.
    supabase
      .from("product_requests")
      .select("*")
      .eq("requester", session.user.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const cats = unwrap(catRes, "request: categories");
  const vendors = unwrap(vendorRes, "request: vendors");
  const stores = unwrap(storeRes, "request: stores");
  const vocab = unwrap(vocabRes, "request: product_vocabulary") as Partial<Vocabulario> | null;
  const myReqs = unwrap(myReqRes, "request: my product_requests") as MiSolicitud[] | null;

  const uniq = (k: keyof Vocabulario) => vocab?.[k] ?? [];

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-semibold"><Tx en="Item request" es="Solicitud de artículo" /></h1>
        <p className="mb-5 text-sm text-slate-500">
          <Tx en="Create a new item or a copy of one (lands as a" es="Crea un artículo nuevo o una copia de otro (entra como" /> <span className="font-medium"><Tx en="draft" es="borrador" /></span> <Tx en="for an admin to publish), or request a change / reactivate / deactivate / discontinue on an existing one." es="para que un admin lo publique), o pide un cambio / reactivar / desactivar / descontinuar uno existente." />
        </p>
        <RequestForm
          categories={cats ?? []}
          vendors={vendors ?? []}
          stores={stores ?? []}
          vocab={{ base_unit: uniq("base_unit"), material: uniq("material"), finish: uniq("finish"), style: uniq("style"), color: uniq("color") }}
          canSeeCost={canSeeCost(session.role)}
        />

        {(myReqs?.length ?? 0) > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-slate-500"><Tx en="Your recent requests" es="Tus solicitudes recientes" /></h2>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {myReqs!.map((r) => {
                const noLista = r.requester_status === "not_ready";
                return (
                  <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                    <span className="text-slate-600"><Tx en={statusLabel(r.type).en} es={statusLabel(r.type).es} /></span>
                    {r.requester_store && <span className="text-xs text-slate-400">{r.requester_store}</span>}
                    {r.requester_status && (
                      <Badge className={noLista ? PILL.gray : PILL.blue}>
                        <Tx en="Requester" es="Solicitante" />: <Tx en={statusLabel(r.requester_status).en} es={statusLabel(r.requester_status).es} />
                      </Badge>
                    )}
                    <Badge className={statusPill[r.status] ?? PILL.gray}>
                      <Tx en="Executor" es="Ejecutor" />: <Tx en={statusLabel(r.status).en} es={statusLabel(r.status).es} />
                    </Badge>
                    {r.decision_note && <span className="text-xs text-slate-500"><Tx en="Executor comments" es="Comentarios del ejecutor" />: &ldquo;{r.decision_note}&rdquo;</span>}
                    {r.status === "pending" && r.requester_status && <RequestReadyToggle requestId={r.id} ready={!noLista} />}
                    <span className="ml-auto text-xs text-slate-400">
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
