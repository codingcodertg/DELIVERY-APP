import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { unwrap } from "@/lib/erp/db-result";
import { PoUpload } from "@/components/erp/po-upload";
import { Tx } from "@/components/erp/tx";

// G-10 (D-204): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan aquí.

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
        <h1 className="text-2xl font-semibold"><Tx en="PO upload" es="Subir OC" /></h1>
        <p className="mb-5 text-sm text-slate-500">
          <Tx en="Upload a purchase-order CSV → match lines to products (MPN → name) → unmatched lines become pre-filled draft products (vendor, cost, MPN captured at source). Extraction + draft creation only; the full PO lifecycle is M7." es="Sube un CSV de orden de compra → casa las líneas con productos (MPN → nombre) → las que no casan se convierten en borradores prerrellenados (proveedor, costo y MPN capturados en origen). Solo extracción y creación de borradores; el ciclo completo de la OC es M7." />
        </p>
        <PoUpload vendors={vendors ?? []} />
      </main>
    </>
  );
}
