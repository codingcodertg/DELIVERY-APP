import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { PoUpload } from "@/components/erp/po-upload";

export const dynamic = "force-dynamic";
export const metadata = { title: "PO upload — RTG ERP" };

export default async function PoUploadPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog"); // PO costs — manager+admin only (#29)
  const supabase = await createClient();
  // Unwrapped (ARC-02): an unreadable vendor list must not render as "no vendors".
  const vendors = unwrap(await supabase.from("vendors").select("id,name").order("name"), "po-upload: vendors");

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <h1 className="text-2xl font-semibold">PO upload</h1>
        <p className="mb-5 text-sm text-slate-500">
          Upload a purchase-order CSV → match lines to products (MPN → name) → unmatched lines become pre-filled draft
          products (vendor, cost, MPN captured at source). Extraction + draft creation only; the full PO lifecycle is M7.
        </p>
        <PoUpload vendors={vendors ?? []} />
      </main>
    </>
  );
}
