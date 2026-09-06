import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { cn, money } from "@/lib/erp/utils";
import { Tx } from "@/components/erp/tx";

// G-10 (D-204): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan
// aquí. El estado del pedido (o.status), proveedor, número de OC y fechas son dato. Los dos `title`
// de la columna Gap no pueden ir por <Tx> (son atributos de un server component) y se quedan en
// inglés: es la excepción anotada en la decisión.

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchase orders — RTG ERP" };

type PoRow = {
  id: number;
  po_number: string;
  vendor_name: string | null;
  po_date: string | null;
  status: string;
  currency: string | null;
  total: number | null;
  po_line_count: number;
  ack_count: number;
  ack_document_no: string | null;
  ack_date: string | null;
  ack_total: number | null;
  total_gap: number | null;
  merch_gap: number | null;
  flagged_lines: number;
  has_discrepancies: boolean;
};

const statusStyles: Record<string, string> = {
  draft: "border-slate-200 bg-slate-100 text-slate-600",
  sent: "border-sky-200 bg-sky-50 text-sky-700",
  acknowledged: "border-clay-200 bg-clay-50 text-clay-700",
  partial: "border-amber-200 bg-amber-50 text-amber-700",
  received: "border-emerald-200 bg-emerald-50 text-emerald-700",
  closed: "border-slate-200 bg-slate-100 text-slate-500",
};

export default async function PurchaseOrdersPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog"); // PO/proforma carry cost — manager/admin only (#29)

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_purchase_orders", { p_limit: 100, p_offset: 0 });
  const orders = ((data as { orders?: PoRow[] } | null)?.orders ?? []) as PoRow[];
  const flaggedCount = orders.filter((o) => o.has_discrepancies).length;

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold"><Tx en="Purchase orders" es="Órdenes de compra" /></h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              <Tx en="Logged POs and their supplier acknowledgments (proformas), reconciled line-by-line. Rows in" es="OC registradas y las confirmaciones del proveedor (proformas), conciliadas línea a línea. Las filas en" />{" "}
              <span className="font-medium text-red-600"><Tx en="red" es="rojo" /></span> <Tx en="have a price, quantity, or amount discrepancy." es="tienen una discrepancia de precio, cantidad o importe." />
              {orders.length > 0 && (
                <> {flaggedCount} <Tx en="of" es="de" /> {orders.length} {orders.length === 1 ? <Tx en="order flagged." es="orden marcada." /> : <Tx en="orders flagged." es="órdenes marcadas." />}</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/erp/purchasing/receiving"
              className="rounded-lg border border-clay-300 bg-white px-4 py-2 text-sm font-medium text-clay-700 hover:bg-clay-50"
            >
              <Tx en="Receive" es="Recibir" />
            </Link>
            <Link
              href="/erp/purchasing/orders/new"
              className="rounded-lg bg-clay-600 px-4 py-2 text-sm font-medium text-white hover:bg-clay-700"
            >
              <Tx en="Log PO / proforma" es="Registrar OC / proforma" />
            </Link>
          </div>
        </div>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <Tx en="Failed to load purchase orders:" es="No se pudieron cargar las órdenes de compra:" /> {error.message}
          </p>
        ) : orders.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            <Tx en="No purchase orders logged yet." es="Aún no hay órdenes de compra registradas." />{" "}
            <Link href="/erp/purchasing/orders/new" className="font-medium text-clay-700 hover:underline">
              <Tx en="Log your first PO →" es="Registra tu primera OC →" />
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-2.5 font-medium"><Tx en="PO #" es="OC #" /></th>
                    <th className="px-4 py-2.5 font-medium"><Tx en="Vendor" es="Proveedor" /></th>
                    <th className="px-4 py-2.5 font-medium"><Tx en="PO date" es="Fecha de OC" /></th>
                    <th className="px-4 py-2.5 font-medium"><Tx en="Status" es="Estado" /></th>
                    <th className="px-4 py-2.5 text-right font-medium"><Tx en="PO total" es="Total de OC" /></th>
                    <th className="px-4 py-2.5 font-medium">Proforma</th>
                    <th className="px-4 py-2.5 text-right font-medium" title="merchandise vs PO (excl. tax &amp; freight)"><Tx en="Gap" es="Diferencia" /></th>
                    <th className="px-4 py-2.5 font-medium"><Tx en="Discrepancies" es="Discrepancias" /></th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className={cn("border-t border-slate-100 hover:bg-slate-50/60", o.has_discrepancies && "bg-red-50/40")}>
                      <td className="px-4 py-2.5">
                        <Link href={`/erp/purchasing/orders/${o.id}`} className="font-medium text-clay-700 hover:underline">
                          {o.po_number}
                        </Link>
                        <div className="text-xs text-slate-400">{o.po_line_count} {o.po_line_count === 1 ? <Tx en="line" es="línea" /> : <Tx en="lines" es="líneas" />}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{o.vendor_name ?? "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-600">{o.po_date ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", statusStyles[o.status] ?? statusStyles.draft)}>
                          {o.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(o.total)}</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {o.ack_document_no ? (
                          <>
                            <span className="font-mono text-xs">{o.ack_document_no}</span>
                            <div className="text-xs text-slate-400">{o.ack_date ?? "—"}</div>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400"><Tx en="— none —" es="— ninguna —" /></span>
                        )}
                      </td>
                      <td className={cn("px-4 py-2.5 text-right tabular-nums", o.merch_gap != null && Math.abs(o.merch_gap) >= 0.005 ? "font-medium text-red-600" : "text-slate-400")} title="merchandise vs PO (excl. tax & freight)">
                        {o.merch_gap == null ? "—" : `${o.merch_gap > 0 ? "+" : ""}${money(o.merch_gap)}`}
                      </td>
                      <td className="px-4 py-2.5">
                        {o.has_discrepancies ? (
                          <Link href={`/erp/purchasing/orders/${o.id}`} className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100">
                            ⚑ {o.flagged_lines} <Tx en="flagged" es="marcadas" />
                          </Link>
                        ) : o.ack_count > 0 ? (
                          <span className="text-xs text-emerald-600">✓ <Tx en="clean" es="limpia" /></span>
                        ) : (
                          <span className="text-xs text-slate-400"><Tx en="awaiting proforma" es="esperando proforma" /></span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
