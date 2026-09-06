import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { MasterRoundTrip } from "@/components/erp/master-round-trip";
import { Tx } from "@/components/erp/tx";

// G-10 (D-NEXT): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan aquí.

export const dynamic = "force-dynamic";
export const metadata = { title: "Excel round-trip — RTG ERP" };

export default async function MasterRoundTripPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog"); // bulk write surface incl. cost — manager/admin only (#29)

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <h1 className="text-2xl font-semibold"><Tx en="Excel round-trip — product master" es="Ida y vuelta Excel — maestro de productos" /></h1>
        <p className="mb-5 max-w-3xl text-sm text-slate-500">
          <Tx en="Export the full product master to Excel, edit it there, and re-import. The database stays the golden record: every change previews as a per-field diff, rows changed in the DB since your export are quarantined (never silently clobbered), and unknown SKUs route to the draft/approval flow. Writes are audited and record price history. Same path ingests the owner's master Excel." es="Exporta el maestro de productos completo a Excel, edítalo allí y vuelve a importarlo. La base sigue siendo el registro maestro: cada cambio se previsualiza campo a campo, las filas que cambiaron en la base desde tu exportación quedan en cuarentena (nunca se pisan en silencio) y los SKU desconocidos van al flujo de borrador/aprobación. Las escrituras quedan auditadas y registran historial de precios. Por el mismo camino entra el Excel maestro del dueño." />
        </p>
        <MasterRoundTrip />
      </main>
    </>
  );
}
