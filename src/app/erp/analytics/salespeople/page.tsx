import { redirect } from "next/navigation";
import { Header } from "@/components/erp/header";
import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { AnalyticsNav } from "@/components/erp/analytics-nav";

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
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-slate-500">Salesperson performance · manager view.</p>
        <div className="mt-4"><AnalyticsNav /></div>

        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <h2 className="text-lg font-semibold text-slate-800">Salesperson analytics activates with the POS (M4)</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-500">
            Per-salesperson net sales, units, margin, attach rate, and leaderboards need a{" "}
            <span className="font-medium">salesperson on each sale</span> — that&apos;s captured at the point of sale, which
            lands in <span className="font-medium">M4 (Quotes &amp; POS)</span>. The historical QuickBooks pricelist export has
            no salesperson column, so there is nothing to attribute yet.
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-xs text-slate-400">
            We deliberately show no numbers here rather than fabricate an attribution. Once the POS writes a
            <code> salesperson</code> onto each sale, this tab lights up with the same period toggle + charts as the other tabs.
          </p>
        </div>
      </main>
    </>
  );
}
