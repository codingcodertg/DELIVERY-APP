"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canCreate, canDeliver, ROLE_DEFAULT_COLUMNS } from "@/lib/constants";
import { routeOrder } from "@/lib/dispatch";
import { OrdersTable } from "@/components/OrdersTable";
import { OrderModal } from "@/components/OrderModalLazy";
import { ShiftClock } from "@/components/ShiftClock";
import { seesAllHistory, withinRetention } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// Full workflow visible to drivers now, in order: an order is approved but
// warehouse hasn't started it yet (Pending Preparation) → warehouse is
// working on it (Started) → staged and ready for the driver to grab (Staged
// — deliberately not "Ready", so it's never confused with "fulfilled") →
// the driver has it (Picked Up) → done (Delivered).
const TABS = [
  { key: "approved", label: "Pending Preparation", label_es: "Preparación Pendiente" },
  { key: "fulfilling", label: "Started", label_es: "Iniciado" },
  { key: "ready", label: "Staged", label_es: "Preparado" },
  { key: "picked_up", label: "Out for delivery", label_es: "En reparto" },
  { key: "delivered", label: "Delivered", label_es: "Entregadas" },
  { key: "all", label: "All", label_es: "Todas" },
] as const;

export default function DriverPage() {
  const { me, deliveries, settings, ready, realRole } = useData();
  // An admin previewing the driver role sees EVERY order (no own-assignment or
  // date-window scoping), so they can test with all data.
  const adminAllAccess = realRole === "admin";
  const { lang, t } = usePrefs();
  const [open, setOpen] = useState<Delivery | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("ready");
  const [q, setQ] = useState("");
  // Shows every location by default; narrow to a single store when needed.
  const [storeFilter, setStoreFilter] = useState<string>("");

  // Drivers see ONLY orders assigned to them (plus ones they logged
  // themselves). Admin/logistics visiting this page still see everything.
  const scoped = useMemo(() => {
    if (!me) return [];
    const needle = q.trim().toLowerCase();
    return deliveries.filter((d) => {
      if (!adminAllAccess && me.role === "driver" && d.assigned_driver !== me.full_name && d.created_by !== me.id) return false;
      if (storeFilter && d.store !== storeFilter && d.assigned_driver !== me.full_name) return false;
      // Searching matches by invoice # specifically and bypasses the date
      // window below — that's the one way to reach older history here.
      if (needle) return (d.invoice_num || "").toLowerCase().includes(needle);
      // Near-term work only: two days back through tomorrow. Older history is
      // reachable by the invoice search above; reprogramming a slipped order
      // back into the window brings it straight back.
      // La ventana pregunta por el historial, no por «ser admin»: exentos, admin y
      // logística (D-NEXT). Se deja aparte de `adminAllAccess`, que aquí decide otra
      // cosa —ver los pedidos de OTROS choferes— y esa no cambia en esta rama.
      if (!seesAllHistory(realRole) && !withinRetention(d)) return false;
      return true;
    });
  }, [deliveries, me, storeFilter, q, adminAllAccess, realRole]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of scoped) c[d.stage] = (c[d.stage] ?? 0) + 1;
    return c;
  }, [scoped]);

  // For the active delivery tabs, sequence stops by delivery window for an
  // efficient route (nearest window first, then shortest drive).
  const routed = tab === "ready" || tab === "picked_up";
  const rows = useMemo(() => {
    const list = tab === "all" ? [...scoped].sort((a, b) => b.order_no - a.order_no) : scoped.filter((d) => d.stage === tab);
    return routed ? routeOrder(list) : list;
  }, [scoped, tab, routed]);


  if (!me) return null;
  if (!canDeliver(me) || me.role === "warehouse") {
    return <div className="empty">{t("You don’t have access to the driver view.", "No tienes acceso a la vista de chofer.")}</div>;
  }

  return (
    <>
      {me.role === "driver" && <ShiftClock driverId={me.id} />}
      {/* A driver sees only their own stops, so a heading reading "Driver" and
          a store filter over a list that is already one person's work were
          both taking space and answering nothing. The office roles that share
          this screen still get the filter. */}
      <div className="page-head">
        {me.role === "driver" ? <span /> : (
          <h2>{t("Driver", "Chofer")} <span className="count-tag">{rows.length}</span></h2>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {me.role !== "driver" && (
            <label style={{ margin: 0, textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: 8 }}>
              {t("Store", "Tienda")}
              <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} style={{ width: "auto" }}>
                <option value="">{t("All stores", "Todas las tiendas")}</option>
                {settings.stores.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </label>
          )}
          {canCreate(me) && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>+ {t("New order", "Nueva orden")}</button>
          )}
        </div>
      </div>

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

      {routed && rows.length > 1 && (
        <div className="hint" style={{ marginTop: -4, marginBottom: 10 }}>
          🧭 {t("Ordered by delivery window for an efficient route.", "Ordenado por ventana de entrega para una ruta eficiente.")}
        </div>
      )}

      {ready ? (
        <OrdersTable rows={rows} onOpen={setOpen} visible={ROLE_DEFAULT_COLUMNS.driver} collapsible empty={t("Nothing here right now.", "Nada aquí por ahora.")} />
      ) : (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      )}

      {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
      {creating && <OrderModal me={me} existing={null} startEditing onClose={() => setCreating(false)} />}
    </>
  );
}
