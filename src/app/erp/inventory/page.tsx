import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { listCycleCounts, getNegativeBalances } from "@/lib/erp/actions";
import { InventoryConsole, type StoreOption } from "@/components/erp/inventory-console";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inventory — RTG ERP" };

export default async function InventoryPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog"); // adjustments + counts are manager/admin

  const supabase = await createClient();
  // Unwrapped (ARC-02): an empty store list would silently disable every adjustment.
  const [storeRes, counts, negatives] = await Promise.all([
    supabase.from("stores").select("id,name").order("id"),
    listCycleCounts(50, 0),
    getNegativeBalances(),
  ]);
  const stores = unwrap(storeRes, "inventory: stores");

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">Inventory adjustments &amp; counts</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Cycle-count to verify on-hand, post manual adjustments (damage / shrinkage), and watch for negative
            balances. Every change is an append-only ledger movement.
          </p>
        </div>
        <InventoryConsole
          stores={(stores ?? []) as StoreOption[]}
          initialCounts={counts}
          initialNegatives={negatives}
        />
      </main>
    </>
  );
}
