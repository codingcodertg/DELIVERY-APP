"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { AddressInput } from "@/components/AddressInput";
import { registroDeLugar } from "@/lib/named-location";
import { nombresEnLinea, normalizaTienda, quienPierdeLaTienda } from "@/lib/visibilidad-tienda";
import type { AccountRecord, CancelReason, Delivery, NamedLocation, OrderTypeRule, Settings } from "@/lib/types";
import { claveDesdeEtiqueta, motivosDeAnulacion, MOTIVOS_QUE_NO_SE_BORRAN } from "@/lib/cancel-reasons";
import { CUENTA_DE_MOSTRADOR, CUENTA_DE_MOSTRADOR_EN, esCuentaDeMostrador } from "@/lib/customer-type";

// ============================================================
// Data — the reusable reference lists behind the order form: pickup points,
// dropoff sites, stores and order types. Everything an admin needs to curate
// the pick-lists that sales choose from, in one place.
//
// Saved locations accumulate as reps hit "Save for next time" on an order, so
// they need somewhere to be corrected or cleaned up. That's this page.
// ============================================================

export default function DataPage() {
  const { me, settings, deliveries, users, saveSettings, notify , ensureDeliveriesSince } = useData();
  // G-16: this screen reads every order ever (per-account history / reference counts), so it
  // asks the provider for the whole history once; the provider keeps a window by default.
  useEffect(() => { void ensureDeliveriesSince(null); }, [ensureDeliveriesSince]);
  const { t } = usePrefs();

  if (!me) return null;

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
        directoryCode
        /* Renombrar una tienda NO reescribe las casillas de «Tiendas que ve» (D-315): quedarían
           apuntando a un nombre que ya no existe y esas personas dejarían de ver esas órdenes sin
           enterarse. Antes de renombrar se dice a quién le pasaría, por su nombre. */
        avisoAlRenombrar={(antes, despues) => {
          const afectados = quienPierdeLaTienda(users, antes);
          if (!afectados.length) return null;
          const lista = nombresEnLinea(afectados, t("and", "y"), (n) => t(`${n} more`, `${n} más`));
          return t(
            `${afectados.length} person(s) can only see "${antes}" orders: ${lista}. Renaming it to "${despues}" does NOT update that setting, so they will stop seeing these orders until you check the new name for each of them. Rename anyway?`,
            `${afectados.length} persona(s) tienen su visibilidad limitada a "${antes}": ${lista}. Renombrarla a "${despues}" NO actualiza ese ajuste, así que dejarán de ver estas órdenes hasta que se les marque el nombre nuevo. ¿Renombrar de todas formas?`,
          );
        }}
        t={t}
      />

      <OrderTypesRulesEditor settings={settings} deliveries={deliveries} save={save} t={t} />
      <CancelReasonsEditor settings={settings} deliveries={deliveries} save={save} t={t} />

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
  // La fila lleva la cuenta ENTERA (`resto`) además de lo que se edita. Sin eso, guardar esta
  // tabla reescribía cada cuenta con solo los campos del formulario y se llevaba por delante lo
  // que no enseña —hoy `address`, que se guarda al elegir la cuenta en una orden—. Es la misma
  // lección de D-261 con las tiendas.
  type Row = { name: string; contact: string; phone: string; intertienda: boolean; requires_approval: boolean; resto: AccountRecord };
  const build = (): Row[] =>
    (settings.accounts ?? []).map((a) => ({
      name: a.name, contact: a.contact, phone: a.phone,
      intertienda: !!a.intertienda, requires_approval: !!a.requires_approval, resto: a,
    }));
  const [rows, setRows] = useState<Row[]>(build);
  const [dirty, setDirty] = useState(false);

  const update = (i: number, patch: Partial<Row>) => { setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); setDirty(true); };
  const add = () => { setRows((rs) => [...rs, { name: "", contact: "", phone: "", intertienda: false, requires_approval: false, resto: { name: "", contact: "", phone: "" } }]); setDirty(true); };
  const remove = (i: number) => { setRows((rs) => rs.filter((_, idx) => idx !== i)); setDirty(true); };
  const reset = () => { setRows(build()); setDirty(false); };

  const commit = () => {
    const seen = new Set<string>();
    const accounts = rows
      .map((r) => ({
        ...r.resto,
        name: r.name.trim(), contact: r.contact.trim(), phone: r.phone.trim(),
        intertienda: r.intertienda, requires_approval: r.requires_approval,
        // La cuenta ya no dice si es builder (D-NEXT): todo es builder salvo la opción fija «Venta al mostrador» de la orden.
        customer_type: undefined,
      }))
      // «Venta al mostrador» es una opción fija del campo Cuenta, no una cuenta: guardada aquí chocaría con ella.
      .filter((r) => { const k = r.name.toLowerCase(); if (!r.name || seen.has(k) || esCuentaDeMostrador(r.name)) return false; seen.add(k); return true; });
    // …y se DICE: una fila que desaparece sin más parece un bug.
    const fija = rows.some((r) => esCuentaDeMostrador(r.name));
    save({ accounts }, fija
      ? t(`Accounts saved. "${CUENTA_DE_MOSTRADOR_EN}" is already a fixed option of the Account field; it isn't saved as an account.`, `Cuentas guardadas. «${CUENTA_DE_MOSTRADOR}» ya es una opción fija del campo Cuenta; no se guarda como cuenta.`)
      : t("Accounts saved", "Cuentas guardadas"));
    setDirty(false);
  };

  return (
    <div className="card">
      <h2>🏢 {t("Accounts", "Cuentas")} <span className="count-tag">{rows.length}</span></h2>
      <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        {t(
          "Picking an account on an order auto-fills its contact + phone. Flag a branch (internal) account as “Intertienda” and the order type defaults to Intertienda — otherwise Customer. Flag “Office approval” and that account’s orders always start Pending, even from a store that approves on its own. Always changeable on the order.",
          "Elegir una cuenta en una orden autocompleta su contacto + teléfono. Marque una cuenta de sucursal (interna) como “Intertienda” y el tipo de orden será Intertienda por defecto — de lo contrario Customer. Marque “Aprobación de oficina” y las órdenes de esa cuenta siempre nacen Pendientes, aunque la tienda apruebe sola. Siempre editable en la orden.",
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
              <th style={{ textAlign: "center" }}>{t("Office approval", "Aprobación de oficina")}</th>
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
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={r.requires_approval} onChange={(e) => update(i, { requires_approval: e.target.checked })}
                    aria-label={t("This account always needs office approval", "Esta cuenta siempre requiere aprobación de oficina")} />
                </td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => remove(i)} title={t("Remove", "Quitar")}>✕</button></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="hint" style={{ padding: 12 }}>{t("No saved accounts yet — add one, or save one from an order.", "Aún no hay cuentas — agregue una o guárdela desde una orden.")}</td></tr>
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
// ---------------------------------------------------------------------------

/**
 * Los motivos de anulación (122). Mismo patrón que los tipos de orden: filas, guardar, descartar.
 *
 * Lo que NO se puede tocar, y por qué: la **clave** de un motivo que ya existe. Es lo que quedó escrito
 * en las órdenes anuladas, y renombrar la etiqueta no puede reescribir la historia — por eso la clave se
 * calcula una vez, al crear la fila, y después solo se editan las etiquetas. Y dos motivos no se borran
 * nunca: «otro», que el guard de la base nombra por su clave, y el del retraso, que escribe la barrida
 * automática.
 */
function CancelReasonsEditor({
  settings, deliveries, save, t,
}: {
  settings: Settings;
  deliveries: Delivery[];
  save: (patch: Partial<Settings>, msg: string) => void;
  t: (en: string, es: string) => string;
}) {
  const build = (): CancelReason[] => motivosDeAnulacion(settings).map((r) => ({ ...r }));
  const [rows, setRows] = useState<CancelReason[]>(build);
  const [dirty, setDirty] = useState(false);

  /** Cuántas órdenes anuladas cita cada motivo: borrar uno que se usó deja esas órdenes enseñando la
   *  clave pelada, y eso conviene verlo antes y no después. */
  const usadas = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of deliveries) if (d.canceled_reason) m.set(d.canceled_reason, (m.get(d.canceled_reason) ?? 0) + 1);
    return m;
  }, [deliveries]);

  const update = (i: number, patch: Partial<CancelReason>) => { setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); setDirty(true); };
  const add = () => { setRows((rs) => [...rs, { key: "", en: "", es: "" }]); setDirty(true); };
  const remove = (i: number) => { setRows((rs) => rs.filter((_, idx) => idx !== i)); setDirty(true); };
  const reset = () => { setRows(build()); setDirty(false); };

  const commit = () => {
    const fuera: CancelReason[] = [];
    for (const r of rows) {
      const en = r.en.trim();
      const es = r.es.trim() || en;
      if (!en && !es) continue;                                   // fila en blanco
      // La clave se calcula UNA vez. Una fila que ya la tiene la conserva pase lo que pase con su
      // etiqueta: es lo que está escrito en las órdenes ya anuladas.
      const key = r.key || claveDesdeEtiqueta(en || es, fuera.map((x) => x.key));
      if (fuera.some((x) => x.key === key)) continue;             // duplicada
      fuera.push({ key, en: en || es, es, ...(r.free_text ? { free_text: true } : {}) });
    }
    // Los que la app nombra por su clave vuelven aunque alguien los haya quitado de la tabla.
    for (const k of MOTIVOS_QUE_NO_SE_BORRAN) {
      if (!fuera.some((x) => x.key === k)) {
        const sembrado = motivosDeAnulacion({}).find((x) => x.key === k);
        if (sembrado) fuera.push({ ...sembrado });
      }
    }
    if (!fuera.length) return;
    save({ cancel_reasons: fuera }, t("Cancellation reasons saved", "Motivos de anulación guardados"));
    setDirty(false);
  };

  return (
    <div className="card">
      <h2>🚫 {t("Cancellation reasons", "Motivos de anulación")}</h2>
      <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
        {t(
          "Why an order was canceled, picked from this list. What gets saved on the order is the key, not the label — renaming a label does not rewrite what was already recorded. «Other» always asks for free text, and it cannot be removed.",
          "Por qué se anuló una orden, elegido de esta lista. En la orden se guarda la clave, no la etiqueta — renombrar una etiqueta no reescribe lo ya registrado. «Otro» siempre pide texto libre, y no se puede quitar.",
        )}
      </p>
      <div className="tbl-scroll" style={{ border: "none" }}>
        <table className="orders" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th>{t("English", "Inglés")}</th>
              <th>{t("Spanish", "Español")}</th>
              <th>{t("Key (saved on the order)", "Clave (lo que se guarda)")}</th>
              <th style={{ textAlign: "center" }}>{t("Asks why", "Pide texto")}</th>
              <th style={{ textAlign: "center" }}>{t("In use", "En uso")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key || `nueva-${i}`}>
                <td><input value={r.en} onChange={(e) => update(i, { en: e.target.value })} placeholder={t("Reason", "Motivo")} /></td>
                <td><input value={r.es} onChange={(e) => update(i, { es: e.target.value })} placeholder={t("Reason", "Motivo")} /></td>
                <td className="hint" style={{ fontFamily: "monospace" }}>{r.key || t("- on save -", "- al guardar -")}</td>
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={r.free_text === true}
                    disabled={r.key === "other"}
                    onChange={(e) => update(i, { free_text: e.target.checked })}
                    aria-label={t("Asks why", "Pide texto")}
                  />
                </td>
                <td style={{ textAlign: "center" }}>{usadas.get(r.key) ?? 0}</td>
                <td>
                  {!MOTIVOS_QUE_NO_SE_BORRAN.includes(r.key) && (
                    <button className="btn btn-ghost btn-sm" onClick={() => remove(i)} title={t("Remove", "Quitar")}>x</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
        <button className="btn btn-ghost" onClick={add}>+ {t("Add reason", "Agregar motivo")}</button>
        <button className="btn btn-primary" onClick={commit} disabled={!dirty}>{t("Save changes", "Guardar cambios")}</button>
        {dirty && <button className="btn btn-ghost btn-sm" onClick={reset}>{t("Discard", "Descartar")}</button>}
        {dirty && <span className="hint">{t("Unsaved changes", "Cambios sin guardar")}</span>}
      </div>
    </div>
  );
}

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
  title, blurb, items, usageField, deliveries, onChange, autoApprove, directoryCode, avisoAlRenombrar, t,
}: {
  title: string;
  blurb: string;
  items: NamedLocation[];
  usageField: "pickup_name" | "delivery_name" | "store";
  deliveries: Delivery[];
  /** Stores only: expose the "auto-approve orders" per-location toggle. */
  autoApprove?: boolean;
  /** Stores only: expose the company-directory code (D-261). */
  directoryCode?: boolean;
  /**
   * Tiendas: qué avisar antes de renombrar una, o `null` si no hay nada que avisar (D-315).
   *
   * Lo compone quien llama y no esta tabla, que es genérica y también pinta puntos de recolección y
   * de entrega, donde esto no aplica.
   */
  avisoAlRenombrar?: (antes: string, despues: string) => string | null;
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
    // Parte del registro anterior (D-261): hasta ahora se construía uno nuevo con nombre y
    // dirección, y editar una tienda borraba cualquier clave que este formulario no enseñara.
    const prev = editing != null ? items[editing] : undefined;
    // Renombrar deja apuntando al nombre viejo lo que se guardó con él. Se pregunta ANTES, con quién
    // se queda sin ver esas órdenes (D-315); si no hay nadie, no se pregunta nada.
    if (prev && avisoAlRenombrar && normalizaTienda(prev.name) !== normalizaTienda(name)) {
      const aviso = avisoAlRenombrar(prev.name, name);
      if (aviso && !(await confirmAction(aviso, { danger: true, confirmLabel: t("Rename", "Renombrar") }))) return;
    }
    const rec = registroDeLugar(prev, draft, { autoApprove, directoryCode });
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
      {directoryCode && (
        <div className="grid g2" style={{ marginTop: 10, maxWidth: 540 }}>
          <div className="field">
            <label>{t("Directory code", "Código directorio")}</label>
            <input
              value={draft.directory_code ?? ""}
              placeholder={t("e.g. ABC — several stores can share it", "ej. ABC — varias tiendas pueden compartirlo")}
              onChange={(e) => setDraft({ ...draft, directory_code: e.target.value })}
            />
          </div>
          <div className="field">
            <label>{t("Directory extension", "Extensión directorio")}</label>
            <input
              value={draft.directory_ext ?? ""}
              inputMode="numeric"
              placeholder={t("e.g. 100 — shown next to the store", "ej. 100 — se enseña junto a la tienda")}
              onChange={(e) => setDraft({ ...draft, directory_ext: e.target.value })}
            />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>{t("Works together with", "Trabaja junto con")}</label>
            <input
              value={draft.group ?? ""}
              placeholder={t("e.g. WEST - stores sharing this work as one team", "ej. OESTE - las tiendas con el mismo valor trabajan juntas")}
              onChange={(e) => setDraft({ ...draft, group: e.target.value })}
            />
            <div className="hint">
              {t(
                "Stores sharing this value share the warehouse queue, can sell from each other, and lend each other sales reps and drivers. They stay separate stores everywhere else. Empty = on its own. This is NOT the directory code.",
                "Las tiendas con el mismo valor comparten la cola de almacén, pueden venderse la una desde la otra y se prestan vendedores y choferes. Siguen siendo tiendas distintas en todo lo demás. Vacío = va sola. No es el código de directorio.",
              )}
            </div>
          </div>
        </div>
      )}
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
                {directoryCode && it.directory_code && (
                  <span className="hint" style={{ marginLeft: 6 }}>· {t("Directory", "Directorio")}: {it.directory_code}</span>
                )}
                {directoryCode && it.directory_ext && (
                  <span className="hint" style={{ marginLeft: 6 }}>· Ext {it.directory_ext}</span>
                )}
                {directoryCode && it.group && (
                  <span className="hint" style={{ marginLeft: 6 }}>· {t("Together", "Junto con")}: {it.group}</span>
                )}
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
