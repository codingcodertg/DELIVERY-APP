import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { PoIngest } from "@/components/erp/po-ingest";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log PO / proforma — RTG ERP" };

export default async function NewPoPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog"); // PO/proforma carry cost — manager/admin only (#29)

  const supabase = await createClient();
  // Unwrapped (ARC-02): an unreadable vendor list must not render as "no vendors".
  const vendors = unwrap(await supabase.from("vendors").select("id,name").order("name"), "purchasing/orders/new: vendors");

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <div className="mb-4">
          <Link href="/erp/purchasing/orders" className="text-sm text-slate-500 hover:text-clay-700">← All orders</Link>
          <h1 className="mt-1 text-2xl font-semibold">Log PO / proforma</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Capture a purchase order or its supplier acknowledgment (proforma). Re-saving the same PO number / document
            number updates it. Once both sides are logged, the order reconciles automatically — price, quantity, and
            amount discrepancies are flagged on the order page.
          </p>
        </div>
        <PoIngest vendors={vendors ?? []} />
      </main>
    </>
  );
}
