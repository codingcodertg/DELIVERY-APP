"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { AddressInput } from "@/components/AddressInput";
import type { Delivery, NamedLocation, OrderTypeRule, Settings } from "@/lib/types";

// ============================================================
// Data — the reusable reference lists behind the order form: pickup points,
// dropoff sites, stores and order types. Everything an admin needs to curate
// the pick-lists that sales choose from, in one place.
//
// Saved locations accumulate as reps hit "Save for next time" on an order, so
// they need somewhere to be corrected or cleaned up. That's this page.
// ============================================================

export default function DataPage() {
  const { me, settings, deliveries, saveSettings, notify , ensureDeliveriesSince } = useData();
  // G-16: this screen reads every order ever (per-account history / reference counts), so it
  // asks the provider for the whole history once; the provider keeps a window by default.
  useEffect(() => { void ensureDeliveriesSince(null); }, [ensureDeliveriesSince]);
  const { t } = usePrefs();

  if (!me) return null;
  if (me.role !== "admin") return <div className="empty">{t("Admins only.", "Solo administradores.")}</div>;

  const save = (patch: Partial<Settings>, msg: string) => { saveSettings(patch); notify(msg); };

  return (
    <>
      <div className="page-head"><h2>{t("Data", "Datos")}</h2></div>
      <p className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
        {t(
          "The reference lists the order form pulls from. Anything a salesperson saves while writing an order lands here — edit or remove it any time.",
          "Las listas de referencia que usa el formulario de órdenes. Lo que un vendedor guarde al escribir una orden aparece aquí — edítelo o elimínelo cuando quiera.",
        )}
      </p>

      <LocationTable
        title={`📦 ${t("Pickup points", "Puntos de recolección")}`}
        blurb={t("Warehouses, yards and suppliers a driver collects from.", "Almacenes, patios y proveedores donde el chofer recoge.")}
        items={settings.pickup_locations ?? []}
        usageField="pickup_name"
        deliveries={deliveries}
        onChange={(v) => save({ pickup_locations: v }, t("Pickup points saved", "Puntos de recolección guardados"))}
        t={t}
      />

      <LocationTable
        title={`🏁 ${t("Dropoff sites", "Sitios de entrega")}`}
        blurb={t("Recurring customer sites and job sites.", "Sitios de clientes y obras recurrentes.")}
        items={settings.delivery_locations ?? []}
        usageField="delivery_name"
        deliveries={deliveries}
        onChange={(v) => save({ delivery_locations: v }, t("Dropoff sites saved", "Sitios de entrega guardados"))}
        t={t}
      />

      <LocationTable
        title={`🏬 ${t("Stores (Sold From)", "Tiendas (Vendido desde)")}`}
        blurb={t("Your branches. Also offered as pickup points on every order.", "Sus sucursales. También se ofrecen como puntos de recolección.")}
        items={settings.stores}
        usageField="store"
        deliveries={deliveries}
        autoApprove
        onChange={(v) => save({ stores: v }, t("Stores saved", "Tiendas guardadas"))}
        t={t}
      />

      <OrderTypesRulesEditor settings={settings} deliveries={deliveries} save={save} t={t} />

      <AccountsEditor settings={settings} save={save} t={t} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Saved accounts: name + contact + phone, plus an "Intertienda" flag marking a
// branch (internal) account. On the order form, picking an account auto-fills
// the contact/phone and defaults the order type (Intertienda vs Customer).
// ---------------------------------------------------------------------------
function AccountsEditor({
  settings, save, t,
}: {
  settings: Settings;
  save: (patch: Partial<Settings>, msg: string) => void;
  t: (en: string, es: string) => string;
}) {
  type Row = { name: string; contact: string; phone: string; intertienda: boolean };
  const build = (): Row[] =>
    (settings.accounts ?? []).map((a) => ({ name: a.name, contact: a.contact, phone: a.phone, intertienda: !!a.intertienda }));
  const [rows, setRows] = useState<Row[]>(build);
  const [dirty, setDirty] = useState(false);

  const update = (i: number, patch: Partial<Row>) => { setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); setDirty(true); };
  const add = () => { setRows((rs) => [...rs, { name: "", contact: "", phone: "", intertienda: false }]); setDirty(true); };
  const remove = (i: number) => { setRows((rs) => rs.filter((_, idx) => idx !== i)); setDirty(true); };
  const reset = () => { setRows(build()); setDirty(false); };

  const commit = () => {
    const seen = new Set<string>();
    const accounts = rows
      .map((r) => ({ name: r.name.trim(), contact: r.contact.trim(), phone: r.phone.trim(), intertienda: r.intertienda }))
      .filter((r) => { const k = r.name.toLowerCase(); if (!r.name || seen.has(k)) return false; seen.add(k); return true; });
    save({ accounts }, t("Accounts saved", "Cuentas guardadas"));
    setDirty(false);
  };

  return (
    <div className="card">
      <h2>🏢 {t("Accounts", "Cuentas")} <span className="count-tag">{rows.length}</span></h2>
      <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        {t(
          "Picking an account on an order auto-fills its contact + phone. Flag a branch (internal) account as “Intertienda” and the order type defaults to Intertienda — otherwise Customer. Always changeable on the order.",
          "Elegir una cuenta en una orden autocompleta su contacto + teléfono. Marque una cuenta de sucursal (interna) como “Intertienda” y el tipo de orden será Intertienda por defecto — de lo contrario Customer. Siempre editable en la orden.",
        )}
      </p>
      <div className="tbl-scroll" style={{ border: "none" }}>
        <table className="orders" style={{ minWidth: 620 }}>
          <thead>
            <tr>
              <th>{t("Account", "Cuenta")}</th>
              <th>{t("Contact", "Contacto")}</th>
              <th>{t("Phone", "Teléfono")}</th>
              <th style={{ textAlign: "center" }}>{t("Intertienda", "Intertienda")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input value={r.name} onChange={(e) => update(i, { name: e.target.value })} placeholder={t("Account name", "Nombre de cuenta")} style={{ minWidth: 150 }} /></td>
                <td><input value={r.contact} onChange={(e) => update(i, { contact: e.target.value })} placeholder={t("Contact name", "Contacto")} /></td>
                <td><input value={r.phone} onChange={(e) => update(i, { phone: e.target.value })} placeholder={t("Phone", "Teléfono")} /></td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={r.intertienda} onChange={(e) => update(i, { intertienda: e.target.checked })} aria-label={t("Intertienda branch account", "Cuenta de sucursal Intertienda")} />
                </td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => remove(i)} title={t("Remove", "Quitar")}>✕</button></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="hint" style={{ padding: 12 }}>{t("No saved accounts yet — add one, or save one from an order.", "Aún no hay cuentas — agregue una o guárdela desde una orden.")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button className="btn btn-ghost" onClick={add}>+ {t("Add account", "Agregar cuenta")}</button>
        <button className="btn btn-primary" onClick={commit} disabled={!dirty}>{t("Save changes", "Guardar cambios")}</button>
        {dirty && <button className="btn btn-ghost btn-sm" onClick={reset}>{t("Discard", "Descartar")}</button>}
        {dirty && <span className="hint">{t("Unsaved changes", "Cambios sin guardar")}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Order types + their field rules. Each type has an editable name, a
// store-to-store flag (hides the external-customer fields), and a document-
// reference requirement. Edits are staged locally and written on Save.
// ---------------------------------------------------------------------------
function OrderTypesRulesEditor({
  settings, deliveries, save, t,
}: {
  settings: Settings;
  deliveries: Delivery[];
  save: (patch: Partial<Settings>, msg: string) => void;
  t: (en: string, es: string) => string;
}) {
  type Row = { name: string; storeToStore: boolean; docRef: OrderTypeRule["docRef"]; homeIsDestination: boolean };
  const build = (): Row[] =>
    settings.order_types.map((name) => {
      const r = settings.order_type_rules?.[name];
      return { name, storeToStore: r?.storeToStore ?? false, docRef: r?.docRef ?? "invoice", homeIsDestination: r?.homeIsDestination ?? false };
    });
  const [rows, setRows] = useState<Row[]>(build);
  const [dirty, setDirty] = useState(false);

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deliveries) if (d.order_type) m.set(d.order_type, (m.get(d.order_type) ?? 0) + 1);
    return m;
  }, [deliveries]);

  const update = (i: number, patch: Partial<Row>) => { setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); setDirty(true); };
  const add = () => { setRows((rs) => [...rs, { name: "", storeToStore: false, docRef: "invoice", homeIsDestination: false }]); setDirty(true); };
  const remove = (i: number) => { setRows((rs) => rs.filter((_, idx) => idx !== i)); setDirty(true); };
  const reset = () => { setRows(build()); setDirty(false); };

  const commit = () => {
    const names: string[] = [];
    const rules: Record<string, OrderTypeRule> = {};
    for (const r of rows) {
      const name = r.name.trim();
      if (!name || names.includes(name)) continue; // skip blanks + duplicates
      names.push(name);
      rules[name] = { storeToStore: r.storeToStore, docRef: r.docRef, homeIsDestination: r.homeIsDestination };
    }
    if (!names.length) return;
    save({ order_types: names, order_type_rules: rules }, t("Order types saved", "Tipos de orden guardados"));
    setDirty(false);
  };

  return (
    <div className="card">
      <h2>🏷 {t("Order types & rules", "Tipos de orden y reglas")}</h2>
      <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        {t(
          "Rename types and set what each one requires. “Store-to-store” means a branch-to-branch move — the destination is another store and no customer contact/phone is collected. The document reference sets which paperwork is required.",
          "Renombre los tipos y defina qué requiere cada uno. “Entre tiendas” es un movimiento sucursal a sucursal — el destino es otra tienda y no se pide contacto/teléfono del cliente. La referencia de documento define qué papeleo se requiere.",
        )}
      </p>
      <div className="tbl-scroll" style={{ border: "none" }}>
        <table className="orders" style={{ minWidth: 780 }}>
          <thead>
            <tr>
              <th>{t("Name", "Nombre")}</th>
              <th style={{ textAlign: "center" }}>{t("Store-to-store", "Entre tiendas")}</th>
              <th style={{ textAlign: "center" }} title={t("The rep's own store is the destination (receiving); Sold From is chosen.", "La tienda del vendedor es el destino (recibe); Vendido Desde se elige.")}>{t("Rep store = dest.", "Tienda = destino")}</th>
              <th>{t("Document reference", "Referencia de documento")}</th>
              <th style={{ textAlign: "center" }}>{t("In use", "En uso")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input value={r.name} onChange={(e) => update(i, { name: e.target.value })} placeholder={t("Type name", "Nombre del tipo")} style={{ minWidth: 150 }} /></td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={r.storeToStore} onChange={(e) => update(i, { storeToStore: e.target.checked })} aria-label={t("Store-to-store", "Entre tiendas")} />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={r.homeIsDestination} onChange={(e) => update(i, { homeIsDestination: e.target.checked })} aria-label={t("Rep store is destination", "Tienda del vendedor es destino")} />
                </td>
                <td>
                  <select value={r.docRef} onChange={(e) => update(i, { docRef: e.target.value as OrderTypeRule["docRef"] })} style={{ width: "auto" }}>
                    <option value="invoice">{t("Invoice # required", "Factura # requerida")}</option>
                    <option value="any">{t("Any one of PO# / SO# / Invoice#", "Cualquiera de PO# / SO# / Factura #")}</option>
                    <option value="po">{t("PO # required", "PO # requerido")}</option>
                    <option value="none">{t("No document required", "Sin documento requerido")}</option>
                    <option value="estimate">{t("Estimate # (single field)", "Estimación # (campo único)")}</option>
                  </select>
                </td>
                <td style={{ textAlign: "center" }}>{usage.get(r.name.trim()) ?? 0}</td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => remove(i)} title={t("Remove", "Quitar")}>✕</button></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="hint" style={{ padding: 12 }}>{t("No order types — add one below.", "Sin tipos de orden — agregue uno abajo.")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button className="btn btn-ghost" onClick={add}>+ {t("Add type", "Agregar tipo")}</button>
        <button className="btn btn-primary" onClick={commit} disabled={!dirty}>{t("Save changes", "Guardar cambios")}</button>
        {dirty && <button className="btn btn-ghost btn-sm" onClick={reset}>{t("Discard", "Descartar")}</button>}
        {dirty && <span className="hint">{t("Unsaved changes", "Cambios sin guardar")}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Editable table of named locations, with in-place edit + usage-aware delete. */
function LocationTable({
  title, blurb, items, usageField, deliveries, onChange, autoApprove, t,
}: {
  title: string;
  blurb: string;
  items: NamedLocation[];
  usageField: "pickup_name" | "delivery_name" | "store";
  deliveries: Delivery[];
  /** Stores only: expose the "auto-approve orders" per-location toggle. */
  autoApprove?: boolean;
  onChange: (v: NamedLocation[]) => void;
  t: (en: string, es: string) => string;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<NamedLocation>({ name: "", address: "" });
  const [adding, setAdding] = useState(false);
  const confirmAction = useConfirm();

  // How many orders reference each entry — so deleting isn't a blind act.
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deliveries) {
      const v = d[usageField];
      if (v) m.set(v, (m.get(v) ?? 0) + 1);
    }
    return m;
  }, [deliveries, usageField]);

  const startAdd = () => { setDraft({ name: "", address: "" }); setEditing(null); setAdding(true); };
  const startEdit = (i: number) => { setDraft({ ...items[i] }); setAdding(false); setEditing(i); };
  const cancel = () => { setEditing(null); setAdding(false); };

  const commit = async () => {
    const name = draft.name.trim();
    if (!name) return;
    const clash = items.some((x, i) => x.name.toLowerCase() === name.toLowerCase() && i !== editing);
    if (clash) { await confirmAction(t(`"${name}" already exists.`, `"${name}" ya existe.`), { alertOnly: true }); return; }
    const next = [...items];
    const rec: NamedLocation = { name, address: draft.address.trim() };
    if (autoApprove) rec.auto_approve = !!draft.auto_approve;
    // Keep the verified pin only if the address itself didn't change; editing
    // the address requires a fresh verify.
    const prev = editing != null ? items[editing] : undefined;
    if (prev && prev.address === rec.address && prev.lat != null && prev.lng != null) {
      rec.lat = prev.lat; rec.lng = prev.lng;
    }
    if (adding) next.push(rec);
    else if (editing != null) next[editing] = rec;
    onChange(next);
    cancel();
  };

  const remove = async (i: number) => {
    const it = items[i];
    const used = usage.get(it.name) ?? 0;
    const msg = used
      ? t(
          `"${it.name}" is used by ${used} order(s). Those orders keep the address already saved on them, but it won't be offered on new orders. Delete it?`,
          `"${it.name}" se usa en ${used} orden(es). Esas órdenes conservan la dirección ya guardada, pero no se ofrecerá en órdenes nuevas. ¿Eliminar?`,
        )
      : t(`Delete "${it.name}"?`, `¿Eliminar "${it.name}"?`);
    if (!(await confirmAction(msg, { danger: true, confirmLabel: t("Delete", "Eliminar") }))) return;
    onChange(items.filter((_, x) => x !== i));
  };

  const Form = (
    <div className="data-form">
      <div className="grid g2">
        <div className="field">
          <label>{t("Name", "Nombre")}</label>
          <input value={draft.name} autoFocus placeholder={t("e.g. Rio Supply Yard", "ej. Patio Rio Supply")}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <AddressInput
          label={t("Address", "Dirección")}
          value={draft.address}
          onChange={(v) => setDraft({ ...draft, address: v })}
          placeholder={t("Search an address…", "Busca una dirección…")}
        />
      </div>
      {autoApprove && (
        <label className="perm-opt" style={{ marginTop: 10, maxWidth: 520 }}>
          <input
            type="checkbox"
            checked={!!draft.auto_approve}
            onChange={(e) => setDraft({ ...draft, auto_approve: e.target.checked })}
          />
          <span>
            <b>{t("Auto-approve orders (no admin approval)", "Auto-aprobar órdenes (sin aprobación)")}</b>
            <span className="hint" style={{ display: "block" }}>
              {t(
                "Orders sold from this store skip manager approval and are created already Approved.",
                "Las órdenes vendidas desde esta tienda se crean ya Aprobadas, sin aprobación del gerente.",
              )}
            </span>
          </span>
        </label>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="btn btn-ghost btn-sm" onClick={cancel}>{t("Cancel", "Cancelar")}</button>
        <button className="btn btn-primary btn-sm" onClick={commit} disabled={!draft.name.trim()}>{t("Save", "Guardar")}</button>
      </div>
    </div>
  );

  return (
    <div className="card">
      <h2>{title} <span className="count-tag">{items.length}</span></h2>
      <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>{blurb}</p>

      {items.length === 0 && !adding && <div className="empty">{t("Nothing saved yet.", "Nada guardado aún.")}</div>}

      <div className="loc-list">
        {items.map((it, i) =>
          editing === i ? (
            <div key={i}>{Form}</div>
          ) : (
            <div className="loc-item" key={i}>
              <div>
                <b>{it.name}</b>
                <span className="loc-addr">{it.address || t("(no address)", "(sin dirección)")}</span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flex: "0 0 auto" }}>
                {autoApprove && it.auto_approve && (
                  <span className="sema" style={{ background: "var(--green)", color: "#fff" }} title={t("Orders skip approval", "Órdenes sin aprobación")}>
                    ✓ {t("Auto-approve", "Auto-aprobar")}
                  </span>
                )}
                {(usage.get(it.name) ?? 0) > 0 && (
                  <span className="sema" style={{ background: "var(--gray)", color: "#fff" }}>
                    {usage.get(it.name)} {t("used", "usos")}
                  </span>
                )}
                <VerifyAddress
                  address={it.address}
                  confirmed={it.lat != null && it.lng != null ? { lat: it.lat, lng: it.lng } : null}
                  onConfirm={(coords) => {
                    const next = [...items];
                    next[i] = { ...items[i], lat: coords.lat, lng: coords.lng };
                    onChange(next);
                  }}
                  t={t}
                />
                <button className="btn btn-ghost btn-sm" onClick={() => startEdit(i)}>{t("Edit", "Editar")}</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(i)}>✕</button>
              </div>
            </div>
          ),
        )}
      </div>

      {adding ? Form : (
        <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={startAdd}>
          + {t("Add", "Agregar")}
        </button>
      )}
    </div>
  );
}

/** "Verify" a saved address: geocode it, confirm exactly where it lands, and
 * SAVE the pin. Once confirmed it shows a persistent "✓ Verified" badge (green)
 * that links to the pin; it stays verified until the address is edited. */
function VerifyAddress({
  address, confirmed, onConfirm, t,
}: {
  address: string;
  confirmed: { lat: number; lng: number } | null;
  onConfirm: (coords: { lat: number; lng: number }) => void;
  t: (en: string, es: string) => string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "notfound">("idle");
  const verify = async () => {
    if (!address.trim()) return;
    setState("loading");
    try {
      const res = await fetch("/api/geocode-point", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!res.ok) { setState("notfound"); return; }
      const p = await res.json();
      if (typeof p?.lat === "number" && typeof p?.lng === "number") { onConfirm({ lat: p.lat, lng: p.lng }); setState("idle"); }
      else setState("notfound");
    } catch { setState("notfound"); }
  };
  if (!address.trim()) return null;
  // Already verified → persistent green badge that links to the saved pin.
  if (confirmed) {
    return (
      <a className="sema" style={{ background: "var(--green)", color: "#fff", textDecoration: "none" }}
        href={`https://www.google.com/maps/search/?api=1&query=${confirmed.lat},${confirmed.lng}`}
        target="_blank" rel="noopener noreferrer"
        title={t("Verified — click to view the saved pin. Edit the address to re-verify.", "Verificada — clic para ver el pin guardado. Edita la dirección para volver a verificar.")}>
        ✓ {t("Verified", "Verificada")}
      </a>
    );
  }
  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={verify} disabled={state === "loading"}
        title={t("Check where this address lands, then lock in the pin", "Verifica dónde cae esta dirección y fija el pin")}>
        📍 {state === "loading" ? "…" : t("Verify", "Verificar")}
      </button>
      {state === "notfound" && (
        <span className="sema" style={{ background: "var(--red)", color: "#fff" }}
          title={t("Couldn't place this address — make it more complete (street, city, state, ZIP).", "No se pudo ubicar — hágala más completa (calle, ciudad, estado, ZIP).")}>
          ✗ {t("Not found", "No encontrada")}
        </span>
      )}
    </>
  );
}
