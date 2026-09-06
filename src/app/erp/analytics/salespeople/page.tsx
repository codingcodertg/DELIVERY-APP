import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { AnalyticsNav } from "@/components/erp/analytics-nav";
import { Tx } from "@/components/erp/tx";

// G-10 (D-204): server component; el texto sale por la hoja <Tx en es /> y las consultas se quedan aquí.

export const dynamic = "force-dynamic";
export const metadata = { title: "Salesperson analytics — RTG ERP" };

export default async function SalespeopleAnalytics() {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  if (!canSeeCost(session.role)) redirect("/erp/catalog"); // analytics are manager/admin only (#29)

  return (
    <>
      <Header />
      <main className="mx-auto max-w-screen-2xl px-4 py-6">
        <h1 className="text-2xl font-semibold"><Tx en="Analytics" es="Analítica" /></h1>
        <p className="mt-1 text-sm text-slate-500"><Tx en="Salesperson performance · manager view." es="Rendimiento por vendedor · vista de gerente." /></p>
        <div className="mt-4"><AnalyticsNav /></div>

        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <h2 className="text-lg font-semibold text-slate-800"><Tx en="Salesperson analytics activates with the POS (M4)" es="La analítica por vendedor se activa con el POS (M4)" /></h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-500">
            <Tx en="Per-salesperson net sales, units, margin, attach rate, and leaderboards need a" es="Las ventas netas, unidades, margen, tasa de adjuntos y rankings por vendedor necesitan un" />{" "}
            <span className="font-medium"><Tx en="salesperson on each sale" es="vendedor en cada venta" /></span> <Tx en="— that's captured at the point of sale, which lands in" es="— eso se captura en el punto de venta, que llega en" /> <span className="font-medium"><Tx en="M4 (Quotes & POS)" es="M4 (Cotizaciones y POS)" /></span>. <Tx en="The historical QuickBooks pricelist export has no salesperson column, so there is nothing to attribute yet." es="La exportación histórica de la lista de precios de QuickBooks no tiene columna de vendedor, así que aún no hay nada que atribuir." />
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-xs text-slate-400">
            <Tx en="We deliberately show no numbers here rather than fabricate an attribution. Once the POS writes a" es="Aquí no se enseñan números a propósito, antes que inventar una atribución. Cuando el POS escriba un" />
            <code> salesperson</code> <Tx en="onto each sale, this tab lights up with the same period toggle + charts as the other tabs." es="en cada venta, esta pestaña se enciende con el mismo selector de periodo y las mismas gráficas que las demás." />
          </p>
        </div>
      </main>
    </>
  );
}
