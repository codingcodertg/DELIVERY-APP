"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { cn, money } from "@/lib/erp/utils";
import {
  getPoReceiving,
  receivePo,
  receiveManual,
  searchProducts,
  type PoReceiving,
  type ProductSearchHit,
} from "@/lib/erp/actions";
import { usePrefs } from "@/lib/prefs";

// G-10 (D-NEXT): texto de pantalla por pares inline (usePrefs). Número de OC, proveedor, estado del
// pedido, tienda, SKU, nombre y unidad base son dato y salen tal cual.

export type PoOption = { id: number; po_number: string; vendor_name: string | null; status: string };
export type StoreOption = { id: string; name: string };

const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

function Banner({ kind, children }: { kind: "ok" | "err"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "rounded-md border p-3 text-sm",
        kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"
      )}
    >
      {children}
    </p>
  );
}

export function Receiving({
  pos,
  stores,
  initialPoId,
}: {
  pos: PoOption[];
  stores: StoreOption[];
  initialPoId?: number;
}) {
  return (
    <div className="space-y-5">
      <PoReceive pos={pos} stores={stores} initialPoId={initialPoId} />
      <ManualReceive stores={stores} />
    </div>
  );
}

/* ----------------------------- Receive against a PO ----------------------------- */
function PoReceive({ pos, stores, initialPoId }: { pos: PoOption[]; stores: StoreOption[]; initialPoId?: number }) {
  const { t } = usePrefs();
  const [poId, setPoId] = useState<number | "">(initialPoId && pos.some((p) => p.id === initialPoId) ? initialPoId : "");
  const [detail, setDetail] = useState<PoReceiving | null>(null);
  const [loading, setLoading] = useState(false);
  const [storeId, setStoreId] = useState<string>(stores[0]?.id ?? "");
  const [freight, setFreight] = useState("0");
  const [duty, setDuty] = useState("0");
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const receiptKey = useRef<string | null>(null);

  async function load(id: number) {
    setLoading(true);
    setMsg(null);
    setDetail(null);
    const res = await getPoReceiving(id);
    setLoading(false);
    if (!res.ok) {
      setMsg({ kind: "err", text: res.error });
      return;
    }
    setDetail(res.data);
    setStoreId(res.data.store_id ?? stores[0]?.id ?? "");
    setFreight(res.data.ack_freight != null ? String(res.data.ack_freight) : "0");
    setDuty("0");
    const init: Record<number, string> = {};
    for (const l of res.data.lines) init[l.po_line_id] = l.remaining > 0 ? String(l.remaining) : "";
    setQtys(init);
  }

  useEffect(() => {
    if (typeof poId === "number") load(poId);
  }, [poId]); // load() reads only stores/poId; intentionally not re-run on every render

  const receipts = useMemo(
    () =>
      Object.entries(qtys)
        .map(([id, q]) => ({ po_line_id: Number(id), qty: num(q) }))
        .filter((r) => r.qty > 0),
    [qtys]
  );

  async function submit() {
    if (!detail || !storeId || receipts.length === 0) return;
    setBusy(true);
    setMsg(null);
    // One idempotency key per receipt ATTEMPT, held across retries and cleared only on success
    // (v4_58 / COR-02). If the call times out after the DB committed — the normal trigger for a
    // double-post — the retry carries the same key and the RPC replays the original result instead
    // of creating a second set of lots and movements.
    if (!receiptKey.current) receiptKey.current = crypto.randomUUID();
    const res = await receivePo(
      detail.po_id,
      storeId,
      receipts,
      freight === "" ? null : num(freight),
      num(duty),
      receiptKey.current
    );
    setBusy(false);
    if (!res.ok) {
      // Keep the key: a retry of a call that may have committed must replay, not re-post.
      setMsg({ kind: "err", text: res.error });
      return;
    }
    receiptKey.current = null; // this receipt is done; the next one is a new event
    const r = res.result as { lots_created?: number; total_qty?: number; po_status?: string; replayed?: boolean };
    setMsg({
      kind: "ok",
      text: r.replayed
        ? t(`This receipt was already recorded — showing the original result (${r.lots_created ?? 0} lot(s), PO ${r.po_status ?? "updated"}). Nothing was posted twice.`, `Esta recepción ya estaba registrada — se muestra el resultado original (${r.lots_created ?? 0} lote(s), OC ${r.po_status ?? "updated"}). No se registró nada dos veces.`)
        : t(`Received ${r.total_qty ?? 0} unit(s) into ${stores.find((s) => s.id === storeId)?.name ?? storeId} — ${r.lots_created ?? 0} lot(s) created. PO is now ${r.po_status ?? "updated"}.`, `Recibidas ${r.total_qty ?? 0} unidad(es) en ${stores.find((s) => s.id === storeId)?.name ?? storeId} — ${r.lots_created ?? 0} lote(s) creados. La OC queda ${r.po_status ?? "updated"}.`),
    });
    await load(detail.po_id); // refresh received/remaining
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">{t("Receive against a PO", "Recibir contra una OC")}</h2>
        <p className="text-xs text-slate-500">
          {t("Each line becomes a lot with its landed cost (base + allocated freight/duty) and a", "Cada línea se convierte en un lote con su costo en destino (base + flete/arancel repartidos) y un movimiento")} <code>receive</code> {t("movement into the receiving store. Partial receipts advance the PO.", "en la tienda receptora. Las recepciones parciales avanzan la OC.")}
        </p>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">{t("Purchase order", "Orden de compra")}</span>
            <select
              value={poId}
              onChange={(e) => setPoId(e.target.value ? Number(e.target.value) : "")}
              className="h-9 min-w-[18rem] rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
            >
              <option value="">{t("Select a PO…", "Elige una OC…")}</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.po_number} · {p.vendor_name ?? "—"} · {p.status}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">{t("Receiving store", "Tienda receptora")}</span>
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">{t("Freight to allocate", "Flete a repartir")}</span>
            <input
              value={freight}
              onChange={(e) => setFreight(e.target.value)}
              inputMode="decimal"
              className="h-9 w-32 rounded-md border border-slate-300 bg-white px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">{t("Duty to allocate", "Arancel a repartir")}</span>
            <input
              value={duty}
              onChange={(e) => setDuty(e.target.value)}
              inputMode="decimal"
              className="h-9 w-32 rounded-md border border-slate-300 bg-white px-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
            />
          </label>
        </div>

        {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
        {loading && <p className="text-sm text-slate-500">{t("Loading PO lines…", "Cargando líneas de la OC…")}</p>}

        {detail && (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("Line", "Línea")}</th>
                    <th className="px-3 py-2 font-medium">{t("Product", "Producto")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("Ordered", "Pedido")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("Received", "Recibido")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("Remaining", "Pendiente")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("Unit cost", "Costo unitario")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("Receive now", "Recibir ahora")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l) => (
                    <tr key={l.po_line_id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-500">{l.line_no ?? "—"}</td>
                      <td className="px-3 py-2">
                        {l.product_id ? (
                          <Link href={`/erp/product/${l.product_id}`} className="font-medium text-clay-700 hover:underline">
                            {l.name ?? l.sku ?? l.vendor_item_no ?? "—"}
                          </Link>
                        ) : (
                          <span className="text-amber-700">{l.description ?? l.vendor_item_no ?? "—"} · {t("not linked", "sin enlazar")}</span>
                        )}
                        <div className="font-mono text-xs text-slate-400">{l.sku ?? l.vendor_item_no ?? ""}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.qty ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{l.received_qty}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.remaining}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{money(l.unit_rate)}</td>
                      <td className="px-3 py-2 text-right">
                        {l.product_id ? (
                          <input
                            value={qtys[l.po_line_id] ?? ""}
                            onChange={(e) => setQtys((p) => ({ ...p, [l.po_line_id]: e.target.value }))}
                            inputMode="decimal"
                            className="h-8 w-24 rounded-md border border-slate-300 bg-white px-2 text-right text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
                          />
                        ) : (
                          <Link href={`/erp/purchasing/orders/${detail.po_id}`} className="text-xs text-clay-700 hover:underline">
                            {t("link product →", "enlazar producto →")}
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-3">
              <span className="text-sm text-slate-500">
                {receipts.length === 1 ? t("1 line to receive", "1 línea por recibir") : t(`${receipts.length} lines to receive`, `${receipts.length} líneas por recibir`)}
              </span>
              <button
                type="button"
                onClick={submit}
                disabled={busy || receipts.length === 0 || !storeId}
                className="rounded-lg bg-clay-600 px-4 py-2 text-sm font-medium text-white hover:bg-clay-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? t("Receiving…", "Recibiendo…") : t("Receive", "Recibir")}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ----------------------------- Manual receive (no PO) ----------------------------- */
function ManualReceive({ stores }: { stores: StoreOption[] }) {
  const { t } = usePrefs();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProductSearchHit[]>([]);
  const [picked, setPicked] = useState<ProductSearchHit | null>(null);
  const [storeId, setStoreId] = useState<string>(stores[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [base, setBase] = useState("");
  const [freight, setFreight] = useState("0");
  const [duty, setDuty] = useState("0");
  const [lotNumber, setLotNumber] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onQuery(v: string) {
    setQuery(v);
    setPicked(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setHits(await searchProducts(v));
    }, 200);
  }
  function pick(h: ProductSearchHit) {
    setPicked(h);
    setQuery(`${h.name} (${h.sku})`);
    setHits([]);
    setBase(h.cost != null ? String(h.cost) : "");
  }

  const landed = num(base) + num(freight) + num(duty);

  async function submit() {
    if (!picked || !storeId || num(qty) === 0) return;
    setBusy(true);
    setMsg(null);
    const res = await receiveManual({
      productId: picked.id,
      storeId,
      qty: num(qty),
      baseCost: base === "" ? null : num(base),
      freightCost: num(freight),
      dutyCost: num(duty),
      lotNumber: lotNumber || null,
      reference: reference || null,
    });
    setBusy(false);
    if (!res.ok) {
      setMsg({ kind: "err", text: res.error });
      return;
    }
    const r = res.result as { lot_id?: number; landed_cost?: number };
    setMsg({
      kind: "ok",
      text: t(`Received ${num(qty)} ${picked.base_unit ?? "unit"}(s) of ${picked.sku} into ${stores.find((s) => s.id === storeId)?.name ?? storeId} — lot #${r.lot_id} at landed ${money(r.landed_cost ?? landed)}.`, `Recibidas ${num(qty)} ${picked.base_unit ?? "unidad"}(es) de ${picked.sku} en ${stores.find((s) => s.id === storeId)?.name ?? storeId} — lote #${r.lot_id} a costo en destino ${money(r.landed_cost ?? landed)}.`),
    });
    setQty("");
    setLotNumber("");
    setReference("");
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-800">{t("Manual receive (no PO)", "Recepción manual (sin OC)")}</h2>
        <p className="text-xs text-slate-500">{t("Add stock not tied to a logged PO — a found lot, a vendor drop, an opening correction.", "Añade existencias sin OC registrada — un lote encontrado, una entrega del proveedor, una corrección inicial.")}</p>
      </div>

      <div className="space-y-4 p-4">
        <div className="relative max-w-xl">
          <span className="mb-1 block text-sm text-slate-500">{t("Product", "Producto")}</span>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t("Search name or SKU…", "Buscar nombre o SKU…")}
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
          />
          {hits.length > 0 && !picked && (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => pick(h)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-clay-50"
                  >
                    <span className="truncate">{h.name}</span>
                    <span className="shrink-0 font-mono text-xs text-slate-400">{h.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">{t("Store", "Tienda")}</span>
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          {([
            [t("Qty", "Cant."), qty, setQty, "decimal"],
            [t("Base cost", "Costo base"), base, setBase, "decimal"],
            [t("Freight", "Flete"), freight, setFreight, "decimal"],
            [t("Duty", "Arancel"), duty, setDuty, "decimal"],
          ] as const).map(([lbl, v, set]) => (
            <label key={lbl} className="text-sm">
              <span className="mb-1 block text-slate-500">{lbl}</span>
              <input
                value={v}
                onChange={(e) => set(e.target.value)}
                inputMode="decimal"
                className="h-9 w-28 rounded-md border border-slate-300 bg-white px-2 text-right text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
              />
            </label>
          ))}
          <label className="text-sm">
            <span className="mb-1 block text-slate-500">{t("Lot # (optional)", "Lote # (opcional)")}</span>
            <input
              value={lotNumber}
              onChange={(e) => setLotNumber(e.target.value)}
              className="h-9 w-40 rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
            />
          </label>
        </div>

        <label className="block max-w-xl text-sm">
          <span className="mb-1 block text-slate-500">{t("Reference / note (optional)", "Referencia / nota (opcional)")}</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
          />
        </label>

        {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

        <div className="flex items-center justify-end gap-3">
          <span className="text-sm text-slate-500">{t("Landed cost", "Costo en destino")} {money(landed)}/{t("unit", "unidad")}</span>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !picked || num(qty) === 0 || !storeId}
            className="rounded-lg bg-clay-600 px-4 py-2 text-sm font-medium text-white hover:bg-clay-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t("Receiving…", "Recibiendo…") : t("Receive", "Recibir")}
          </button>
        </div>
      </div>
    </section>
  );
}
