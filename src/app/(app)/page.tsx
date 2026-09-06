"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { AUTO_CANCEL_LATE_ENABLED, canCreate, driverNames, filterStagesFor, ROLE_DEFAULT_COLUMNS, STAGES, stageLabel } from "@/lib/constants";
import { OrdersTable, ORDER_COLUMNS, DEFAULT_COLUMNS } from "@/components/OrdersTable";
import { OrdersBoard } from "@/components/OrdersBoard";
import { OrderModal } from "@/components/OrderModalLazy";
import { ImportOrdersModal } from "@/components/ImportOrdersModal";
import { awaitingDriver, daysBetween, deliveryColumns, downloadCSV, LATE_GRACE_DAYS, orderLabel, isOverdue, isPendingUrgent, isToday, orderOwner, shiftDateISO, toCSV, todayISO, withinRetention } from "@/lib/utils";
import { exportExcelByEmployee, exportPDFByEmployee } from "@/lib/export";
import type { Delivery, Stage, UserRole } from "@/lib/types";

// Quick saved views — one-tap presets layered on top of the stage chip.
type Preset = "all" | "today" | "overdue" | "unassigned" | "mine";

// Column choices are remembered per role — so switching "View as" in local
// demo mode (or just different people on different roles) doesn't clobber
// each other's picks, and each role starts from its own sensible default.
const colsKey = (role: UserRole) => `rtg_order_columns_${role}`;
const defaultColsFor = (role: UserRole) => ROLE_DEFAULT_COLUMNS[role] ?? DEFAULT_COLUMNS;

export default function OrdersPage() {
  const { me, users, deliveries, settings, ready, teaching, realRole, updateDelivery, setStage, notify, ensureDeliveriesSince } = useData();
  // An admin previewing a role (view-as) sees EVERY order — none of the
  // role-scoped/date-window restrictions apply, so they can test with all data.
  const adminAllAccess = realRole === "admin";
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
      void setStage(d.id, "canceled", "Auto-canceled: 2+ days late without reprogramming");
    }
  }, [ready, teaching, me, deliveries, setStage]);

  // Every store auto-approves → nothing ever sits in "Pending Approval", so
  // that stage's filter chip is dropped and manager/sales land on Programmed.
  const autoApproveAll = settings.stores.length > 0 && settings.stores.every((s) => s.auto_approve);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<string>("all");
  const [preset, setPreset] = useState<Preset>("all");
  const [q, setQ] = useState("");
  // G-16: the provider keeps a window of orders; an admin typing a search may be looking for an
  // old one, so the first non-empty search asks for the whole history (once; idempotent). Sales
  // are capped at 30 days below anyway, well inside the window.
  useEffect(() => { if (adminAllAccess && q.trim()) void ensureDeliveriesSince(null); }, [q, adminAllAccess, ensureDeliveriesSince]);
  const [view, setView] = useState<"table" | "board">("table");
  const [open, setOpen] = useState<Delivery | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Bulk selection (#1) + user-chosen columns (#13, persisted per browser).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cols, setCols] = useState<string[]>(DEFAULT_COLUMNS);
  const [showCols, setShowCols] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

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
    if (me.role === "sales") {
      setCols(settings.sales_columns ?? defaultColsFor("sales"));
      return;
    }
    try {
      const raw = localStorage.getItem(colsKey(me.role));
      setCols(raw ? JSON.parse(raw) : defaultColsFor(me.role));
    } catch {
      setCols(defaultColsFor(me.role));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.role, settings.sales_columns]);

  const saveCols = (next: string[]) => {
    setCols(next);
    if (!me || me.role === "sales") return;
    try { localStorage.setItem(colsKey(me.role), JSON.stringify(next)); } catch { /* ignore */ }
  };

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
  // A salesperson can only search 30 days back.
  const salesSearchFloor = shiftDateISO(todayISO(), -30);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return deliveries.filter((d) => {
      // Teaching mode is a fully open sandbox — every user sees every practice
      // order, so none of the role-scoped restrictions below apply.
      if (!teaching && !adminAllAccess) {
        // Sales only ever sees their own orders — a hard boundary, not
        // relaxed by search, unlike the date-window restriction below.
        // "Own" includes orders an office/admin/driver assigned to them.
        if (me?.role === "sales" && orderOwner(d) !== me.id) return false;
        // Sales never see canceled orders (a canceled order disappears for them).
        if (me?.role === "sales" && d.stage === "canceled") return false;
        // Warehouse only ever sees orders that have been approved — never
        // draft / pending / rejected / canceled (pre-approval or dead orders).
        if (me?.role === "warehouse" && !["approved", "fulfilling", "ready", "picked_up", "delivered"].includes(d.stage)) return false;
      }
      if (!needle) {
        // The working roles see yesterday onward. Older history is still
        // there, reached by searching (an invoice #) rather than scrolled to,
        // so the list stays on active work.
        //
        // This used to name sales only, which is why a driver's list still
        // reached back weeks: the driver page filtered, this one didn't, and
        // this is the one they land on.
        const nearTerm = me?.role === "sales" || me?.role === "driver" || me?.role === "warehouse";
        if (!teaching && !adminAllAccess && nearTerm && !withinRetention(d)) return false;
        return true;
      }
      // Sales can only search 30 days back; older orders stay out of reach.
      if (!teaching && !adminAllAccess && me?.role === "sales" && d.delivery_date && d.delivery_date < salesSearchFloor) return false;
      const hay = [d.order_code, d.order_no, d.account, d.so_num, d.po2, d.invoice_num, d.store, d.delivery_address, d.contact, d.assigned_driver, d.delivery_phone]
        .map((x) => String(x ?? "").toLowerCase()).join(" ");
      return hay.includes(needle);
    });
  }, [deliveries, q, me?.id, me?.role, teaching, adminAllAccess, salesSearchFloor]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: visible.length };
    for (const d of visible) c[d.stage] = (c[d.stage] ?? 0) + 1;
    return c;
  }, [visible]);

  const rows = useMemo(() => {
    // The board shows every stage as its own column, so ignore the stage chip there.
    const activeFilter = view === "board" ? "all" : filter;
    return visible.filter((d) => {
      if (activeFilter !== "all" && d.stage !== activeFilter) return false;
      if (preset === "today" && !isToday(d.delivery_date)) return false;
      if (preset === "overdue" && !isOverdue(d)) return false;
      // A draft has no driver either, but it isn't waiting for one — nobody
      // has submitted it. It was showing up as work to schedule.
      if (preset === "unassigned" && !awaitingDriver(d)) return false;
      if (preset === "mine" && orderOwner(d) !== me?.id) return false;
      return true;
    });
  }, [visible, filter, preset, view, me?.id]);

  const presets: { id: Preset; en: string; es: string }[] = [
    { id: "all", en: "All", es: "Todas" },
    { id: "today", en: "Today", es: "Hoy" },
  ];

  if (!me) return null;
  if (me.role === "warehouse") return <div className="empty">{t("Not available for your role — use the Warehouse or Driver view.", "No disponible para su rol — use la vista de Almacén o Chofer.")}</div>;

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

  const bulkAssignDriver = async (driver: string) => {
    if (!driver || !chosen.length) return;
    setBulkBusy(true);
    for (const d of chosen) await updateDelivery(d.id, { assigned_driver: driver });
    setBulkBusy(false);
    notify(t(`Assigned ${chosen.length} order(s) to ${driver}`, `${chosen.length} orden(es) asignadas a ${driver}`));
    setSelected(new Set());
  };

  const bulkSetDate = async (date: string) => {
    if (!date || !chosen.length) return;
    setBulkBusy(true);
    for (const d of chosen) await updateDelivery(d.id, { delivery_date: date });
    setBulkBusy(false);
    notify(t(`Set delivery date on ${chosen.length} order(s)`, `Fecha de entrega fijada en ${chosen.length} orden(es)`));
    setSelected(new Set());
  };

  const bulkStage = async (to: "pending" | "approved" | "canceled") => {
    if (!chosen.length) return;
    setBulkBusy(true);
    let ok = 0;
    for (const d of chosen) { if (await setStage(d.id, to)) ok++; }
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
            <button className="btn btn-ghost" onClick={() => exportExcelByEmployee(rows, users, lang)} disabled={!rows.length} title={t("Excel grouped by employee, collapsible", "Excel agrupado por empleado, colapsable")}>📊 {t("Excel", "Excel")}</button>
            <button className="btn btn-ghost" onClick={() => exportPDFByEmployee(rows, users, lang)} disabled={!rows.length}>🖨 {t("PDF", "PDF")}</button>
            <button className="btn btn-ghost" onClick={exportCSV} disabled={!rows.length}>⬇ {t("CSV", "CSV")}</button>
          </>}
          {/* Column picking is an office habit. Sales get a fixed list set by
              an admin, and a driver has one job on a phone — the button was
              just taking room from the list. */}
          {view === "table" && !["sales", "driver"].includes(me.role) && (
            <div style={{ position: "relative" }}>
              <button className="btn btn-ghost" onClick={() => setShowCols((s) => !s)}>⚙ {t("Columns", "Columnas")}</button>
              {showCols && (
                <div className="col-menu">
                  <div className="col-menu-head">
                    <b>{t("Show columns", "Mostrar columnas")}</b>
                    <button className="notif-clear" onClick={() => saveCols(defaultColsFor(me.role))}>{t("Reset", "Restablecer")}</button>
                  </div>
                  {ORDER_COLUMNS.map((c) => (
                    <label key={c.key} className="col-opt">
                      <input
                        type="checkbox"
                        checked={cols.includes(c.key)}
                        onChange={() => saveCols(cols.includes(c.key) ? cols.filter((k) => k !== c.key) : [...cols, c.key])}
                      />
                      {lang === "es" ? c.es : c.en}
                    </label>
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
            {(me ? filterStagesFor(me.role) : STAGES.map((s) => s.key))
              .filter((key) => !(autoApproveAll && key === "pending"))
              .map((key) => (
              <button key={key} className={"chip " + (filter === key ? "on" : "")} onClick={() => setFilter(filter === key ? "all" : key)}>
                {stageLabel(key, lang)} <span className="cnt">{counts[key] ?? 0}</span>
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
            <select defaultValue="" disabled={bulkBusy} onChange={(e) => { bulkAssignDriver(e.target.value); e.target.value = ""; }} style={{ width: "auto" }}>
              <option value="">🚚 {t("Assign driver…", "Asignar chofer…")}</option>
              {driverNames(users).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
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
          {["manager", "admin", "logistics"].includes(me.role) && (
            <button className="btn btn-danger btn-sm" disabled={bulkBusy} onClick={async () => {
              if (await confirmAction(t(`Cancel ${chosen.length} selected order(s)?`, `¿Cancelar ${chosen.length} orden(es) seleccionada(s)?`), { danger: true, confirmLabel: t("Cancel orders", "Cancelar órdenes") })) bulkStage("canceled");
            }}>{t("Cancel", "Cancelar")}</button>
          )}
          {me.role === "admin" && (
            <button className="btn btn-green btn-sm" disabled={bulkBusy} onClick={bulkMarkDelivered} title={t("Close orders already delivered before the system (onboarding)", "Cerrar órdenes ya entregadas antes del sistema (implementación)")}>✅ {t("Mark delivered", "Marcar entregadas")}</button>
          )}
          {(me.role === "manager" || me.role === "admin" || me.role === "logistics") && (
            <label style={{ margin: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }} title={t("Set delivery date on all selected", "Fijar fecha de entrega en las seleccionadas")}>
              📅
              <input type="date" disabled={bulkBusy} onChange={(e) => { if (e.target.value) bulkSetDate(e.target.value); e.target.value = ""; }} style={{ width: "auto", padding: "4px 6px" }} />
            </label>
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
            onOpen={setOpen}
            empty={t("No orders match this view.", "No hay órdenes en esta vista.")}
            visible={cols}
            // The checkbox column only earns its space for roles that have a
            // bulk action in the bar above (approve, cancel, reassign, set a
            // date, export). A driver has none, so it was pure clutter.
            selectable={bulkCapable}
            // Phones: one collapsed card per order, opened with the chevron.
            collapsible
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
