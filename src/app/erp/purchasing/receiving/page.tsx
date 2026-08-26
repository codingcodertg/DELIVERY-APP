import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { Receiving, type PoOption, type StoreOption } from "@/components/erp/receiving";

export const dynamic = "force-dynamic";
export const metadata = { title: "Receiving — RTG ERP" };

export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<{ po?: string }>;
}) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog"); // receiving touches landed cost — manager/admin only (#29)
  const sp = await searchParams;
  const initialPoId = sp?.po && Number.isFinite(Number(sp.po)) ? Number(sp.po) : undefined;

  const supabase = await createClient();
  // Unwrapped (ARC-02): an unreadable PO/store list must not render as an empty
  // receiving picker — receiving writes lots and landed cost.
  const [poRes, storeRes] = await Promise.all([
    supabase.rpc("list_purchase_orders", { p_limit: 200, p_offset: 0 }),
    supabase.from("stores").select("id,name").order("id"),
  ]);
  const poData = unwrap(poRes, "purchasing/receiving: list_purchase_orders");
  const storeData = unwrap(storeRes, "purchasing/receiving: stores");
  const pos = (((poData as { orders?: PoOption[] } | null)?.orders ?? []) as PoOption[]).filter(
    (p) => p.status !== "closed"
  );
  const stores = (storeData ?? []) as StoreOption[];

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">Receiving</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Receive stock against a logged PO (creating lots with landed cost) or manually. Every receipt posts an
            append-only <code>receive</code> movement that bumps on-hand. Landed cost is masked for staff (#29).
          </p>
        </div>
        <Receiving pos={pos} stores={stores} initialPoId={initialPoId} />
      </main>
    </>
  );
}
