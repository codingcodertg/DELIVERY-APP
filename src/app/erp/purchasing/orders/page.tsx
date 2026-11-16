import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { Tx } from "@/components/erp/tx";
import { TablaDeOrdenesDeCompra } from "@/components/erp/tablas-de-paginas";
import { GroupTabs } from "@/components/erp/group-tabs";

// G-10 (D-204): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan
// aquí. El estado del pedido (o.status), proveedor, número de OC y fechas son dato. Los dos `title`
// de la columna Gap no pueden ir por <Tx> (son atributos de un server component) y se quedan en
// inglés: es la excepción anotada en la decisión.

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchase orders — RTG Inventory" };

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
        <GroupTabs grupo="purchasing" role={session.role} />
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
          <TablaDeOrdenesDeCompra filas={orders} />
        )}
      </main>
    </>
  );
}
