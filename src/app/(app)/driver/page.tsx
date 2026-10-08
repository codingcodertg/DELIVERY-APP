"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import MyRoutePage from "@/app/(app)/my-route/page";
import { RutaDeUnChofer } from "@/lib/ruta-de-un-chofer";
import {
  choferVigente, choferesParaVer, etiquetaDeOpcion, guardaChoferVisto, leeChoferVisto, pestanaChoferEsRutaDeUnChofer,
} from "@/lib/vista-de-chofer";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canCreate, canDeliver, ROLE_DEFAULT_COLUMNS } from "@/lib/constants";
import { routeOrder } from "@/lib/dispatch";
import { OrdersTable } from "@/components/OrdersTable";
import { OrderModal } from "@/components/OrderModalLazy";
import { ShiftClock } from "@/components/ShiftClock";
import { seesAllHistory, todayISO, withinRetention } from "@/lib/utils";
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

// ============================================================
// La pestaña «🚚 Chofer» (D-NEXT).
//
// El dueño, 2026-10-08: «la vista de chofer quiero que sea exactamente el view de cada chofer asi como lo miran ellos el
// que sale en el admin». Para el ADMIN, esta pestaña es «Mi ruta» de un chofer que elige arriba —la MISMA página de
// `/my-route`, montada dentro de `<RutaDeUnChofer>`, no una copia—, en una columna del ancho de un teléfono y de solo
// lectura. Lo que la pestaña enseñaba antes al admin (todas las órdenes por etapa) sigue debajo, plegado.
//
// Para el chofer —y para quien tenga el permiso suelto `deliver`— no cambia nada: su lista de órdenes por etapa
// (`ListaDelChofer`), que es donde aterriza al entrar.
// ============================================================
export default function DriverPage() {
  const { me } = useData();
  if (pestanaChoferEsRutaDeUnChofer(me)) return <RutaDeUnChoferParaElAdmin />;
  return <ListaDelChofer />;
}

function RutaDeUnChoferParaElAdmin() {
  const { me, users, deliveries } = useData();
  const { t, lang } = usePrefs();
  // De quién se puede mirar: todo chofer, por nombre, con sus paradas de hoy al lado (`choferesParaVer`).
  const opciones = useMemo(() => choferesParaVer(users, deliveries, todayISO()), [users, deliveries]);
  // El último elegido en ESTE navegador. Se lee al montar —en el servidor no hay `localStorage`—, y hasta entonces no se
  // pinta ninguna ruta: así no se pide el plan de un chofer para, un instante después, pedir el del guardado.
  const quienMira = me?.id ?? "";
  const [guardado, setGuardado] = useState<string | null | undefined>(undefined);
  useEffect(() => { setGuardado(leeChoferVisto((k) => window.localStorage.getItem(k), quienMira)); }, [quienMira]);
  const elegidoId = guardado === undefined ? null : choferVigente(guardado, opciones);
  const elegido = users.find((u) => u.id === elegidoId) ?? null;
  const elegir = (id: string) => { setGuardado(id); guardaChoferVisto(() => window.localStorage, quienMira, id); };
  // Lo de antes, plegado: no se monta hasta que se abre (una tabla con todas las órdenes, escondida, sería trabajo de más).
  const [verLista, setVerLista] = useState(false);

  return (
    <>
      <div className="vista-de-chofer" data-vista-de-chofer>
        <div className="page-head">
          <h2>🚚 {t("Driver", "Chofer")}</h2>
          {opciones.length > 0 && (
            <select data-elige-chofer value={elegidoId ?? ""} onChange={(e) => elegir(e.target.value)}
              aria-label={t("Whose route to view", "De qué chofer ver la ruta")} style={{ width: "auto", maxWidth: "100%" }}>
              {opciones.map((o) => <option key={o.id} value={o.id}>{etiquetaDeOpcion(o, lang === "es")}</option>)}
            </select>
          )}
        </div>
        {opciones.length === 0 ? (
          <div className="empty">{t("There are no drivers yet. They are added in Users, with the Driver role.", "Aún no hay choferes. Se agregan en Usuarios, con el rol Chofer.")}</div>
        ) : elegido && (
          <>
            <div className="banner info" role="status" data-aviso-solo-lectura>
              <b>👁 {t(`Viewing ${elegido.full_name}'s route as they see it — read-only`, `Viendo la ruta de ${elegido.full_name} como la ve él — solo lectura`)}</b>
              <div className="hint" style={{ marginTop: 2 }}>
                {t("The buttons look the same but are off. To act on their behalf, use ⇄ Switch user.", "Los botones se ven igual pero están apagados. Para actuar en su nombre, usa ⇄ Cambiar usuario.")}
              </div>
            </div>
            {/* `key`: otro chofer es otra pantalla. Sin él, el día elegido y la ruta trazada en el mapa del anterior se
                quedarían puestos sobre las paradas del nuevo. */}
            <div className="como-telefono" data-como-telefono>
              <RutaDeUnChofer chofer={elegido}>
                <MyRoutePage key={elegido.id} />
              </RutaDeUnChofer>
            </div>
          </>
        )}
      </div>

      <details className="card" data-lista-anterior style={{ marginTop: 16 }} onToggle={(e) => setVerLista((e.currentTarget as HTMLDetailsElement).open)}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>
          📋 {t("All orders by stage — what this tab showed before", "Todas las órdenes por etapa — lo que enseñaba antes esta pestaña")}
        </summary>
        {verLista && <div style={{ marginTop: 12 }}><ListaDelChofer plegada /></div>}
      </details>
    </>
  );
}

/**
 * La lista de órdenes por etapa: la pestaña del chofer de siempre y, desde D-NEXT, lo plegado bajo la ruta en la del admin
 * (`plegada`: sin su propio título, que ya lo dice el desplegable).
 */
function ListaDelChofer({ plegada = false }: { plegada?: boolean }) {
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
      // logística (D-239). Se deja aparte de `adminAllAccess`, que aquí decide otra
      // cosa —ver los pedidos de OTROS choferes— y esa no cambia en esta rama.
      if (!seesAllHistory(realRole, me?.permissions) && !withinRetention(d)) return false;
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
        {me.role === "driver" || plegada ? <span /> : (
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
          {/* La puerta del chofer al directorio de la compañía (D-256).

              Vive AQUÍ y no en el hub porque el chofer no llega al hub: D-173 se lo cierra sin
              condiciones, y esa regla no se relaja — su app es su ruta, y meterle un selector
              de módulos en medio del reparto sería justo lo que D-051 quitó. Pero el dueño pidió
              el directorio para TODOS los empleados, y un chofer es quien más lo necesita: es
              el que está fuera y tiene que llamar a la tienda.
              
              Así que la puerta es suya y la ruta está fuera del candado: `/home/directory` solo
              pide sesión. El hub sigue sin ser para el chofer; el directorio sí lo es. */}
          <Link href="/home/directory" className="btn btn-ghost">📇 {t("Directory", "Directorio")}</Link>
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
