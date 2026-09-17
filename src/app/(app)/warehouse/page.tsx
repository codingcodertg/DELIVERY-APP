"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canFulfill, ROLE_DEFAULT_COLUMNS } from "@/lib/constants";
import { OrdersTable } from "@/components/OrdersTable";
import { OrderModal } from "@/components/OrderModalLazy";
import { printLoadSheets } from "@/lib/slip";
import { rutaPorChofer, SIN_CHOFER } from "@/lib/ruta-del-dia";
import { fmtWindows, orderLabel, seesAllHistory, todayISO, withinRetention } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

const TABS = [
  { key: "approved", label: "Approved (new)", label_es: "Aprobado (nuevo)" },
  { key: "fulfilling", label: "Preparing", label_es: "Preparando" },
  { key: "ready", label: "Ready", label_es: "Listo" },
  { key: "picked_up", label: "Out for delivery", label_es: "En reparto" },
  { key: "delivered", label: "Delivered", label_es: "Entregado" },
  { key: "all", label: "All", label_es: "Todas" },
] as const;

export default function WarehousePage() {
  const { me, deliveries, settings, ready, realRole } = useData();
  const { lang, t } = usePrefs();
  const [open, setOpen] = useState<Delivery | null>(null);
  // Warehouse starts on the Approved (new) queue — the orders waiting to be
  // prepared — and narrows/expands from there.
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("approved");
  const [q, setQ] = useState("");
  // Admin can browse any store; a warehouse worker is locked to their own
  // (PU = pickup store). Falls back to "every store" only if unassigned.
  const [storeFilter, setStoreFilter] = useState<string>("");
  const [loadDate, setLoadDate] = useState<string>(todayISO());
  // Dos vistas de lo mismo: la cola por etapa, que es como se trabaja, y la ruta del día por
  // chofer (D-NEXT), que es lo que pidió almacén para saber a quién le carga y en qué orden va.
  const [vista, setVista] = useState<"cola" | "ruta">("cola");
  // A real warehouse worker is locked to their own store. An ADMIN previewing
  // the warehouse role is NOT locked — they get the store picker (defaulting to
  // all stores) so they can try each store and see every order.
  const lockedToOwnStore = me?.role === "warehouse" && realRole !== "admin";
  const effectiveStore = lockedToOwnStore ? (me?.store ?? "") : storeFilter;

  // An order is "at" a warehouse store if it's sold from there OR physically
  // picked up there — so a warehouse worker also sees pickup orders staged at
  // their store even when the order was sold from another branch (e.g. an
  // Intertienda picked up from their warehouse).
  const storeAddr = useMemo(
    () => settings.stores.find((s) => s.name === effectiveStore)?.address?.trim() || "",
    [settings.stores, effectiveStore],
  );
  const atStore = useMemo(
    () => (d: Delivery) => {
      if (d.store === effectiveStore) return true;
      if ((d.pickup_name || "").trim() === effectiveStore) return true;
      if (storeAddr && (d.pickup_address || "").trim() === storeAddr) return true;
      return false;
    },
    [effectiveStore, storeAddr],
  );

  const scoped = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return deliveries.filter((d) => {
      if (effectiveStore && !atStore(d)) return false;
      // Searching matches by invoice # specifically and bypasses the date
      // window below — that's the one way to reach older history here.
      if (needle) return (d.invoice_num || "").toLowerCase().includes(needle);
      // Near-term work only: two days back through tomorrow. Older history is
      // reachable by the invoice search above.
      // Quien ve todo el historial (admin y logística, D-239) no se filtra, y se
      // mira el rol REAL: un admin previsualizando almacén sigue viendo todo.
      if (!seesAllHistory(realRole) && !withinRetention(d)) return false;
      return true;
    });
  }, [deliveries, effectiveStore, atStore, q, realRole]);

  // Lo que se carga ese día: las órdenes activas de la fecha elegida, en las tiendas que toquen.
  // Lo comparten el botón de las hojas de carga y la vista de ruta, así que la hoja impresa y la
  // pantalla no pueden decir cosas distintas.
  const cargasDelDia = useMemo(() => {
    const ACTIVAS = ["approved", "fulfilling", "ready", "picked_up"];
    return deliveries.filter((d) =>
      d.delivery_date === loadDate && ACTIVAS.includes(d.stage) && (!effectiveStore || atStore(d)));
  }, [deliveries, loadDate, effectiveStore, atStore]);

  const ruta = useMemo(() => rutaPorChofer(cargasDelDia), [cargasDelDia]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of scoped) c[d.stage] = (c[d.stage] ?? 0) + 1;
    return c;
  }, [scoped]);

  const rows = useMemo(
    () => (tab === "all" ? [...scoped].sort((a, b) => b.order_no - a.order_no) : scoped.filter((d) => d.stage === tab)),
    [scoped, tab],
  );

  if (!me) return null;
  if (!canFulfill(me)) return <div className="empty">{t("You don’t have access to the warehouse queue.", "No tienes acceso a la cola del almacén.")}</div>;

  return (
    <>
      <div className="page-head">
        <h2>{t("Warehouse", "Almacén")} <span className="count-tag">{rows.length}</span></h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {!lockedToOwnStore && (
            <label style={{ margin: 0, textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: 8 }}>
              {t("Store", "Tienda")}
              <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} style={{ width: "auto" }}>
                <option value="">{t("All stores", "Todas las tiendas")}</option>
                {settings.stores.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </label>
          )}
          {/* Print the day's load sheets (one page per driver) for the scoped store. */}
          <label style={{ margin: 0, textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: 6 }}>
            📅 <input type="date" value={loadDate} onChange={(e) => setLoadDate(e.target.value)} style={{ width: "auto", padding: "5px 7px" }} />
          </label>
          <button
            className="btn btn-ghost"
            title={t("Print one load sheet per driver for the chosen day", "Imprimir una hoja de carga por chofer para el día elegido")}
            onClick={() => printLoadSheets(cargasDelDia, settings, lang, loadDate)}
          >
            🖨 {t("Load sheets", "Hojas de carga")}
          </button>
        </div>
      </div>

      {lockedToOwnStore && !me.store && (
        <div className="hint" style={{ marginBottom: 10 }}>
          {t("You're not assigned to a store yet — ask an admin to set one in Users. Showing every store for now.", "Aún no tiene una tienda asignada — pida a un administrador que le asigne una en Usuarios. Mostrando todas las tiendas por ahora.")}
        </div>
      )}

      <div className="filters filters-oneline">
        <div className="viewtoggle">
          <button className={"vt " + (vista === "cola" ? "on" : "")} onClick={() => setVista("cola")}>☰ {t("Queue", "Cola")}</button>
          <button className={"vt " + (vista === "ruta" ? "on" : "")} onClick={() => setVista("ruta")}>🧭 {t("Day's route", "Ruta del día")}</button>
        </div>
      </div>

      {vista === "cola" && (
        <div className="filters">
          <input
            style={{ maxWidth: 260 }}
            placeholder={t("Search invoice #…", "Buscar factura #…")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {TABS.map((tb) => (
            <button key={tb.key} className={"chip " + (tab === tb.key ? "on" : "")} onClick={() => setTab(tb.key)}>
              {lang === "es" ? tb.label_es : tb.label} <span className="cnt">{tb.key === "all" ? scoped.length : (counts[tb.key] ?? 0)}</span>
            </button>
          ))}
        </div>
      )}

      {!ready ? (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      ) : vista === "cola" ? (
        <OrdersTable rows={rows} resizeKey="warehouse" onOpen={setOpen} visible={ROLE_DEFAULT_COLUMNS.warehouse} empty={t("Nothing in this queue.", "Nada en esta cola.")} />
      ) : (
        /* La ruta del día, de SOLO LECTURA (D-NEXT). Sale de las órdenes que almacén ya puede
           leer: chofer asignado, secuencia de ruta, ventana y dirección. Lo que NO está aquí es
           dónde va el camión ahora mismo: esas posiciones (la tabla driver_locations) solo las
           leen admin, logística y gerencia, y abrirlas es otra decisión. Se puede abrir una orden
           desde aquí, que es el mismo modal de siempre y con los mismos permisos. */
        <div style={{ display: "grid", gap: 12 }}>
          {ruta.length === 0 && <div className="empty">{t("Nothing to load for this day.", "Nada que cargar para este día.")}</div>}
          {ruta.map((g) => (
            <div key={g.chofer || "sin-chofer"} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                <b>🚚 {g.chofer === SIN_CHOFER ? t("Unassigned", "Sin asignar") : g.chofer}</b>
                <span className="hint" style={{ margin: 0 }}>
                  {g.paradas.length} {t("stops", "paradas")} · {g.pallets} {t("pallets", "pallets")}
                </span>
              </div>
              <div className="tbl-scroll tbl-fit" style={{ marginTop: 8 }}>
                <table className="orders tbl-resize" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>#</th>
                      <th style={{ textAlign: "left" }}>{t("Order", "Orden")}</th>
                      <th style={{ textAlign: "left" }}>{t("Account", "Cuenta")}</th>
                      <th style={{ textAlign: "left" }}>{t("Address", "Dirección")}</th>
                      <th style={{ textAlign: "left" }}>{t("Window", "Ventana")}</th>
                      <th style={{ textAlign: "left" }}>{t("Pallets", "Pallets")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.paradas.map((d, i) => (
                      <tr key={d.id} className="clickable" onClick={() => setOpen(d)}>
                        <td>{i + 1}</td>
                        <td><b>#{orderLabel(d)}</b></td>
                        <td>{d.account || d.delivery_name || "—"}</td>
                        <td>{d.delivery_address || "—"}</td>
                        <td>{fmtWindows(d.delivery_windows)}</td>
                        <td>{d.actual_pallets ?? d.est_pallets ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
    </>
  );
}
