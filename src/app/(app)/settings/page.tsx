"use client";

import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import Link from "next/link";
import { DEFAULT_HELP_EMAIL, ROLE_DEFAULT_COLUMNS, ROLE_INFO, ROLE_ORDER, allDefaultPermissions, defaultPermissions, driverNames, roleLabel } from "@/lib/constants";
import { DEFAULT_COLUMNS, ORDER_COLUMNS } from "@/components/OrdersTable";
import dynamic from "next/dynamic";
import { LOCAL_CITIES_DEFAULT, filasDeLaFormula } from "@/lib/pricing";
import { textoDelRango, textoDeLaRegla } from "@/lib/fee-formula-text";
import { LOCAL_ZONE_DEFAULT, LOCAL_ZONE_LATLNG } from "@/lib/delivery-zone";
import type { Settings, UserRole } from "@/lib/types";

export default function SettingsPage() {
  const { me, users, settings, saveSettings, notify } = useData();
  const { lang, t } = usePrefs();
  if (!me) return null;

  // Settings is admin-only now — everyone else's options (language, theme,
  // teaching mode) live in their account view.
  if (me.role !== "admin") {
    return (
      <>
        <div className="page-head">
          <h2>{t("Settings", "Ajustes")}</h2>
          <Link href="/account" className="btn btn-primary btn-back-account">← {t("Back to account", "Volver a la cuenta")}</Link>
        </div>
        <div className="empty">{t("Everything you can change is in your account — language, theme, and teaching mode.", "Todo lo que puedes cambiar está en tu cuenta — idioma, tema y modo enseñanza.")}</div>
      </>
    );
  }

  // Drivers are derived from the Users list, not stored in settings.
  const drivers = driverNames(users);

  return (
    <>
      <div className="page-head">
        <h2>{t("Settings", "Ajustes")}</h2>
        <Link href="/account" className="btn btn-primary btn-back-account">← {t("Back to account", "Volver a la cuenta")}</Link>
      </div>

      <div className="card">
        <h2>{t("Workspace name", "Nombre del espacio")}</h2>
        <AppName current={settings.app_name} saveLabel={t("Save", "Guardar")} onSave={(v) => { saveSettings({ app_name: v }); notify(t("Saved", "Guardado")); }} />
      </div>

      <div className="card">
        <h2>❓ {t("Help & support", "Ayuda y soporte")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          {t(
            "Where the in-app Help button (bottom-right on every screen) sends requests.",
            "A dónde envía sus solicitudes el botón de Ayuda (abajo a la derecha en cada pantalla).",
          )}
        </p>
        <HelpEmail
          current={settings.help_email ?? ""}
          placeholder={DEFAULT_HELP_EMAIL}
          saveLabel={t("Save", "Guardar")}
          invalidMsg={t("Enter a valid email address.", "Ingrese un correo válido.")}
          onSave={(v) => { saveSettings({ help_email: v || null } as Partial<Settings>); notify(t("Saved", "Guardado")); }}
        />
        <label style={{ display: "block", marginTop: 14, marginBottom: 6, fontSize: 13, fontWeight: 600 }}>
          📞 {t("Support phone (optional)", "Teléfono de soporte (opcional)")}
        </label>
        <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
          {t("When set, the Help button shows a Call link that opens the user's phone dialer with this number.", "Cuando se define, el botón de Ayuda muestra un enlace de Llamada que abre el marcador del teléfono con este número.")}
        </p>
        <HelpPhone
          current={settings.help_phone ?? ""}
          placeholder="+1 956 555 0100"
          saveLabel={t("Save", "Guardar")}
          onSave={(v) => { saveSettings({ help_phone: v || null } as Partial<Settings>); notify(t("Saved", "Guardado")); }}
        />
      </div>

      <div className="card">
        <h2>✅ {t("Delivery proof", "Comprobante de entrega")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          {t(
            "Require drivers to capture proof (a signature or at least one material photo) before an order can be marked delivered.",
            "Exigir a los choferes capturar un comprobante (una firma o al menos una foto del material) antes de marcar una orden como entregada.",
          )}
        </p>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14 }}>
          <input
            type="checkbox"
            checked={!!settings.require_pod}
            onChange={(e) => { saveSettings({ require_pod: e.target.checked } as Partial<Settings>); notify(t("Saved", "Guardado")); }}
            style={{ width: 16, height: 16 }}
          />
          {t("Require proof of delivery", "Requerir comprobante de entrega")}
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, marginTop: 10 }}>
          <input
            type="checkbox"
            // Defaults to OFF: an admin has to deliberately ask for signatures.
            checked={settings.pod_signature_enabled === true}
            onChange={(e) => { saveSettings({ pod_signature_enabled: e.target.checked } as Partial<Settings>); notify(t("Saved", "Guardado")); }}
            style={{ width: 16, height: 16 }}
          />
          {t("Ask for the customer's signature", "Pedir la firma del cliente")}
        </label>
        <div className="hint" style={{ marginTop: 6 }}>
          {t(
            "Off (the default) means the driver taps Delivered once and it's done — recorded with the time and the GPS stamp. On, they're asked for a name and a signature.",
            "Desactivado (por omisión) el chofer toca Entregado una vez y listo — se registra con la hora y la ubicación GPS. Activado, se le pide nombre y firma.",
          )}
        </div>
        {/* The two settings interact: with signatures off, "require proof"
            can only mean a photo. Said plainly here so nobody discovers it at
            a customer's door. */}
        {settings.require_pod && settings.pod_signature_enabled !== true && (
          <div className="hint" style={{ marginTop: 6, color: "var(--amber)", fontWeight: 600 }}>
            ⚠ {t(
              "With signatures off and proof required, drivers must add a material photo before they can deliver.",
              "Con la firma desactivada y el comprobante requerido, los choferes deberán agregar una foto del material para poder entregar.",
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>⏱ {t("Duration rates", "Tarifas de duración")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          {t("Pickup and delivery durations are calculated automatically as", "Las duraciones de recolección y entrega se calculan automáticamente como")}
          <b> {t("pallets × minutes-per-pallet", "pallets × minutos-por-pallet")}</b>. {t("Set the rates here.", "Configura las tarifas aquí.")}
        </p>
        <div className="grid g2" style={{ maxWidth: 460 }}>
          <RateInput
            label={t("Pickup — minutes per pallet", "Recolección — minutos por pallet")}
            value={settings.pickup_min_per_pallet}
            onSave={(v) => { saveSettings({ pickup_min_per_pallet: v }); notify(t("Saved", "Guardado")); }}
          />
          <RateInput
            label={t("Delivery — minutes per pallet", "Entrega — minutos por pallet")}
            value={settings.delivery_min_per_pallet}
            onSave={(v) => { saveSettings({ delivery_min_per_pallet: v }); notify(t("Saved", "Guardado")); }}
          />
        </div>
        <div className="hint">{t("Example", "Ejemplo")}: 6 {t("pallets", "pallets")} → {t("pickup", "recolección")} {6 * settings.pickup_min_per_pallet} min, {t("delivery", "entrega")} {6 * settings.delivery_min_per_pallet} min.</div>
      </div>

      <div className="card">
        <h2>🚚 {t("Truck capacity", "Capacidad del camión")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          {t(
            "Pallets a truck carries per load. A route keeps stops on the truck and delivers them one after another (drop → drop); it only drives back to the pickup to reload when a load goes over this. Raise it so a truck carries several orders in one trip. Each driver can still be given their own capacity on the Routes screen.",
            "Pallets que un camión lleva por carga. Una ruta mantiene las paradas en el camión y las entrega una tras otra (parada → parada); solo regresa a la recolección a recargar cuando una carga supera esto. Súbelo para que un camión lleve varias órdenes en un viaje. Cada chofer puede tener su propia capacidad en la pantalla de Rutas.",
          )}
        </p>
        <div style={{ maxWidth: 240 }}>
          <RateInput
            label={t("Default truck capacity (pallets)", "Capacidad predeterminada (pallets)")}
            value={settings.default_truck_capacity ?? 12}
            onSave={(v) => { saveSettings({ default_truck_capacity: v || null } as Partial<Settings>); notify(t("Saved", "Guardado")); }}
          />
        </div>
      </div>

      <div className="card">
        <h2>⛽ {t("Delivery cost model", "Modelo de costos de entrega")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          {t(
            "Powers the Fuel cost and Cost/delivery KPIs on the Dashboard, derived from each order's route miles. Leave blank to hide those metrics.",
            "Alimenta los KPIs de Costo de combustible y Costo/entrega en el Panel, a partir de las millas de cada orden. Deje en blanco para ocultar esas métricas.",
          )}
        </p>
        <div className="grid g2" style={{ maxWidth: 520 }}>
          <RateInput
            label={t("Fuel price ($/gal)", "Precio combustible ($/gal)")}
            value={settings.fuel_price ?? 0}
            onSave={(v) => { saveSettings({ fuel_price: v || null } as Partial<Settings>); notify(t("Saved", "Guardado")); }}
          />
          <RateInput
            label={t("Fleet average MPG", "MPG promedio de flota")}
            value={settings.fleet_mpg ?? 0}
            onSave={(v) => { saveSettings({ fleet_mpg: v || null } as Partial<Settings>); notify(t("Saved", "Guardado")); }}
          />
          <RateInput
            label={t("Overhead per delivery ($)", "Gasto fijo por entrega ($)")}
            value={settings.cost_per_delivery ?? 0}
            onSave={(v) => { saveSettings({ cost_per_delivery: v || null } as Partial<Settings>); notify(t("Saved", "Guardado")); }}
          />
        </div>
      </div>

      <LocalZonePricing settings={settings} saveSettings={saveSettings} notify={notify} t={t} />

      <div className="card">
        <h2>📞 {t("RingCentral integration", "Integración RingCentral")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          {t(
            "These contact customers and use your RingCentral plan, so they stay OFF until you switch them on.",
            "Estas funciones contactan a los clientes y usan su plan de RingCentral, por eso permanecen APAGADAS hasta que las active.",
          )}
        </p>

        <Toggle
          label={t("Click-to-call customers (RingOut)", "Llamar a clientes (RingOut)")}
          desc={t(
            "Shows a “Call via RingCentral” button on orders. Your line rings first, then connects to the customer.",
            "Muestra un botón “Llamar por RingCentral” en las órdenes. Su línea suena primero y luego conecta con el cliente.",
          )}
          on={settings.rc_calls_enabled}
          onChange={(v) => { saveSettings({ rc_calls_enabled: v }); notify(v ? t("Calling enabled", "Llamadas activadas") : t("Calling disabled", "Llamadas desactivadas")); }}
          t={t}
        />

        <Toggle
          label={t("Automatic tracking SMS on new orders", "SMS automático de seguimiento")}
          desc={t(
            "Texts the customer their live tracking link the moment an order is created (only if it has a phone number).",
            "Envía al cliente su enlace de seguimiento en cuanto se crea la orden (solo si tiene teléfono).",
          )}
          on={settings.rc_auto_sms_enabled}
          onChange={(v) => { saveSettings({ rc_auto_sms_enabled: v }); notify(v ? t("Auto-SMS enabled", "SMS automático activado") : t("Auto-SMS disabled", "SMS automático desactivado")); }}
          t={t}
        />

        <div className="hint" style={{ marginTop: 10 }}>
          {t(
            "Manual “Send SMS” / WhatsApp buttons stay available regardless. RingCentral keys are configured in .env.local.",
            "Los botones manuales “Enviar SMS” / WhatsApp siguen disponibles. Las claves de RingCentral se configuran en .env.local.",
          )}
        </div>
      </div>

      <div className="card">
        <h2>⏰ {t("Pending-approval deadline alert", "Alerta de vencimiento de aprobación")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          {t(
            "Once it's this time of day and an order is still Pending Approval, its row turns red and an escalation notification fires — managers first, then (a bit later) the sales rep who submitted it.",
            "Una vez llegada esta hora del día, si una orden sigue Pendiente de Aprobación, su fila se pone roja y se envía una notificación — primero a los gerentes y, un poco después, al vendedor que la envió.",
          )}
        </p>
        <div className="grid g2" style={{ maxWidth: 460 }}>
          <TimeInput
            label={t("Manager cutoff", "Límite del gerente")}
            value={settings.manager_pending_cutoff ?? "16:00"}
            onSave={(v) => { saveSettings({ manager_pending_cutoff: v }); notify(t("Saved", "Guardado")); }}
          />
          <TimeInput
            label={t("Sales rep cutoff (escalation)", "Límite del vendedor (escalamiento)")}
            value={settings.sales_pending_cutoff ?? "16:15"}
            onSave={(v) => { saveSettings({ sales_pending_cutoff: v }); notify(t("Saved", "Guardado")); }}
          />
        </div>
      </div>

      <div className="card">
        <h2>🔑 {t("Role capabilities", "Capacidades por rol")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
          {t(
            "Shown on each person's Account page under “What I can do”. Defaults are pre-filled — add, remove or reword them per role.",
            "Se muestran en la página Mi cuenta de cada persona en “Lo que puedo hacer”. Los valores por defecto ya están cargados — agregue, quite o reescriba por rol.",
          )}
        </p>
        {ROLE_ORDER.map((r) => (
          <PermissionEditor
            key={r}
            role={r}
            lang={lang}
            items={settings.role_permissions?.[r] ?? defaultPermissions(r, lang)}
            isCustom={!!settings.role_permissions?.[r]?.length}
            onChange={(v) => saveSettings({ role_permissions: { ...(settings.role_permissions ?? {}), [r]: v } } as Partial<Settings>)}
            onReset={() => {
              const next = { ...(settings.role_permissions ?? {}) };
              delete next[r];
              saveSettings({ role_permissions: next } as Partial<Settings>);
              notify(t("Reset to defaults", "Restablecido"));
            }}
            t={t}
          />
        ))}
      </div>

      <div className="card">
        <h2>📋 {t("Sales orders columns", "Columnas de órdenes (Ventas)")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          {t(
            "Sales reps don't get a Columns picker of their own — this is the one fixed list everyone with that role sees.",
            "Los vendedores no tienen selector de columnas propio — esta es la lista fija que ven todos los que tienen ese rol.",
          )}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          {settings.sales_columns
            ? <button className="notif-clear" onClick={() => { saveSettings({ sales_columns: null }); notify(t("Reset to defaults", "Restablecido")); }}>{t("Reset to defaults", "Restablecer")}</button>
            : <span className="hint">{t("(defaults)", "(por defecto)")}</span>}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 2, maxWidth: 620 }}>
          {ORDER_COLUMNS.map((c) => {
            const active = settings.sales_columns ?? ROLE_DEFAULT_COLUMNS.sales ?? DEFAULT_COLUMNS;
            const checked = active.includes(c.key);
            return (
              <label key={c.key} className="col-opt">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => saveSettings({ sales_columns: checked ? active.filter((k) => k !== c.key) : [...active, c.key] })}
                />
                {lang === "es" ? c.es : c.en}
              </label>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>🗂 {t("Stores, pickup points & order types", "Tiendas, puntos de recolección y tipos")}</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {t(
            "The lists the order form pulls from — stores, saved pickup points, dropoff sites and order types — now live on the Data page, where they can be edited and removed.",
            "Las listas que usa el formulario — tiendas, puntos de recolección, sitios de entrega y tipos de orden — ahora están en la página Datos, donde se pueden editar y eliminar.",
          )}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <Link href="/data" className="btn btn-primary">🗂 {t("Open Data", "Abrir Datos")}</Link>
          <span className="hint">
            {settings.stores.length} {t("stores", "tiendas")} ·{" "}
            {(settings.pickup_locations?.length ?? 0)} {t("pickup points", "puntos de recolección")} ·{" "}
            {(settings.delivery_locations?.length ?? 0)} {t("dropoff sites", "sitios de entrega")} ·{" "}
            {settings.order_types.length} {t("order types", "tipos")}
          </span>
        </div>
      </div>

      <div className="card">
        <h2>🚚 {t("Drivers", "Choferes")}</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {t(
            "Drivers are people, so they're managed with everyone else in Users — give someone the Driver role and they'll appear in the Assigned Driver list automatically.",
            "Los choferes son personas, así que se gestionan junto con los demás en Usuarios — asigne el rol de Chofer y aparecerá automáticamente en la lista de Chofer Asignado.",
          )}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <Link href="/users" className="btn btn-primary">🛡 {t("Manage users", "Gestionar usuarios")}</Link>
          <span className="hint">
            {drivers.length
              ? `${drivers.length} ${t("driver(s)", "chofer(es)")}: ${drivers.join(", ")}`
              : t("No one has the Driver role yet.", "Nadie tiene el rol de Chofer todavía.")}
          </span>
        </div>
      </div>
    </>
  );
}

function AppName({ current, onSave, saveLabel }: { current: string; onSave: (v: string) => void; saveLabel: string }) {
  const [v, setV] = useState(current);
  return (
    <div style={{ display: "flex", gap: 8, maxWidth: 460 }}>
      <input value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn btn-primary" onClick={() => onSave(v.trim() || current)}>{saveLabel}</button>
    </div>
  );
}

/** Optional support phone shown as a Call (tel:) link on the Help button. */
function HelpPhone({
  current, placeholder, onSave, saveLabel,
}: { current: string; placeholder: string; onSave: (v: string) => void; saveLabel: string }) {
  const [v, setV] = useState(current);
  return (
    <div style={{ display: "flex", gap: 8, maxWidth: 460 }}>
      <input
        type="tel"
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSave(v.trim())}
      />
      <button className="btn btn-primary" onClick={() => onSave(v.trim())}>{saveLabel}</button>
    </div>
  );
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Help-request recipient. Blank = fall back to DEFAULT_HELP_EMAIL (shown as the
 * placeholder). Validates a real address before saving. */
function HelpEmail({
  current, placeholder, onSave, saveLabel, invalidMsg,
}: { current: string; placeholder: string; onSave: (v: string) => void; saveLabel: string; invalidMsg: string }) {
  const [v, setV] = useState(current);
  const [err, setErr] = useState("");
  const trimmed = v.trim();
  const save = () => {
    if (trimmed && !EMAIL_RE.test(trimmed)) { setErr(invalidMsg); return; }
    setErr("");
    onSave(trimmed);
  };
  return (
    <div style={{ maxWidth: 460 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="email"
          value={v}
          placeholder={placeholder}
          onChange={(e) => { setV(e.target.value); if (err) setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <button className="btn btn-primary" onClick={save}>{saveLabel}</button>
      </div>
      {err && <div className="hint" style={{ color: "var(--danger, #d64545)", marginTop: 6 }}>{err}</div>}
    </div>
  );
}

/** Per-role capability list. Starts pre-filled with the built-in defaults; the
 * first edit saves an override for that role (resettable). */
function PermissionEditor({
  role, lang, items, isCustom, onChange, onReset, t,
}: {
  role: UserRole;
  lang: "en" | "es";
  items: string[];
  isCustom: boolean;
  onChange: (v: string[]) => void;
  onReset: () => void;
  t: (en: string, es: string) => string;
}) {
  const [val, setVal] = useState("");
  const addValue = (v: string) => {
    const s = v.trim();
    if (!s || items.includes(s)) return;
    onChange([...items, s]);
  };
  const add = () => { addValue(val); setVal(""); };
  const remove = (x: string) => onChange(items.filter((i) => i !== x));
  const info = ROLE_INFO[role];
  // Known capabilities across all roles, minus ones already granted here.
  const options = allDefaultPermissions(lang).filter((o) => !items.includes(o));

  return (
    <div className="perm-block">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span className="sema" style={{ background: info.color, color: "#fff" }}>{roleLabel(role, lang)}</span>
        {isCustom
          ? <button className="notif-clear" onClick={onReset}>{t("Reset to defaults", "Restablecer")}</button>
          : <span className="hint">{t("(defaults)", "(por defecto)")}</span>}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, maxWidth: 460, flexWrap: "wrap" }}>
        {options.length > 0 && (
          <select
            defaultValue=""
            style={{ flex: 1, minWidth: 200 }}
            onChange={(e) => { if (e.target.value) { addValue(e.target.value); e.currentTarget.value = ""; } }}
          >
            <option value="">{t("Add a capability…", "Agregar una capacidad…")}</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, maxWidth: 460 }}>
        <input
          value={val}
          placeholder={t("…or type a custom one", "…o escriba una personalizada")}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn btn-ghost" onClick={add} disabled={!val.trim()}>{t("Add", "Agregar")}</button>
      </div>
      <div className="pill-list">
        {items.length === 0 && <span className="hint">{t("Nothing listed for this role.", "Nada listado para este rol.")}</span>}
        {items.map((x) => (
          <span className="pill-item" key={x}>
            ✓ {x}
            <button onClick={() => remove(x)} title={t("Remove", "Quitar")}>✕</button>
          </span>
        ))}
      </div>
    </div>
  );
}

/** On/off switch for an opt-in integration. */
function Toggle({
  label, desc, on, onChange, t,
}: {
  label: string;
  desc: string;
  on: boolean;
  onChange: (v: boolean) => void;
  t: (en: string, es: string) => string;
}) {
  return (
    <div className="setting-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
        <div className="hint" style={{ marginTop: 2 }}>{desc}</div>
      </div>
      <div className="toggle-group" style={{ flex: "0 0 auto" }}>
        <button className={"toggle-btn " + (!on ? "on" : "")} onClick={() => onChange(false)}>{t("Off", "Apagado")}</button>
        <button className={"toggle-btn " + (on ? "on" : "")} onClick={() => onChange(true)}>{t("On", "Encendido")}</button>
      </div>
    </div>
  );
}

function TimeInput({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const commit = () => { if (v && v !== value) onSave(v); else setV(value); };
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="time" value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
      />
    </div>
  );
}

// El mapa de la zona entra solo cuando se abre Ajustes (D-209): arrastra el mapa entero y esta
// pantalla no lo necesita hasta que alguien mira este bloque.
const ZoneMap = dynamic(() => import("@/components/MapView").then((m) => {
  const Zona = ({ height }: { height: number }) => (
    <m.MapView zone={LOCAL_ZONE_LATLNG} fitTo={LOCAL_ZONE_DEFAULT} height={height} />
  );
  Zona.displayName = "ZonaLocalMap";
  return Zona;
}), { ssr: false, loading: () => <div className="hint">…</div> });

function LocalZonePricing({ settings, saveSettings, notify, t }: {
  settings: Settings;
  saveSettings: (patch: Partial<Settings>) => void;
  notify: (m: string) => void;
  t: (en: string, es: string) => string;
}) {
  const cities = settings.local_cities?.length ? settings.local_cities : LOCAL_CITIES_DEFAULT;
  const [citiesText, setCitiesText] = useState(cities.join(", "));

  const saveCities = () => {
    const list = citiesText.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    saveSettings({ local_cities: list } as Partial<Settings>);
    setCitiesText(list.join(", "));
    notify(t("Saved", "Guardado"));
  };

  return (
    <div className="card">
      <h2>📍 {t("Local-zone delivery pricing", "Precios de entrega por zona local")}</h2>
      <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
        {t(
          "The delivery fee is auto-calculated from the route miles (formula below). The local city list only sets the LOCAL / NOT-LOCAL badge — a not-local delivery is flagged for manager approval.",
          "La tarifa de entrega se calcula automáticamente a partir de las millas de la ruta (fórmula abajo). La lista de ciudades locales solo define la insignia LOCAL / NO-LOCAL — una entrega no local se marca para aprobación del gerente.",
        )}
      </p>

      <div style={{ marginBottom: 14 }}>
        <div className="section-label" style={{ marginTop: 0 }}>{t("The local zone", "La zona local")}</div>
        <div className="hint" style={{ marginBottom: 8 }}>
          {t(
            "An order with a delivery pin is LOCAL when the pin falls inside this outline — the southern edge is the Rio Grande, so anything across the border is out. The city list below is only the fallback for orders with no pin.",
            "Un pedido con pin de entrega es LOCAL cuando el pin cae dentro de este contorno — el borde sur es el Río Grande, así que lo que queda al otro lado no entra. La lista de ciudades de abajo es solo el respaldo para los pedidos sin pin.",
          )}
        </div>
        <ZoneMap height={300} />
        <div className="hint" style={{ marginTop: 6 }}>
          {t(
            "The outline lives in the code (LOCAL_ZONE_DEFAULT): moving it needs a deploy, not a setting.",
            "El contorno vive en el código (LOCAL_ZONE_DEFAULT): moverlo necesita un despliegue, no un ajuste.",
          )}
        </div>
      </div>

      <div className="field">
        <label>{t("Local cities (comma-separated)", "Ciudades locales (separadas por coma)")}</label>
        <textarea rows={3} value={citiesText} onChange={(e) => setCitiesText(e.target.value)} onBlur={saveCities} />
        <div className="hint">{cities.length} {t("cities", "ciudades")}</div>
      </div>

      <div style={{ marginTop: 14, maxWidth: 260 }}>
        <RateInput
          label={t("Same-day surcharge ($)", "Recargo mismo día ($)")}
          value={Number(settings.same_day_surcharge ?? 0)}
          onSave={(v) => { saveSettings({ same_day_surcharge: v } as Partial<Settings>); notify(t("Saved", "Guardado")); }}
        />
        <div className="hint" style={{ marginTop: -4 }}>
          {t(
            "Added to the delivery fee when the delivery date is today. 0 = off.",
            "Se suma a la tarifa cuando la fecha de entrega es hoy. 0 = desactivado.",
          )}
        </div>
      </div>

      {/* La fórmula entera, para consultarla sin abrir un pedido (D-244).
          **Generada desde los umbrales y las constantes de `pricing.ts`**, no copiada: si
          alguien cambia un 120 allí, esta tabla cambia con él. Una segunda copia escrita a mano
          diría lo de antes con la firma de la app detrás, que es peor que no tenerla.
          NO es editable: la fórmula sigue viviendo en el código. */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 700 }}>{t("Delivery fee formula", "Fórmula de la tarifa de entrega")}</div>
        <div className="hint" style={{ marginTop: 2 }}>
          {t(
            "Read-only: these rules live in the code. Miles are driving miles; every result rounds to the nearest $10.",
            "Solo lectura: estas reglas viven en el código. Las millas son de recorrido y todo resultado se redondea a $10.",
          )}
        </div>
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          {/* `orders` es la clase de tabla de esta app —`tbl` no existe en el CSS y habría
              salido sin estilo—, con `tbl-resize` para que no herede el `min-width: 820px`
              que esa clase trae para las tablas de pedidos. */}
          <table className="orders tbl-resize" style={{ minWidth: 420 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>{t("Zone", "Zona")}</th>
                <th style={{ textAlign: "left" }}>{t("Distance", "Distancia")}</th>
                <th style={{ textAlign: "left" }}>{t("List", "Lista")}</th>
                <th style={{ textAlign: "left" }}>{t("Discount", "Descuento")}</th>
              </tr>
            </thead>
            <tbody>
              {filasDeLaFormula().map((f) => (
                <tr key={f.tramo}>
                  <td>{f.zona === "local" ? t("Local", "Local") : t("Not local", "No local")}</td>
                  <td>{textoDelRango(t, f.desde, f.hasta)}</td>
                  <td>{textoDeLaRegla(t, f.lista.base, f.lista.factor)}</td>
                  <td>{textoDeLaRegla(t, f.descuento.base, f.descuento.factor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          {t(
            "A not-local delivery also needs manager approval.",
            "Una entrega no local además requiere aprobación del gerente.",
          )}
        </div>
      </div>

    </div>
  );
}

function RateInput({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  const commit = () => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) { setV(String(value)); return; }
    if (n !== value) onSave(n);
  };
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number" min={0} step="0.5" value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}



