import Link from "next/link";
import { cn, money } from "@/lib/erp/utils";
import { PoLineLink } from "@/components/erp/po-line-link";

// Shapes returned by the reconcile_po RPC (v4_29). Cost-bearing → page is mgr/admin only (#29).
export type ReconLine = {
  mpn: string | null;
  description: string | null;
  sf_per_box: number | null;
  line_status: "matched" | "po_only" | "ack_only";
  po_line_no: number | null;
  po_qty: number | null;
  po_uom: string | null;
  po_unit_rate: number | null;
  po_amount: number | null;
  po_unit_per_pi2: number | null;
  po_boxes: number | null;
  ack_line_no: number | null;
  ack_uom: string | null;
  ack_quantity: number | null;
  ack_boxes: number | null;
  ack_unit_price: number | null;
  ack_amount: number | null;
  price_pct: number | null;
  price_flag: boolean;
  qty_diff: number | null;
  qty_pct: number | null;
  qty_flag: boolean;
  total_diff: number | null;
  total_pct: number | null;
  total_flag: boolean;
  product_id: number | null;
  po_line_id: number | null;
  ack_line_id: number | null;
};
export type ReconData = {
  po: {
    id: number;
    po_number: string;
    vendor_name: string | null;
    po_date: string | null;
    buyer_user: string | null;
    currency: string | null;
    status: string;
    ship_to_name: string | null;
    total: number | null;
    source_pdf_ref: string | null;
  };
  ack: {
    ack_document_no: string;
    ack_date: string | null;
    order_type: string | null;
    incoterm: string | null;
    payment_terms: string | null;
    salesperson: string | null;
    currency: string | null;
    freight: number | null;
    iva_pct: number | null;
    total: number | null;
    source_pdf_ref: string | null;
  } | null;
  lines: ReconLine[];
  summary: {
    line_count: number;
    matched: number;
    po_only: number;
    ack_only: number;
    price_flags: number;
    qty_flags: number;
    total_flags: number;
    flagged_lines: number;
    po_total: number | null;
    ack_total: number | null;
    total_gap: number | null;
    total_gap_pct: number | null;
    ack_merchandise: number | null;
    merch_gap: number | null;
    merch_gap_pct: number | null;
    tax_and_freight: number | null;
    ack_count: number;
    has_discrepancies: boolean;
  };
  tolerances: { price_pct: number; qty_pct: number; total_pct: number };
};

const n = (v: number | null | undefined, d = 2) =>
  v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d });
const pct = (v: number | null | undefined) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const unit = (v: number | null | undefined) =>
  v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

function StatusPill({ s }: { s: string }) {
  const styles: Record<string, string> = {
    draft: "border-slate-200 bg-slate-100 text-slate-600",
    sent: "border-sky-200 bg-sky-50 text-sky-700",
    acknowledged: "border-clay-200 bg-clay-50 text-clay-700",
    partial: "border-amber-200 bg-amber-50 text-amber-700",
    received: "border-emerald-200 bg-emerald-50 text-emerald-700",
    closed: "border-slate-200 bg-slate-100 text-slate-500",
  };
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", styles[s] ?? styles.draft)}>{s}</span>
  );
}

function Flag({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span className={cn("tabular-nums", on && "font-semibold text-red-600")}>
      {children}
      {on && <span className="ml-1" aria-hidden>⚑</span>}
    </span>
  );
}

export function PoReconcile({ data, canEdit }: { data: ReconData; canEdit: boolean }) {
  const { po, ack, lines, summary } = data;
  const hasGap = summary.has_discrepancies;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/erp/purchasing/orders" className="text-sm text-slate-500 hover:text-clay-700">
          ← All orders
        </Link>
        <h1 className="text-2xl font-semibold">PO {po.po_number}</h1>
        <StatusPill s={po.status} />
        <span className="text-sm text-slate-500">{po.vendor_name ?? "—"}</span>
      </div>

      {/* Discrepancy banner */}
      {hasGap ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <div className="font-semibold">
            {summary.flagged_lines} of {summary.line_count} line{summary.line_count === 1 ? "" : "s"} flagged
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-red-700">
            {summary.price_flags > 0 && <span>{summary.price_flags} price gap</span>}
            {summary.qty_flags > 0 && <span>{summary.qty_flags} qty gap</span>}
            {summary.total_flags > 0 && <span>{summary.total_flags} amount gap</span>}
            {summary.po_only > 0 && <span>{summary.po_only} on PO only</span>}
            {summary.ack_only > 0 && <span>{summary.ack_only} on proforma only</span>}
            {summary.merch_gap != null && summary.merch_gap !== 0 && (
              <span className="font-semibold">
                Merchandise gap {money(summary.merch_gap)} ({pct(summary.merch_gap_pct)})
              </span>
            )}
            {summary.tax_and_freight != null && summary.tax_and_freight !== 0 && (
              <span className="text-red-500">+ {money(summary.tax_and_freight)} tax/freight (not a discrepancy)</span>
            )}
          </div>
        </div>
      ) : ack ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Proforma matches the PO within tolerance — no discrepancies.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          No supplier acknowledgment logged yet. Log the proforma to reconcile.
        </div>
      )}

      {/* Two-up totals */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Ordered — PO</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{money(po.total)}</div>
          <dl className="mt-2 space-y-0.5 text-xs text-slate-500">
            <div className="flex justify-between"><dt>PO date</dt><dd>{po.po_date ?? "—"}</dd></div>
            <div className="flex justify-between"><dt>Buyer</dt><dd>{po.buyer_user ?? "—"}</dd></div>
            <div className="flex justify-between"><dt>Ship to</dt><dd className="truncate pl-2">{po.ship_to_name ?? "—"}</dd></div>
            <div className="flex justify-between"><dt>Currency</dt><dd>{po.currency ?? "—"}</dd></div>
          </dl>
        </div>
        <div className={cn("rounded-2xl border bg-white p-4 shadow-sm", hasGap ? "border-red-200" : "border-slate-200")}>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Acknowledged — proforma</div>
          {ack ? (
            <>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-semibold tabular-nums">{money(ack.total)}</span>
                {summary.merch_gap != null && summary.merch_gap !== 0 && (
                  <span className={cn("text-sm font-medium tabular-nums", summary.merch_gap > 0 ? "text-red-600" : "text-emerald-600")} title="merchandise vs PO (excl. tax & freight)">
                    {summary.merch_gap > 0 ? "+" : ""}{money(summary.merch_gap)} merch
                  </span>
                )}
              </div>
              {summary.tax_and_freight != null && summary.tax_and_freight !== 0 && (
                <div className="mt-0.5 text-xs text-slate-400">
                  merchandise {money(summary.ack_merchandise)} + {money(summary.tax_and_freight)} tax &amp; freight
                  {summary.ack_count > 1 ? ` · ${summary.ack_count} acknowledgments` : ""}
                </div>
              )}
              <dl className="mt-2 space-y-0.5 text-xs text-slate-500">
                <div className="flex justify-between"><dt>Doc no.</dt><dd className="font-mono">{ack.ack_document_no}</dd></div>
                <div className="flex justify-between"><dt>Ack date</dt><dd>{ack.ack_date ?? "—"}</dd></div>
                <div className="flex justify-between"><dt>Incoterm</dt><dd className="truncate pl-2">{ack.incoterm ?? "—"}</dd></div>
                <div className="flex justify-between"><dt>Payment</dt><dd className="truncate pl-2">{ack.payment_terms ?? "—"}</dd></div>
                <div className="flex justify-between"><dt>Salesperson</dt><dd className="truncate pl-2">{ack.salesperson ?? "—"}</dd></div>
              </dl>
            </>
          ) : (
            <div className="mt-1 text-sm text-slate-400">—</div>
          )}
        </div>
      </div>

      {/* Per-line reconciliation */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 text-right font-medium" title="PO order quantity">PO qty</th>
                <th className="px-3 py-2 text-right font-medium" title="PO rate, normalized to the proforma's per-PI2 unit via sf_per_box">PO $/PI2*</th>
                <th className="px-3 py-2 text-right font-medium">Ack $/PI2</th>
                <th className="px-3 py-2 text-right font-medium">Price Δ</th>
                <th className="px-3 py-2 text-right font-medium" title="Acknowledged boxes vs ordered boxes">Qty Δ (box)</th>
                <th className="px-3 py-2 text-right font-medium">PO amt</th>
                <th className="px-3 py-2 text-right font-medium">Ack amt</th>
                <th className="px-3 py-2 text-right font-medium">Amount Δ</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const flagged = l.price_flag || l.qty_flag || l.total_flag || l.line_status !== "matched";
                return (
                  <tr key={i} className={cn("border-t border-slate-100 align-top", flagged && "bg-red-50/40")}>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs text-slate-500">{l.mpn ?? "—"}</div>
                      <div className="max-w-xs truncate text-slate-700">{l.description ?? "—"}</div>
                      {l.line_status !== "matched" && (
                        <span className="mt-0.5 inline-block rounded bg-red-100 px-1 text-xs text-red-700">
                          {l.line_status === "po_only" ? "on PO only" : "on proforma only"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <PoLineLink
                        poLineId={l.po_line_id}
                        productId={l.product_id}
                        label={l.mpn ?? l.description ?? "product"}
                        canEdit={canEdit}
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {l.po_qty == null ? "—" : `${n(l.po_qty, 0)} ${l.po_uom ?? ""}`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{unit(l.po_unit_per_pi2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{unit(l.ack_unit_price)}</td>
                    <td className="px-3 py-2 text-right"><Flag on={l.price_flag}>{pct(l.price_pct)}</Flag></td>
                    <td className="px-3 py-2 text-right">
                      <Flag on={l.qty_flag}>
                        {l.qty_diff == null ? "—" : `${l.qty_diff > 0 ? "+" : ""}${n(l.qty_diff, 0)}`}
                      </Flag>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{money(l.po_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{money(l.ack_amount)}</td>
                    <td className="px-3 py-2 text-right"><Flag on={l.total_flag}>{l.total_diff == null ? "—" : money(l.total_diff)}</Flag></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-slate-400">
        * The PO is priced per box and the proforma per PI2 (≈ sq ft); the PO rate is normalized to per-PI2 via{" "}
        <code className="font-mono">products.sf_per_box</code> so the two are comparable. Flags fire beyond{" "}
        {(data.tolerances.price_pct * 100).toFixed(0)}% (price), {(data.tolerances.qty_pct * 100).toFixed(0)}% (qty), and{" "}
        {(data.tolerances.total_pct * 100).toFixed(0)}% (amount). Reconciled against the PO&apos;s most recent acknowledgment.
      </p>
    </div>
  );
}
