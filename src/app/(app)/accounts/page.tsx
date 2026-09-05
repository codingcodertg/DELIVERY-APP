"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { stageInfo, stageLabel } from "@/lib/constants";
import { OrderModal } from "@/components/OrderModal";
import { deliveryColumns, downloadCSV, fmtDate, fmtMoney, isOverdue, orderLabel, orderOwner, toCSV, todayISO } from "@/lib/utils";
import { useColWidths } from "@/lib/use-col-widths";
import { useConfirm } from "@/lib/confirm";
import type { AccountRecord, Delivery, Settings } from "@/lib/types";

// ============================================================
// Customer accounts — every order grouped by the customer it belongs to.
// Pick an account to see its whole delivery history, totals and open work.
// Read-only view over the orders they can already see. Not shown to sales or
// drivers — they work order-by-order, not account-by-account.
// ============================================================

interface AccountRow {
  name: string;
  orders: Delivery[];
  total: number;
  active: number;
  delivered: number;
  overdue: number;
  pallets: number;
  fees: number;
  lastDate: string | null;
  mine: boolean;
}

const CLOSED = ["delivered", "canceled", "rejected"];

export default function AccountsPage() {
  const { me, deliveries, settings, ready, saveSettings, notify , ensureDeliveriesSince } = useData();
  // G-16: this screen reads every order ever (per-account history / reference counts), so it
  // asks the provider for the whole history once; the provider keeps a window by default.
  useEffect(() => { void ensureDeliveriesSince(null); }, [ensureDeliveriesSince]);
  const { lang, t } = usePrefs();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState<Delivery | null>(null);
  // Excel-style resizable columns for the accounts list.
  const acctCols = useColWidths("rtg_accounts", [220, 90, 80, 110, 90, 90, 100, 140]);

  // Per-user customer visibility (set on the Users page). Admin always "all".
  const myScope: "all" | "own" = me?.role === "admin" ? "all" : (settings.customer_scope?.[me?.id ?? ""] ?? "all");
  // "own" users are locked to their own customers; "all" users get a toggle.
  const [view, setView] = useState<"all" | "mine">("all");
  const effectiveView: "all" | "mine" = myScope === "own" ? "mine" : view;

  const accounts = useMemo<AccountRow[]>(() => {
    const map = new Map<string, Delivery[]>();
    for (const d of deliveries) {
      const key = (d.account || "").trim() || t("(no account)", "(sin cuenta)");
      (map.get(key) ?? map.set(key, []).get(key)!).push(d);
    }
    return [...map.entries()]
      .map(([name, orders]) => ({
        name,
        orders: orders.sort((a, b) => b.order_no - a.order_no),
        total: orders.length,
        active: orders.filter((d) => !CLOSED.includes(d.stage)).length,
        delivered: orders.filter((d) => d.stage === "delivered").length,
        overdue: orders.filter(isOverdue).length,
        pallets: Math.round(orders.reduce((s, d) => s + Number(d.actual_pallets ?? d.est_pallets ?? 0), 0)),
        fees: Math.round(orders.filter((d) => d.stage !== "canceled").reduce((s, d) => s + (d.delivery_fee ?? 0), 0) * 100) / 100,
        lastDate: orders.map((d) => d.delivery_date).filter(Boolean).sort().reverse()[0] ?? null,
        // "Mine" = this customer has at least one order I own (created / assigned to me).
        mine: !!me && orders.some((d) => orderOwner(d) === me.id),
      }))
      .sort((a, b) => b.total - a.total);
  }, [deliveries, t, me]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return accounts.filter((a) =>
      (effectiveView === "all" || a.mine) &&
      (!needle || a.name.toLowerCase().includes(needle)),
    );
  }, [accounts, q, effectiveView]);

  const current = picked ? accounts.find((a) => a.name === picked) ?? null : null;

  if (!me) return null;
  if (me.role === "sales" || me.role === "driver" || me.role === "warehouse") return <div className="empty">{t("Not available for your role.", "No disponible para su rol.")}</div>;

  const exportAccount = (a: AccountRow) => {
    const headers = deliveryColumns(a.orders[0]).map(([h]) => h).concat("Stage");
    const data = a.orders.map((d) => deliveryColumns(d).map(([, v]) => v).concat(d.stage));
    downloadCSV(`account_${a.name.replace(/[^a-z0-9]+/gi, "_")}_${todayISO()}.csv`, toCSV(headers, data));
  };

  // ---------- Detail: one account's history ----------
  if (current) {
    return (
      <>
        <div className="page-head">
          <h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setPicked(null)}>← {t("Accounts", "Cuentas")}</button>{" "}
            {current.name}
          </h2>
          {me?.role === "admin" && <button className="btn btn-ghost" onClick={() => exportAccount(current)}>⬇ {t("Export", "Exportar")}</button>}
        </div>

        <div className="kpi-grid">
          <div className="kpi"><b>{current.total}</b><span>{t("Orders", "Órdenes")}</span></div>
          <div className="kpi"><b style={{ color: "var(--accent)" }}>{current.active}</b><span>{t("Open", "Abiertas")}</span></div>
          <div className="kpi"><b style={{ color: "var(--green)" }}>{current.delivered}</b><span>{t("Delivered", "Entregadas")}</span></div>
          <div className="kpi"><b style={{ color: current.overdue ? "var(--red)" : undefined }}>{current.overdue}</b><span>{t("Overdue", "Atrasadas")}</span></div>
          <div className="kpi"><b>{current.pallets}</b><span>{t("Pallets", "Pallets")}</span></div>
          <div className="kpi"><b style={{ color: "var(--green)", fontSize: 17 }}>{fmtMoney(current.fees)}</b><span>{t("Fees", "Cobros")}</span></div>
        </div>

        <div className="card">
          <h2>🕑 {t("Delivery history", "Historial de entregas")}</h2>
          <div className="bar-list">
            {current.orders.map((d) => (
              <button key={d.id} className="acct-row" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setOpen(d)}>
                <span className="ordno">{orderLabel(d)}</span>
                {d.order_type && <span className="sema" style={{ background: "var(--gray)", color: "#fff" }}>{d.order_type}</span>}
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.delivery_address || d.store || "—"}
                </span>
                <span className="hint">{fmtDate(d.delivery_date)}</span>
                {d.delivery_fee != null && <span className="hint">{fmtMoney(d.delivery_fee)}</span>}
                <span className="sema" style={{ background: stageInfo(d.stage).color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span>
              </button>
            ))}
          </div>
        </div>

        {open && <OrderModal me={me} existing={open} startEditing={false} onClose={() => setOpen(null)} />}
      </>
    );
  }

  // ---------- List: all accounts ----------
  return (
    <>
      <div className="page-head">
        <h2>{t("Accounts", "Cuentas")} <span className="count-tag">{rows.length}</span></h2>
        <button className="btn btn-ghost btn-sm" onClick={acctCols.reset} title={t("Reset column widths", "Restablecer anchos")}>↔ {t("Reset columns", "Restablecer columnas")}</button>
      </div>

      {/* Manage the saved customer records that auto-fill orders. */}
      <SavedCustomers settings={settings} saveSettings={saveSettings} notify={notify} t={t} />

      <div className="filters">
        <input
          style={{ maxWidth: 280 }}
          placeholder={t("Search account…", "Buscar cuenta…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {myScope === "all" ? (
          <div className="toggle-group">
            <button className={"toggle-btn " + (effectiveView === "all" ? "on" : "")} onClick={() => setView("all")}>
              {t("All customers", "Todos los clientes")}
            </button>
            <button className={"toggle-btn " + (effectiveView === "mine" ? "on" : "")} onClick={() => setView("mine")}>
              {t("My customers", "Mis clientes")}
            </button>
          </div>
        ) : (
          <span className="sema" style={{ background: "var(--accent)", color: "#fff" }}>{t("Your customers only", "Solo sus clientes")}</span>
        )}
      </div>

      {!ready ? (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      ) : rows.length === 0 ? (
        <div className="empty">{t("No accounts match.", "No hay cuentas que coincidan.")}</div>
      ) : (
        <div className="tbl-scroll">
          <table className="orders tbl-resize">
            <colgroup>{acctCols.widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead>
              <tr>
                <th>{t("Account", "Cuenta")}<span className="col-resizer" onMouseDown={acctCols.startResize(0)} /></th>
                <th>{t("Orders", "Órdenes")}<span className="col-resizer" onMouseDown={acctCols.startResize(1)} /></th>
                <th>{t("Open", "Abiertas")}<span className="col-resizer" onMouseDown={acctCols.startResize(2)} /></th>
                <th>{t("Delivered", "Entregadas")}<span className="col-resizer" onMouseDown={acctCols.startResize(3)} /></th>
                <th>{t("Overdue", "Atrasadas")}<span className="col-resizer" onMouseDown={acctCols.startResize(4)} /></th>
                <th>{t("Pallets", "Pallets")}<span className="col-resizer" onMouseDown={acctCols.startResize(5)} /></th>
                <th>{t("Fees", "Cobros")}<span className="col-resizer" onMouseDown={acctCols.startResize(6)} /></th>
                <th>{t("Last delivery", "Última entrega")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.name} className="clickable" onClick={() => setPicked(a.name)}>
                  <td style={{ fontWeight: 700 }}>{a.name}</td>
                  <td>{a.total}</td>
                  <td>{a.active || "—"}</td>
                  <td>{a.delivered || "—"}</td>
                  <td style={a.overdue ? { color: "var(--red)", fontWeight: 700 } : undefined}>{a.overdue || "—"}</td>
                  <td>{a.pallets || "—"}</td>
                  <td>{a.fees ? fmtMoney(a.fees) : "—"}</td>
                  <td>{a.lastDate ? fmtDate(a.lastDate) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** CRUD for the saved customer records (settings.accounts) — the ones that
 * auto-fill an order's contact, phone, usual address and type. */
function SavedCustomers({ settings, saveSettings, notify, t }: {
  settings: Settings;
  saveSettings: (patch: Partial<Settings>) => void;
  notify: (m: string) => void;
  t: (en: string, es: string) => string;
}) {
  const accounts = settings.accounts ?? [];
  const [open, setOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [form, setForm] = useState<AccountRecord>({ name: "", contact: "", phone: "", address: "", intertienda: false });
  const [q, setQ] = useState("");
  const confirmAction = useConfirm();

  const startNew = () => { setEditingName(null); setForm({ name: "", contact: "", phone: "", address: "", intertienda: false }); setOpen(true); };
  const startEdit = (a: AccountRecord) => { setEditingName(a.name); setForm({ name: a.name, contact: a.contact, phone: a.phone, address: a.address ?? "", intertienda: !!a.intertienda }); setOpen(true); };
  const save = () => {
    const name = form.name.trim();
    if (!name) { notify(t("Enter a customer name.", "Ingrese un nombre de cliente.")); return; }
    const rec: AccountRecord = { name, contact: form.contact.trim(), phone: form.phone.trim(), address: form.address?.trim() || undefined, intertienda: !!form.intertienda };
    const drop = new Set([name.toLowerCase(), (editingName ?? name).toLowerCase()]);
    const next = [...accounts.filter((a) => !drop.has(a.name.toLowerCase())), rec].sort((a, b) => a.name.localeCompare(b.name));
    saveSettings({ accounts: next });
    setOpen(false);
    notify(t(`Saved "${name}"`, `"${name}" guardado`));
  };
  const remove = async (a: AccountRecord) => {
    if (!(await confirmAction(t(`Delete saved customer "${a.name}"?`, `¿Eliminar cliente guardado "${a.name}"?`), { danger: true, confirmLabel: t("Delete", "Eliminar") }))) return;
    saveSettings({ accounts: accounts.filter((x) => x.name.toLowerCase() !== a.name.toLowerCase()) });
    notify(t("Deleted", "Eliminado"));
  };
  const shown = q.trim()
    ? accounts.filter((a) => `${a.name} ${a.contact} ${a.phone}`.toLowerCase().includes(q.trim().toLowerCase()))
    : accounts;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>👥 {t("Saved customers", "Clientes guardados")} <span className="count-tag">{accounts.length}</span></h2>
        {!open && <button className="btn btn-primary btn-sm" onClick={startNew}>＋ {t("Add customer", "Agregar cliente")}</button>}
      </div>
      <p className="hint" style={{ marginTop: 6, marginBottom: 10 }}>
        {t("Saved here, a customer auto-fills the contact, phone, usual address and type when picked on an order.",
           "Guardado aquí, un cliente auto-llena el contacto, teléfono, dirección habitual y tipo al elegirlo en una orden.")}
      </p>

      {open && (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div className="grid g2">
            <div className="field"><label>{t("Name", "Nombre")}</label><input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("Customer name", "Nombre del cliente")} /></div>
            <div className="field"><label>{t("Contact", "Contacto")}</label><input value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} /></div>
            <div className="field"><label>{t("Phone", "Teléfono")}</label><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
            <div className="field"><label>{t("Usual address", "Dirección habitual")}</label><input value={form.address ?? ""} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} /></div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", textTransform: "none", letterSpacing: 0 }}>
            <input type="checkbox" style={{ width: "auto", margin: 0 }} checked={!!form.intertienda} onChange={(e) => setForm((f) => ({ ...f, intertienda: e.target.checked }))} />
            {t("Internal branch (Intertienda)", "Sucursal interna (Intertienda)")}
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>{t("Cancel", "Cancelar")}</button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={!form.name.trim()}>{editingName ? t("Save", "Guardar") : t("Add", "Agregar")}</button>
          </div>
        </div>
      )}

      {accounts.length > 4 && <input placeholder={t("Search saved customers…", "Buscar clientes guardados…")} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280, marginBottom: 8 }} />}
      {accounts.length === 0 ? (
        <div className="hint">{t("No saved customers yet — add one, or they save automatically when you type a new account on an order.", "Aún no hay clientes guardados — agregue uno, o se guardan solos al escribir una cuenta nueva en una orden.")}</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {shown.map((a) => (
            <div key={a.name} className="card" style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <b style={{ minWidth: 130 }}>{a.name}{a.intertienda && <span className="sema" style={{ background: "var(--purple)", color: "#fff", marginLeft: 6 }}>Intertienda</span>}</b>
              <span className="hint" style={{ margin: 0 }}>👤 {a.contact || "—"}</span>
              <span className="hint" style={{ margin: 0 }}>📞 {a.phone || "—"}</span>
              <span className="hint" style={{ margin: 0, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.address || ""}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => startEdit(a)}>✏ {t("Edit", "Editar")}</button>
              <button className="btn btn-danger btn-sm" onClick={() => remove(a)}>🗑</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
