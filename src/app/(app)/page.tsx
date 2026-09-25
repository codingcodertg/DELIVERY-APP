"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { preguntaDelBloque, reparteParaElBloque } from "@/lib/cambio-en-bloque";
import { AUTO_CANCEL_LATE_ENABLED, canCreate, driverNames, filterStagesFor, puedeAnular, ROLE_DEFAULT_COLUMNS, STAGES, stageLabel } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { mueveColumna, ordenEfectivo } from "@/lib/orden-de-columnas";
import { CLAVE_DE_COLUMNAS, anchosDeUnRol, anchosValidos, claveDelNavegador, columnasDe, columnasDeVentas, guardaColumnas, hayQueSembrar, leeColumnas, semillaDelNavegador, type AnchosPorRol, type ClienteDePrefs, type ColumnasPorRol } from "@/lib/user-prefs";
import { faltaParaAnular, MOTIVO_POR_RETRASO, motivosDeAnulacion, pideTextoLibre } from "@/lib/cancel-reasons";
import { OrdersTable, ORDER_COLUMNS, DEFAULT_COLUMNS } from "@/components/OrdersTable";
import { PESTANA_DOCUMENTO_PENDIENTE, presetAlElegirPastilla, tiendasDeQuienMira } from "@/lib/documento-pendiente";
import { pastillasDeOrdenes, PASTILLA_TODAS } from "@/lib/pastillas-de-ordenes";
import { ordenesVisibles } from "@/lib/ordenes-visibles";
import { cuentasDeOrdenes, filasDeOrdenes } from "@/lib/filas-de-ordenes";
import { PESTANA_ATRASADAS } from "@/lib/atrasadas";
import { useCierraAlSalir } from "@/lib/menu-desplegable";
import { OrdersBoard } from "@/components/OrdersBoard";
import { OrderModal } from "@/components/OrderModalLazy";
import { ImportOrdersModal } from "@/components/ImportOrdersModal";
import { awaitingDriver, daysBetween, deliveryColumns, downloadCSV, LATE_GRACE_DAYS, orderLabel, isOverdue, isPendingUrgent, isToday, orderOwner, toCSV, seesAllHistory, todayISO, withinRecent, withinRetention } from "@/lib/utils";
import { exportExcelByEmployee, exportPDFByEmployee } from "@/lib/export";
import { ventasVeLaOrden } from "@/lib/visibilidad-ventas";
import { tiendasDeAlmacen } from "@/lib/almacen";
import { orderTypeRule } from "@/lib/required";
import type { Delivery, Stage, UserRole } from "@/lib/types";

// Quick saved views — one-tap presets layered on top of the stage chip.
type Preset = "all" | "recent" | "today" | "overdue" | "unassigned" | "mine";

// Column choices are remembered per role — so switching "View as" in local
// demo mode (or just different people on different roles) doesn't clobber
// each other's picks, and each role starts from its own sensible default.
// La clave del navegador es la de siempre (`rtg_order_columns_<rol>`): sigue siendo la red si la base no contesta.
const colsKey = claveDelNavegador;
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
const defaultColsFor = (role: UserRole) => ROLE_DEFAULT_COLUMNS[role] ?? DEFAULT_COLUMNS;

export default function OrdersPage() {
  const { me, users, deliveries, settings, ready, teaching, realRole, updateDelivery, setStage, notify, ensureDeliveriesSince } = useData();
  // An admin previewing a role (view-as) sees EVERY order — none of the
  // role-scoped/date-window restrictions apply, so they can test with all data.
  // Quién ve el historial entero: admin y gerente de logística (D-239). Antes era
  // `realRole === "admin"` aquí y otra condición distinta en cada pantalla. Cambia
  // también el NOMBRE: `veTodoElHistorial` ya no diría la verdad con logística dentro,
  // y un nombre que miente es lo que hace que la siguiente lectura sea falsa.
  const veTodoElHistorial = seesAllHistory(realRole, me?.permissions);
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();

  // Automation: an active order more than LATE_GRACE_DAYS days past its delivery
  // date (i.e. never reprogrammed) is auto-canceled. Runs once per session when
  // the board loads, and only for roles allowed to cancel (admin / office /
  // logistics / accounting) — the DB guard enforces the same.
  const sweptRef = useRef(false);
  useEffect(() => {
    if (!AUTO_CANCEL_LATE_ENABLED) return;   // feature off until activated
    if (sweptRef.current || teaching || !ready || !me) return;
    if (!["admin", "manager", "logistics", "accounting"].includes(me.role)) return;
    if (deliveries.length === 0) return;
    sweptRef.current = true;
    const stale = deliveries.filter(
      (d) => !["delivered", "canceled", "rejected"].includes(d.stage)
        && d.delivery_date != null
        && daysBetween(todayISO(), d.delivery_date) > LATE_GRACE_DAYS,
    );
    for (const d of stale) {
      // Con motivo, como cualquier otra anulación: si un día se enciende, no deja órdenes anuladas
      // sin poder explicar por qué (122). El guard rechazaría la escritura sin ella.
      void setStage(d.id, "canceled", "Auto-canceled: 2+ days late without reprogramming",
        { canceled_reason: MOTIVO_POR_RETRASO });
    }
  }, [ready, teaching, me, deliveries, setStage]);

  // Every store auto-approves → nothing ever sits in "Pending Approval", so
  // that stage's filter chip is dropped and manager/sales land on Programmed.
  const autoApproveAll = settings.stores.length > 0 && settings.stores.every((s) => s.auto_approve);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<string>("all");
  // «Reciente» por defecto (D-350): ayer, hoy y mañana. «Todas» es todo lo que la persona puede ver.
  const [preset, setPreset] = useState<Preset>("recent");
  const [q, setQ] = useState("");
  // G-16: the provider keeps a window of orders; an admin typing a search may be looking for an
  // old one, so the first non-empty search asks for the whole history (once; idempotent). Sales
  // are capped at 30 days below anyway, well inside the window.
  // Y «Todas» con historial (D-350) pide lo mismo: la ventana del proveedor no llega a agosto.
  useEffect(() => { if (veTodoElHistorial && (q.trim() || preset === "all")) void ensureDeliveriesSince(null); }, [q, preset, veTodoElHistorial, ensureDeliveriesSince]);
  const [view, setView] = useState<"table" | "board">("table");
  const [open, setOpen] = useState<Delivery | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Bulk selection (#1) + user-chosen columns (#13, persisted per browser).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cols, setCols] = useState<string[]>(DEFAULT_COLUMNS);
  // Lo que la base tiene guardado para esta persona, por rol. `null` = no se pudo leer (o aún no): no se escribe.
  const prefsDeLaBase = useRef<ColumnasPorRol | null>(null);
  // El ORDEN de las columnas, aparte de cuáles se ven (D-332). `null` = la persona no ha reordenado: el canónico.
  // Solo vive en la base: en el navegador nunca hubo un orden que sembrar.
  const [orden, setOrden] = useState<string[] | null>(null);
  const ordenDeLaBase = useRef<ColumnasPorRol>({});
  // El ANCHO de las columnas (D-338), la tercera mitad de la misma fila. `null` = nada guardado: manda el navegador.
  const [anchos, setAnchos] = useState<Record<string, number> | null>(null);
  const anchosDeLaBase = useRef<AnchosPorRol>({});
  // La fila se escribe ENTERA y por UN solo sitio, con las tres mitades tal como están: así guardar una no borra las otras.
  const escribeLaFila = () => guardaColumnas(createClient() as unknown as ClienteDePrefs, me!.id, prefsDeLaBase.current ?? {}, CLAVE_DE_COLUMNAS, ordenDeLaBase.current, anchosDeLaBase.current);
  const [showCols, setShowCols] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Elegir y aplicar son DOS pasos (D-372): aquí vive lo elegido hasta que se pulsa el botón y se confirma.
  const [fechaEnBloque, setFechaEnBloque] = useState("");
  const [choferEnBloque, setChoferEnBloque] = useState("");
  /** Anular en bloque pide el motivo UNA vez y lo escribe en cada orden. Antes este camino no
   *  mandaba motivo ninguno, así que convivía con «en la ficha es obligatorio» (122). */
  const [bulkCancel, setBulkCancel] = useState(false);
  const [bulkReason, setBulkReason] = useState("");
  const [bulkReasonNote, setBulkReasonNote] = useState("");

  // Managers land on Pending Approval instead of All — that's the queue they
  // actually need to act on. Only applied once per role, on first load, so
  // manually picking a different chip afterward isn't fought.
  const defaultFilterApplied = useRef<UserRole | null>(null);
  useEffect(() => {
    if (!me || defaultFilterApplied.current === me.role) return;
    defaultFilterApplied.current = me.role;
    // Each role lands on the queue it actually acts on first.
    if (me.role === "manager" || me.role === "sales") setFilter(autoApproveAll ? "approved" : "pending");
    else if (me.role === "warehouse") setFilter("approved");
    else if (me.role === "driver") setFilter("ready");
  }, [me?.role]);

  // If every store auto-approves (so the Pending chip is hidden), never leave
  // the board stuck on the now-invisible "pending" filter.
  useEffect(() => {
    if (autoApproveAll && filter === "pending") setFilter("approved");
  }, [autoApproveAll, filter]);

  // Reloads whenever the role changes too (e.g. the local-demo "View as"
  // switcher), so each role shows its own saved columns, defaulting to
  // ROLE_DEFAULT_COLUMNS the first time that role is seen in this browser.
  // Sales is the exception: there's no self-customizing for that role — an
  // admin sets the one fixed list for everyone in Settings, so it's read
  // straight from there (and stays reactive if an admin changes it live).
  useEffect(() => {
    if (!me) return;
    const esVentas = me.role === "sales";
    // Lo del navegador, YA: la pantalla no espera a la base para pintar las columnas de siempre.
    let delNavegador: ColumnasPorRol = {};
    if (esVentas) setCols(columnasDeVentas(settings.sales_columns, defaultColsFor("sales")));
    else {
      try { delNavegador = semillaDelNavegador((k) => localStorage.getItem(k)); } catch { /* sin localStorage, sin semilla */ }
      setCols(columnasDe(me.role, null, delNavegador, defaultColsFor(me.role)).columnas);
    }
    prefsDeLaBase.current = null;
    ordenDeLaBase.current = {};
    anchosDeLaBase.current = {};
    setOrden(null);
    setAnchos(null);
    if (SIN_BASE) return;
    // Y después la base, que es la que manda (D-330): la elección es de la persona, no del navegador.
    let vivo = true;
    const rol = me.role, yo = me.id;
    void (async () => {
      const supabase = createClient() as unknown as ClienteDePrefs;
      const leido = await leeColumnas(supabase, yo);
      if (!vivo || !leido.leida) return;
      prefsDeLaBase.current = leido.columnas;
      ordenDeLaBase.current = leido.orden;
      anchosDeLaBase.current = leido.anchos;
      setOrden(leido.orden[rol] ?? null);
      setAnchos(leido.anchos[rol] ?? null);
      // Ventas lee la base solo por el ANCHO de sus columnas: cuáles ve sigue saliendo de Ajustes.
      if (leido.hayFila) { if (!esVentas) setCols(columnasDe(rol, leido.columnas, delNavegador, defaultColsFor(rol)).columnas); return; }
      // Sin fila: se siembra UNA vez desde este navegador — nunca durante una suplantación (el navegador es del
      // admin y la sesión, de otra persona), y si no se sabe si la hay, tampoco.
      let suplantando: boolean | null = null;
      try { const e = await (await fetch("/api/impersonate/state")).json() as { como?: string }; suplantando = !!e?.como; } catch { /* no se sabe */ }
      // …y con las columnas, los anchos que este navegador tuviera arrastrados para este rol.
      let anchosDelNavegador: AnchosPorRol = {};
      try { anchosDelNavegador = anchosValidos({ [rol]: JSON.parse(localStorage.getItem(`rtg_colw_orders_${rol}`) ?? "null") }); } catch { /* nada que valga */ }
      if (!vivo || !hayQueSembrar({ baseLeida: true, hayFila: false, suplantando }, delNavegador, anchosDelNavegador)) return;
      prefsDeLaBase.current = delNavegador;
      anchosDeLaBase.current = anchosDelNavegador;
      void escribeLaFila();
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.role, me?.id, settings.sales_columns]);

  const saveCols = (next: string[]) => {
    setCols(next);
    if (!me || me.role === "sales") return;
    // El navegador SIEMPRE: es la red. Y la base, si se pudo leer — si no, no se escribe a ciegas encima de lo que haya.
    try { localStorage.setItem(colsKey(me.role), JSON.stringify(next)); } catch { /* ignore */ }
    if (SIN_BASE || prefsDeLaBase.current === null) return;
    prefsDeLaBase.current = { ...prefsDeLaBase.current, [me.role]: next };
    void escribeLaFila();
  };

  // Reordenar (D-332): flechas, no arrastre — como pidió el dueño para las paradas (D-007). `null` = restablecer: se
  // BORRA el orden de este rol en vez de igualarlo al canónico, para que una columna futura entre donde diga el canónico.
  const guardaOrden = (next: string[] | null) => {
    setOrden(next);
    if (!me || me.role === "sales" || SIN_BASE || prefsDeLaBase.current === null) return;
    const todos: ColumnasPorRol = { ...ordenDeLaBase.current };
    if (next) todos[me.role] = next; else delete todos[me.role];
    ordenDeLaBase.current = todos;
    // Y la visibilidad va con él, tal como está: reordenar no la pisa.
    prefsDeLaBase.current = { ...prefsDeLaBase.current, [me.role]: cols };
    void escribeLaFila();
  };
  // El ancho (D-338): la tabla avisa UNA vez, al soltar. Vale para todos los roles, también ventas. Sin base leída no se
  // escribe a ciegas: queda en el navegador, como siempre.
  const guardaAnchos = (next: Record<string, number>) => {
    if (!me || SIN_BASE || prefsDeLaBase.current === null) return;
    const todos: AnchosPorRol = { ...anchosDeLaBase.current };
    const suyos = anchosDeUnRol(next, ["__id", ...ORDER_COLUMNS.map((c) => c.key)]);
    if (Object.keys(suyos).length) todos[me.role] = suyos; else delete todos[me.role];
    anchosDeLaBase.current = todos;
    void escribeLaFila();
  };
  const ordenDelSelector = ordenEfectivo(ORDER_COLUMNS.map((c) => c.key), orden);
  // La flecha se apaga cuando pulsarla no movería nada (el tope, contando que una visible salta sobre las ocultas).
  const seMueve = (clave: string, delta: -1 | 1) => mueveColumna(ordenDelSelector, clave, delta, cols).join() !== ordenDelSelector.join();

  // «⚙ Columnas» se cierra con un clic fuera o con Escape (D-275); antes solo con su botón.
  // El contenedor envuelve botón y menú: pulsar el botón con el menú abierto lo cierra, y marcar
  // casillas no.
  const colsRef = useRef<HTMLDivElement>(null);
  useCierraAlSalir(showCols, () => setShowCols(false), () => [colsRef.current]);

  // Keyboard shortcuts (#12): "n" new order, "/" focus search, "Esc" clear.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
      if (typing) {
        if (e.key === "Escape") (el as HTMLInputElement).blur();
        return;
      }
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key.toLowerCase() === "n" && me && canCreate(me)) { e.preventDefault(); setCreating(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [me]);

  // Deep-link: /?order=<id> (e.g. from a notification) opens that order.
  const orderParam = searchParams.get("order");
  useEffect(() => {
    if (!orderParam || !ready) return;
    const found = deliveries.find((d) => d.id === orderParam);
    if (found) setOpen(found);
    // Clear the param so re-navigating to the same order works again.
    router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderParam, ready, deliveries]);

  // Everything this person can see, before the stage chip / preset narrow it
  // further — the "All" count and every stage chip's count come from this,
  // not the full company-wide `deliveries`, so the numbers on the chips
  // always match what actually shows up in the table below them.
  // Ventas tenía aquí un tope de búsqueda de 30 días: desde D-NEXT nadie fuera de admin y logística
  // busca antes de ayer, así que ese tope ya no decidía nada y se fue.
  /**
   * Las dos listas de la pantalla (D-313). La decisión —quién ve qué, y qué corta la ventana de
   * fechas— vive en `ordenesVisibles`, no aquí: la pestaña de factura pendiente necesita una lista
   * distinta de la normal, y dos listas parecidas escritas en dos sitios acaban discrepando.
   *
   * `visibles` es la de siempre y de ella salen «Todas» y las cuentas por etapa; `conPendientes` es
   * esa más las que solo se caían por la ventana y tienen documento pendiente.
   */
  const { visibles: visible, conPendientes, atrasadas } = useMemo(
    () => ordenesVisibles(deliveries, {
      me,
      teaching,
      veTodoElHistorial,
      busqueda: q,
      reglas: settings.order_type_rules ?? {},
      tiendas: settings.stores,
      // Almacén solo ve lo de sus tiendas, también aquí (antes era solo en su cola).
      tiendasDeAlmacen: me?.role === "warehouse" ? tiendasDeAlmacen(me.store, settings.stores) : [],
    }),
    [deliveries, q, me, teaching, veTodoElHistorial, settings.order_type_rules, settings.stores],
  );

  // ¿Pasa el chip de fechas («Todas / Reciente / Hoy») que está pulsado? Lo usan la lista Y las cuentas por etapa
  // (D-357): el dueño vio «Programadas 9» con «Hoy» pulsado y una sola fila. Las cuentas dicen lo que la lista va a
  // enseñar, o no dicen nada.
  const pasaElPreset = useCallback((d: Delivery): boolean => {
    if (preset === "recent" && !withinRecent(d)) return false;
    if (preset === "today" && !isToday(d.delivery_date)) return false;
    if (preset === "overdue" && !isOverdue(d)) return false;
    // A draft has no driver either, but it isn't waiting for one — nobody
    // has submitted it. It was showing up as work to schedule.
    if (preset === "unassigned" && !awaitingDriver(d)) return false;
    if (preset === "mine" && orderOwner(d) !== me?.id) return false;
    return true;
  }, [preset, me?.id]);

  // Las cuentas y las filas salen de la MISMA función de `lib` y de las mismas tres listas (D-384):
  // antes eran dos `useMemo` escritos aquí, y cada pastilla con lista propia tenía que acordarse de
  // contar sobre la lista de la que listaba. Cómo cuenta cada una —la normal por el chip de fecha
  // (D-357), factura pendiente y «Outdated» por el chip solo estando dentro (D-380)— está allí.
  const listas = useMemo(() => ({ visibles: visible, conPendientes, atrasadas }), [visible, conPendientes, atrasadas]);
  const counts = useMemo(
    () => cuentasDeOrdenes(listas, filter, pasaElPreset, settings.order_type_rules ?? {}),
    [listas, filter, pasaElPreset, settings.order_type_rules],
  );

  const rows = useMemo(
    // The board shows every stage as its own column, so ignore the stage chip there.
    () => filasDeOrdenes(listas, view === "board" ? PASTILLA_TODAS : filter, pasaElPreset, settings.order_type_rules ?? {}),
    [listas, filter, view, pasaElPreset, settings.order_type_rules],
  );

  const presets: { id: Preset; en: string; es: string }[] = [
    { id: "all", en: "All", es: "Todas" },
    { id: "recent", en: "Recent", es: "Reciente" },
    { id: "today", en: "Today", es: "Hoy" },
  ];

  const motivos = useMemo(() => motivosDeAnulacion(settings), [settings]);

  if (!me) return null;

  // Who gets the checkbox column.
  //
  // Kept to the roles that dispatch work. Sales had it for a single action
  // (submit for approval) — a whole column of screen for one button — and
  // accounting had it for approve / cancel / set-date, which are decisions
  // worth making one order at a time rather than eight at once.
  //
  // Drivers and warehouse never had it: every control in the bulk bar is
  // gated to office roles, so the column would select rows nothing could
  // then act on.
  //
  // The bar's own buttons are gated to the same roles, so this is the single
  // switch — nothing below can be reached without it.
  const bulkCapable = ["admin", "manager", "logistics"].includes(me.role);

  // ---- Bulk actions (#1) ----
  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () =>
    setSelected((prev) => (rows.every((r) => prev.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id))));
  const chosen = rows.filter((r) => selected.has(r.id));

  /**
   * Un cambio en bloque de fecha o de chofer: se elige, se PREGUNTA con el número y una muestra, y solo entonces se hace
   * (D-372). Antes el `<input type="date">` aplicaba en su `onChange`, o sea al elegir el día, y el 2026-09-23 eso cambió
   * la fecha de 162 órdenes de golpe, 110 de ellas ya entregadas. Las entregadas y anuladas ya no entran: `reparteParaElBloque`.
   */
  const cambioEnBloque = async (accion: { en: string; es: string }, parche: Partial<Delivery>, hecho: (n: number) => { en: string; es: string }) => {
    const { entran, saltadas } = reparteParaElBloque(chosen);
    if (!entran.length) {
      notify(t(`Nothing to change: all ${chosen.length} selected are delivered or canceled.`, `Nada que cambiar: las ${chosen.length} seleccionadas están entregadas o anuladas.`));
      return;
    }
    const pregunta = preguntaDelBloque({ accion, entran, saltadas, etiqueta: (d) => orderLabel(d), etiquetaDeEtapa: stageLabel });
    if (!(await confirmAction(t(pregunta.en, pregunta.es), { danger: false, confirmLabel: t("Apply", "Aplicar") }))) return;
    setBulkBusy(true);
    for (const d of entran) await updateDelivery(d.id, parche);
    setBulkBusy(false);
    const fin = hecho(entran.length);
    notify(t(fin.en, fin.es));
    setSelected(new Set());
  };

  const bulkAssignDriver = (driver: string) => cambioEnBloque(
    { en: `Assign these orders to ${driver}?`, es: `¿Asignar estas órdenes a ${driver}?` },
    { assigned_driver: driver },
    (n) => ({ en: `Assigned ${n} order(s) to ${driver}`, es: `${n} orden(es) asignadas a ${driver}` }));

  const bulkSetDate = (date: string) => cambioEnBloque(
    { en: `Set the delivery date to ${date}?`, es: `¿Fijar la fecha de entrega en ${date}?` },
    { delivery_date: date },
    (n) => ({ en: `Set delivery date on ${n} order(s)`, es: `Fecha de entrega fijada en ${n} orden(es)` }));

  /** Se enseña el botón si hay algo en la selección que este rol pueda anular desde su etapa; lo que
   *  no se pueda lo rechazará la base orden por orden, como cualquier otra tanda. */
  const puedeAnularAlgoDeLaSeleccion = chosen.some((d) => puedeAnular(me.role, d.stage));

  const bulkStage = async (to: "pending" | "approved" | "canceled", extra?: Partial<Delivery>) => {
    if (!chosen.length) return;
    setBulkBusy(true);
    let ok = 0;
    for (const d of chosen) { if (await setStage(d.id, to, undefined, extra)) ok++; }
    setBulkBusy(false);
    notify(t(`${ok} of ${chosen.length} order(s) updated`, `${ok} de ${chosen.length} orden(es) actualizadas`));
    setSelected(new Set());
  };

  // Admin-only shortcut for onboarding: close a backlog of orders that were
  // already delivered in real life before the system existed. Jumps the whole
  // selection straight to Delivered (skipping picked-up etc.) and stamps each
  // order's history with who did it, so it's a traceable manual close.
  const bulkMarkDelivered = async () => {
    if (!chosen.length) return;
    const list = chosen.slice(0, 8).map((d) => `#${orderLabel(d)}`).join(", ") + (chosen.length > 8 ? "…" : "");
    const ok = await confirmAction(t(
      `Mark ${chosen.length} order(s) as Delivered?\n\n${list}\n\nUse this to close orders already delivered before the system was in place. Each order's history will show you marked it delivered.`,
      `¿Marcar ${chosen.length} orden(es) como Entregadas?\n\n${list}\n\nUsa esto para cerrar órdenes ya entregadas antes de tener el sistema. El historial de cada orden mostrará que tú la marcaste como entregada.`,
    ), { danger: false, confirmLabel: t("Mark delivered", "Marcar entregadas") });
    if (!ok) return;
    setBulkBusy(true);
    let done = 0;
    for (const d of chosen) {
      const note = t(
        `Admin ${me.full_name} marked this delivered (closed during system onboarding)`,
        `El administrador ${me.full_name} la marcó como entregada (cierre durante la implementación del sistema)`,
      );
      if (await setStage(d.id, "delivered", note)) done++;
    }
    setBulkBusy(false);
    notify(t(`${done} of ${chosen.length} order(s) marked delivered`, `${done} de ${chosen.length} orden(es) marcadas como entregadas`));
    setSelected(new Set());
  };

  // Admin-only: force any status on the selection, skipping the normal workflow
  // steps. One confirmation for the whole batch, and every order records the
  // override in its own activity history so it's never a silent change.
  const bulkOverride = async (to: Stage) => {
    if (!to || !chosen.length) return;
    const label = stageLabel(to, lang);
    const list = chosen.slice(0, 8).map((d) => `#${orderLabel(d)}`).join(", ") + (chosen.length > 8 ? "…" : "");
    const ok = await confirmAction(t(
      `Override ${chosen.length} order(s) to "${label}"?\n\n${list}\n\nThis skips the normal workflow steps. Each order's history will record the override.`,
      `¿Forzar ${chosen.length} orden(es) a "${label}"?\n\n${list}\n\nEsto omite los pasos normales del flujo. El historial de cada orden registrará el cambio.`,
    ), { danger: true, confirmLabel: t("Override", "Forzar") });
    if (!ok) return;
    setBulkBusy(true);
    let done = 0;
    for (const d of chosen) {
      const note = t(
        `Status overridden ${stageLabel(d.stage, lang)} → ${label} by ${me.full_name}`,
        `Estado forzado ${stageLabel(d.stage, lang)} → ${label} por ${me.full_name}`,
      );
      if (await setStage(d.id, to, note)) done++;
    }
    setBulkBusy(false);
    notify(t(`${done} of ${chosen.length} order(s) set to ${label}`, `${done} de ${chosen.length} orden(es) a ${label}`));
    setSelected(new Set());
  };

  const exportSelected = () => {
    if (!chosen.length) return;
    const headers = deliveryColumns(chosen[0]).map(([h]) => h).concat("Stage");
    const data = chosen.map((d) => deliveryColumns(d).map(([, v]) => v).concat(d.stage));
    downloadCSV(`deliveries_selected_${todayISO()}.csv`, toCSV(headers, data));
  };

  const exportCSV = () => {
    if (!rows.length) return;
    const headers = deliveryColumns(rows[0]).map(([h]) => h).concat("Stage");
    const data = rows.map((d) => deliveryColumns(d).map(([, v]) => v).concat(d.stage));
    downloadCSV(`deliveries_${todayISO()}.csv`, toCSV(headers, data));
  };

  return (
    <>
      <div className="page-head">
        <h2>{t("Orders", "Órdenes")} <span className="count-tag">{rows.length}</span></h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="viewtoggle">
            <button className={"vt " + (view === "table" ? "on" : "")} onClick={() => setView("table")}>☰ {t("Table", "Tabla")}</button>
            <button className={"vt " + (view === "board" ? "on" : "")} onClick={() => setView("board")}>▦ {t("Board", "Tablero")}</button>
          </div>
          {/* All / Today rides with the view switch — both answer "what am I
              looking at", so they belong on the same line. */}
          <div className="viewtoggle">
            {presets.map((p) => (
              <button key={p.id} className={"vt " + (preset === p.id ? "on" : "")} onClick={() => setPreset(p.id)}>
                {t(p.en, p.es)}
              </button>
            ))}
          </div>
          {/* Data exports (Excel / PDF report / CSV) are admin-only. */}
          {me.role === "admin" && <>
            <button className="btn btn-ghost" onClick={() => exportExcelByEmployee(rows, users, lang).catch((e: unknown) => alert(t("Could not load the Excel exporter: ", "No se pudo cargar el exportador de Excel: ") + ((e as { message?: string })?.message || "")))} disabled={!rows.length} title={t("Excel grouped by employee, collapsible", "Excel agrupado por empleado, colapsable")}>📊 {t("Excel", "Excel")}</button>
            <button className="btn btn-ghost" onClick={() => exportPDFByEmployee(rows, users, lang)} disabled={!rows.length}>🖨 {t("PDF", "PDF")}</button>
            <button className="btn btn-ghost" onClick={exportCSV} disabled={!rows.length}>⬇ {t("CSV", "CSV")}</button>
          </>}
          {/* Column picking is an office habit. Sales get a fixed list set by
              an admin, and a driver has one job on a phone — the button was
              just taking room from the list. */}
          {view === "table" && !["sales", "driver"].includes(me.role) && (
            <div ref={colsRef} style={{ position: "relative" }}>
              <button className="btn btn-ghost" onClick={() => setShowCols((s) => !s)}>⚙ {t("Columns", "Columnas")}</button>
              {showCols && (
                <div className="col-menu">
                  <div className="col-menu-head">
                    <b>{t("Show and order columns", "Mostrar y ordenar columnas")}</b>
                    <button className="notif-clear" onClick={() => saveCols(defaultColsFor(me.role))}>{t("Reset", "Restablecer")}</button>
                    {orden && <button className="notif-clear" onClick={() => guardaOrden(null)}>{t("Reset order", "Restablecer orden")}</button>}
                  </div>
                  {ordenDelSelector.map((k) => ORDER_COLUMNS.find((c) => c.key === k)!).map((c) => (
                    <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <label className="col-opt" style={{ flex: 1 }}>
                      <input
                        type="checkbox"
                        checked={cols.includes(c.key)}
                        onChange={() => saveCols(cols.includes(c.key) ? cols.filter((k) => k !== c.key) : [...cols, c.key])}
                      />
                      {lang === "es" ? c.es : c.en}
                    </label>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={!seMueve(c.key, -1)} aria-label={t(`Move ${c.en} up`, `Subir ${c.es}`)} onClick={() => guardaOrden(mueveColumna(ordenDelSelector, c.key, -1, cols))}>↑</button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={!seMueve(c.key, 1)} aria-label={t(`Move ${c.en} down`, `Bajar ${c.es}`)} onClick={() => guardaOrden(mueveColumna(ordenDelSelector, c.key, 1, cols))}>↓</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {me.role === "admin" && (
            <button className="btn btn-ghost" onClick={() => setImporting(true)} title={t("Bulk-create orders from a CSV file", "Crear órdenes en masa desde un archivo CSV")}>⬆ {t("Import", "Importar")}</button>
          )}
          {canCreate(me) && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>+ {t("New order", "Nueva orden")}</button>
          )}
        </div>
      </div>

      <div className="filters">
        <input
          ref={searchRef}
          style={{ maxWidth: 260 }}
          placeholder={t("Search…  (press / )", "Buscar…  (tecla / )")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="filters filters-oneline">
        {view === "table" && (
          <>
            {/* Qué pastillas hay, en qué orden y cuál está encendida lo decide `pastillasDeOrdenes`
                (D-313): «Todas» la primera —antes no existía y volver a verlas todas era volver a
                pulsar la encendida, que nadie descubre—, las etapas del rol, y la de «Factura
                pendiente» (D-310) al final, solo si hay algo o si se está en ella. */}
            {pastillasDeOrdenes({
              etapas: me ? filterStagesFor(me.role) : STAGES.map((s) => s.key),
              todasAprueban: autoApproveAll,
              cuentas: counts,
              filtro: filter,
              // «Outdated» solo para quien ve lo anterior a ayer (D-NEXT): la misma pregunta que corta la lista.
              veDiasViejos: veTodoElHistorial,
            }).map((p) => (
              <button
                key={p.key}
                className={"chip " + (p.clase ? p.clase + " " : "") + (p.activa ? "on" : "")}
                onClick={() => {
                  // Pulsar la encendida vuelve a «Todas» (D-313), y de ahí sale la clave que de
                  // verdad queda puesta. El chip de FECHA lo decide `presetAlElegirPastilla`
                  // (D-380): solo la pestaña de factura pendiente lo mueve, y solo a «Todas».
                  const queda = p.activa ? PASTILLA_TODAS : p.key;
                  setFilter(queda);
                  setPreset((antes) => presetAlElegirPastilla(queda, antes, "all"));
                }}
              >
                {p.key === PASTILLA_TODAS
                  ? t("All", "Todas")
                  : p.key === PESTANA_DOCUMENTO_PENDIENTE
                    ? t("Invoice pending", "Factura pendiente")
                    : p.key === PESTANA_ATRASADAS
                      ? t("Outdated", "Atrasadas")
                      : stageLabel(p.key, lang)} <span className="cnt">{p.cuenta}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {view === "table" && chosen.length > 0 && (
        <div className="bulk-bar">
          <b>{chosen.length} {t("selected", "seleccionadas")}</b>
          <span style={{ flex: 1 }} />
          {me.role === "admin" && (
            <select value={choferEnBloque} disabled={bulkBusy} onChange={(e) => setChoferEnBloque(e.target.value)} style={{ width: "auto" }}>
              <option value="">🚚 {t("Assign driver…", "Asignar chofer…")}</option>
              {driverNames(users).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          {/* Elegir no aplica: aplicar es este botón, y pregunta antes (D-372). */}
          {me.role === "admin" && choferEnBloque && (
            <button className="btn btn-primary btn-sm" disabled={bulkBusy}
              onClick={async () => { await bulkAssignDriver(choferEnBloque); setChoferEnBloque(""); }}>
              {t(`Assign to ${choferEnBloque}…`, `Asignar a ${choferEnBloque}…`)}
            </button>
          )}
          {me.role === "admin" && (
            <select
              defaultValue=""
              disabled={bulkBusy}
              title={t("Force any status, skipping the workflow", "Forzar cualquier estado, omitiendo el flujo")}
              onChange={(e) => { const v = e.target.value as Stage; e.target.value = ""; if (v) bulkOverride(v); }}
              style={{ width: "auto" }}
            >
              <option value="">⚡ {t("Override status…", "Forzar estado…")}</option>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{stageLabel(s.key, lang)}</option>)}
            </select>
          )}
          {canCreate(me) && (
            <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={() => bulkStage("pending")}>{t("Submit for approval", "Enviar a aprobación")}</button>
          )}
          {["manager", "admin", "logistics"].includes(me.role) && (
            <button className="btn btn-green btn-sm" disabled={bulkBusy} onClick={() => bulkStage("approved")}>{t("Approve", "Aprobar")}</button>
          )}
{/* Anular en bloque: el motivo se pide UNA vez para toda la selección y se escribe en cada
              orden. Logística ya no lo ve — veía el botón y la base le rechazaba la escritura (122). */}
          {puedeAnularAlgoDeLaSeleccion && !bulkCancel && (
            <button className="btn btn-danger btn-sm" disabled={bulkBusy} onClick={() => { setBulkCancel(true); setBulkReason(""); setBulkReasonNote(""); }}>{t("Cancel", "Cancelar")}</button>
          )}
          {puedeAnularAlgoDeLaSeleccion && bulkCancel && (
            <>
              <select value={bulkReason} disabled={bulkBusy} style={{ width: "auto" }} onChange={(e) => { setBulkReason(e.target.value); setBulkReasonNote(""); }}>
                <option value="">{t("Cancellation reason…", "Motivo de anulación…")}</option>
                {motivos.map((r) => <option key={r.key} value={r.key}>{t(r.en, r.es)}</option>)}
              </select>
              {pideTextoLibre(bulkReason, motivos) && (
                <input style={{ width: 220 }} value={bulkReasonNote} disabled={bulkBusy} onChange={(e) => setBulkReasonNote(e.target.value)} placeholder={t("Say why (required)", "Escriba por qué (obligatorio)")} />
              )}
              <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={() => setBulkCancel(false)}>{t("Back", "Atrás")}</button>
              <button
                className="btn btn-danger btn-sm"
                disabled={bulkBusy || !!faltaParaAnular(bulkReason, bulkReasonNote, motivos, lang)}
                onClick={async () => {
                  if (!(await confirmAction(t(`Cancel ${chosen.length} selected order(s)?`, `¿Anular ${chosen.length} orden(es) seleccionada(s)?`), { danger: true, confirmLabel: t("Cancel orders", "Anular órdenes") }))) return;
                  await bulkStage("canceled", { canceled_reason: bulkReason, canceled_reason_note: bulkReasonNote.trim() || null });
                  setBulkCancel(false);
                }}
              >{t("Confirm cancel", "Confirmar anulación")}</button>
            </>
          )}
          {me.role === "admin" && (
            <button className="btn btn-green btn-sm" disabled={bulkBusy} onClick={bulkMarkDelivered} title={t("Close orders already delivered before the system (onboarding)", "Cerrar órdenes ya entregadas antes del sistema (implementación)")}>✅ {t("Mark delivered", "Marcar entregadas")}</button>
          )}
          {(me.role === "manager" || me.role === "admin" || me.role === "logistics") && (
            <label style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }} title={t("Set delivery date on all selected", "Fijar fecha de entrega en las seleccionadas")}>
              📅
              <input type="date" value={fechaEnBloque} disabled={bulkBusy} onChange={(e) => setFechaEnBloque(e.target.value)} style={{ width: "auto", padding: "4px 6px" }} />
            </label>
          )}
          {/* Igual que el chofer: la fecha elegida no se aplica hasta pulsar, y entonces se pregunta (D-372). */}
          {(me.role === "manager" || me.role === "admin" || me.role === "logistics") && fechaEnBloque && (
            <button className="btn btn-primary btn-sm" disabled={bulkBusy}
              onClick={async () => { await bulkSetDate(fechaEnBloque); setFechaEnBloque(""); }}>
              {t(`Set date ${fechaEnBloque}…`, `Fijar fecha ${fechaEnBloque}…`)}
            </button>
          )}
          {me.role === "admin" && <button className="btn btn-ghost btn-sm" disabled={bulkBusy} onClick={exportSelected}>⬇ {t("Export", "Exportar")}</button>}
          <button className="btn btn-sm" onClick={() => setSelected(new Set())}>✕</button>
        </div>
      )}

      {ready ? (
        view === "board" ? (
          <OrdersBoard rows={rows} onOpen={setOpen} />
        ) : (
          <OrdersTable
            rows={rows}
            resizeKey={`orders_${me.role}`}
            anchos={anchos}
            onAnchos={guardaAnchos}
            onOpen={setOpen}
            empty={t("No orders match this view.", "No hay órdenes en esta vista.")}
            visible={cols}
            orden={me?.role === "sales" ? null : orden}
            // The checkbox column only earns its space for roles that have a
            // bulk action in the bar above (approve, cancel, reassign, set a
            // date, export). A driver has none, so it was pure clutter.
            selectable={bulkCapable}
            // Phones: one collapsed card per order, opened with the chevron.
            collapsible
            porTienda={filter === PESTANA_DOCUMENTO_PENDIENTE}
            tiendasPrimero={tiendasDeQuienMira(me)}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            isUrgent={(d) => {
              const cutoff = me.role === "manager" ? settings.manager_pending_cutoff
                : me.role === "sales" ? settings.sales_pending_cutoff
                : null;
              return isPendingUrgent(d, cutoff);
            }}
          />
        )
      ) : (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      )}

      {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
      {creating && <OrderModal me={me} existing={null} startEditing onClose={() => setCreating(false)} />}
      {importing && <ImportOrdersModal onClose={() => setImporting(false)} />}
    </>
  );
}
