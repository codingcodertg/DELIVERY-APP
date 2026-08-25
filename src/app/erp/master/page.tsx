import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { MasterRoundTrip } from "@/components/erp/master-round-trip";

export const dynamic = "force-dynamic";
export const metadata = { title: "Excel round-trip — RTG ERP" };

export default async function MasterRoundTripPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/"); // bulk write surface incl. cost — manager/admin only (#29)

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <h1 className="text-2xl font-semibold">Excel round-trip — product master</h1>
        <p className="mb-5 max-w-3xl text-sm text-slate-500">
          Export the full product master to Excel, edit it there, and re-import. The database stays the
          golden record: every change previews as a per-field diff, rows changed in the DB since your export
          are quarantined (never silently clobbered), and unknown SKUs route to the draft/approval flow.
          Writes are audited and record price history. Same path ingests the owner&rsquo;s master Excel.
        </p>
        <MasterRoundTrip />
      </main>
    </>
  );
}
