import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { DecisionsUpload } from "@/components/erp/decisions-upload";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bulk apply — RTG ERP" };

export default async function DecisionsPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/"); // edits incl. cost — manager/admin only (#29)

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <h1 className="text-2xl font-semibold">Bulk apply — decisions CSV</h1>
        <p className="mb-5 text-sm text-slate-500">
          Upload a decisions CSV (a <code>sku</code> column plus any editable fields). Preview the per-row
          current→new diff and validation, then confirm. Each applied row is audited and writes price history;
          one bad row never kills the batch. Column schema: <code>docs/csv-bulk-apply.md</code>.
        </p>
        <DecisionsUpload />
      </main>
    </>
  );
}
