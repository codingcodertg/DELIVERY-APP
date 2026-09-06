import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { DecisionsUpload } from "@/components/erp/decisions-upload";
import { Tx } from "@/components/erp/tx";

// G-10 (D-NEXT): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan aquí.

export const dynamic = "force-dynamic";
export const metadata = { title: "Bulk apply — RTG ERP" };

export default async function DecisionsPage() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog"); // edits incl. cost — manager/admin only (#29)

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <h1 className="text-2xl font-semibold"><Tx en="Bulk apply — decisions CSV" es="Aplicar en lote — CSV de decisiones" /></h1>
        <p className="mb-5 text-sm text-slate-500">
          <Tx en="Upload a decisions CSV (a" es="Sube un CSV de decisiones (una columna" /> <code>sku</code> <Tx en="column plus any editable fields). Preview the per-row current→new diff and validation, then confirm. Each applied row is audited and writes price history; one bad row never kills the batch. Column schema:" es="más los campos editables que quieras). Previsualiza el cambio actual→nuevo y la validación por fila, y confirma. Cada fila aplicada queda auditada y escribe historial de precios; una fila mala nunca tumba el lote. Esquema de columnas:" /> <code>docs/csv-bulk-apply.md</code>.
        </p>
        <DecisionsUpload />
      </main>
    </>
  );
}
