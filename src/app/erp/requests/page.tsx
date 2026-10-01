import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { RequestReview, type ReviewRequest } from "@/components/erp/request-review";
import { Tx } from "@/components/erp/tx";
import { CAMPOS_DE_EDICION, TIPOS_DEL_EJECUTOR, TIPOS_QUE_CREAN_BORRADOR } from "@/lib/erp/solicitud-campos";

// G-10 (D-204): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan aquí.

export const dynamic = "force-dynamic";
export const metadata = { title: "Request approvals — RTG ERP" };

/** Los campos que una solicitud de cambio puede proponer (la hoja del dueño, solicitud-campos.ts). */
const EDITABLE = CAMPOS_DE_EDICION.map((c) => c.key);

export default async function RequestsPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog");
  const supabase = await createClient();

  // Unwrapped (ARC-02): the approvals queue drives writes to the golden record, so a
  // failed read must raise rather than render as "nothing pending" / a request with no
  // product to compare against.
  // `*` a propósito: requester_status (REQUESTER STATUS) solo existe con la 158 aplicada.
  const reqs = unwrap(
    await supabase
      .from("product_requests")
      .select("*")
      .eq("status", "pending")
      .in("type", [...TIPOS_DEL_EJECUTOR])
      .order("created_at", { ascending: true }),
    "requests: pending product_requests",
  ) as ReviewRequest[] | null;

  const productIds = [...new Set((reqs ?? []).map((r) => r.product_id).filter(Boolean))] as number[];
  const requesterIds = [...new Set((reqs ?? []).map((r) => r.requester).filter(Boolean))] as string[];

  // La lista de columnas se construye (no es un literal), así que supabase no infiere la fila: se tipa aquí.
  type Prod = { id: number; sku: string; name: string; status: string; qoh: number | null; [k: string]: unknown };
  const prods = productIds.length
    ? (unwrap(
        await supabase
          .from("app_products")
          .select("id,sku,name,status,qoh," + EDITABLE.join(","))
          .in("id", productIds),
        "requests: app_products",
      ) as unknown as Prod[] | null)
    : [];
  const profs = requesterIds.length
    ? unwrap(await supabase.schema("public").from("profiles").select("id,full_name").in("id", requesterIds), "requests: profiles")
    : [];
  const { count: newCount } = await supabase
    .from("product_requests")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending")
    .in("type", [...TIPOS_QUE_CREAN_BORRADOR]);

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
        <h1 className="text-2xl font-semibold"><Tx en="Request approvals" es="Aprobación de solicitudes" /></h1>
        <p className="mb-5 text-sm text-slate-500">
          <Tx en="Pending change / reactivate / deactivate / discontinue requests. Approve applies the change (audited); reject sends it back with a note. A request the requester marked NOT READY waits." es="Solicitudes pendientes de cambio / reactivar / desactivar / descontinuar. Aprobar aplica el cambio (auditado); rechazar la devuelve con una nota. Una solicitud que el solicitante marcó NO LISTA espera." />
          {newCount ? <> {newCount} <Tx en="new-item / copy draft(s) await publishing in the Catalog (Drafts tab)." es="borrador(es) de artículo nuevo o copia esperan publicación en el Catálogo (pestaña Borradores)." /></> : ""}
        </p>
        <RequestReview requests={enriched} canSeeCost={canSeeCost(session.role)} editable={EDITABLE} />
      </main>
    </>
  );
}
