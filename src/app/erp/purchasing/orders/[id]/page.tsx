import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { createClient } from "@/lib/erp/supabase/server";
import { createAdminClient } from "@/lib/erp/supabase/admin";
import { PoReconcile, type ReconData } from "@/components/erp/po-reconcile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reconcile PO — RTG ERP" };

type Doc = { label: string; viewUrl: string; downloadUrl: string };

export default async function PoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog"); // cost-bearing — manager/admin only (#29)
  const canEdit = session.role === "admin" || session.role === "manager";

  const { id } = await params;
  const poId = parseInt(id, 10);
  if (!Number.isFinite(poId)) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reconcile_po", { p_po_id: poId });
  const recon = (data ?? null) as ReconData | null;

  // Signed URLs for the stored PO/proforma PDFs (private po-docs bucket; this page is mgr/admin-only, #29).
  const docs: Doc[] = [];
  // A stored PDF whose URL cannot be signed used to disappear from this page without a word — the
  // section below simply did not render. Name it instead: the document exists, the link is what
  // failed, and that difference decides whether somebody goes looking for a lost file.
  const docErrors: string[] = [];
  if (recon) {
    const refs: Array<[string, string | null | undefined]> = [
      ["Purchase order", recon.po?.source_pdf_ref],
      ["Acknowledgment", recon.ack?.source_pdf_ref],
    ];
    const stored = refs.filter((r): r is [string, string] => Boolean(r[1]));
    if (stored.length > 0) {
      try {
        const admin = createAdminClient();
        for (const [docLabel, path] of stored) {
          const [{ data: v }, { data: d }] = await Promise.all([
            admin.storage.from("po-docs").createSignedUrl(path, 3600),
            admin.storage.from("po-docs").createSignedUrl(path, 3600, { download: true }),
          ]);
          if (v?.signedUrl && d?.signedUrl) docs.push({ label: docLabel, viewUrl: v.signedUrl, downloadUrl: d.signedUrl });
          else docErrors.push(docLabel);
        }
      } catch (e) {
        // A missing or dead service key lands here. It is a deployment problem, not a data problem.
        console.error("[purchasing/orders] could not sign po-docs URLs:", e);
        for (const [docLabel] of stored) {
          if (!docs.some((x) => x.label === docLabel)) docErrors.push(docLabel);
        }
      }
    }
  }

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        {error ? (
          <div>
            <Link href="/erp/purchasing/orders" className="text-sm text-slate-500 hover:text-clay-700">← All orders</Link>
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              Failed to reconcile: {error.message}
            </p>
          </div>
        ) : !recon ? (
          notFound()
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-end">
              <Link
                href={`/purchasing/receiving?po=${poId}`}
                className="rounded-lg bg-clay-600 px-4 py-2 text-sm font-medium text-white hover:bg-clay-700"
              >
                Receive against this PO →
              </Link>
            </div>
            <PoReconcile data={recon} canEdit={canEdit} />

            {docErrors.length > 0 && (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {docErrors.join(" and ")} {docErrors.length > 1 ? "have" : "has"} a stored PDF that
                could not be opened. The file is still in storage — this is a server configuration
                problem, not a lost document.
              </p>
            )}

            {docs.length > 0 && (
              <div className="space-y-3">
                {docs.map((doc) => (
                  <section key={doc.label} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                      <h2 className="text-sm font-semibold text-slate-800">{doc.label} — document</h2>
                      <div className="ml-auto flex items-center gap-3 text-sm">
                        <a href={doc.viewUrl} target="_blank" rel="noopener noreferrer" className="text-clay-700 hover:underline">View PDF ↗</a>
                        <a href={doc.downloadUrl} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-600 hover:bg-slate-50">Download</a>
                      </div>
                    </div>
                    <iframe src={doc.viewUrl} title={`${doc.label} PDF`} className="h-[640px] w-full bg-slate-100" />
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
