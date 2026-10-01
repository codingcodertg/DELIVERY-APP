"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/data-provider";
import {
  getClockinEmployeeSettings,
  setEmployeeSchedule,
  setEmployeeStore,
  setEmployeeExtraStores,
  setEmployeePosition,
  setEmployeeRunner,
  setEmployeeVehicle,
  setEmployeeActive,
  setEmployeeWorkerType,
  activateInTimeTracker,
} from "@/app/timetracker/clock-in/actions/team";
import { setCustomSchedule } from "@/app/timetracker/clock-in/actions/schedule";
import type { WeekPattern } from "@/lib/clockin/schedule";
import type { Position } from "@/lib/clockin/positions";
import type { MitadTimeTracker } from "@/lib/timetracker/tipo-trabajador";
import { TipoDeTrabajadorCampo } from "@/components/TipoDeTrabajadorCampo";

// ============================================================
// One person's clock-in setup, inside the hub's Users dialog (D-095).
//
// This is the Team screen's per-person half, rehomed. It is a rewrite rather than a move because
// clock-in's own controls are Tailwind components and Tailwind does not exist on this page — the
// hub renders from globals.css, and each module's stylesheet is scoped to its own layout chunk.
// The controls are the hub's (.field, .grid g2, .perm-opt); the actions behind them are still
// clock-in's, unchanged.
//
// Everything saves on change, like the rest of this dialog. There is no Save button anywhere in
// it, and adding one only here would make people wonder what the other fields did.
//
// D-455 — tres cosas que el dueño buscó aquí y no encontró:
//
//  · El TIPO DE TRABAJADOR (presencial / remoto) solo se podía elegir en Time Tracker › People.
//    Ahora es el primer campo, con el estado de las dos mitades dicho en claro
//    (TipoDeTrabajadorCampo). Sale AUNQUE no haya ficha de fichaje: es de la otra mitad.
//  · «Runner / Repartidor» no le decía a nadie que es lo que hace falta para visitar clientes y
//    tomar fotos. Se llama «Visitas y mandados (con fotos)» y lo explica. La columna es la misma
//    (`is_runner`) y la lógica de los viajes no cambia.
//  · El vehículo es OPCIONAL y lo dice: sin vehículo asignado, va en el suyo («viaje personal»).
// ============================================================

type Settings = {
  position: string | null;
  default_schedule: string | null;
  custom_schedule: WeekPattern | null;
  store_id: string | null;
  extra_store_ids: string[] | null;
  is_runner: boolean;
  vehicle_id: string | null;
  active: boolean;
};
type Site = { id: string; name: string };
type Vehicle = { id: string; name: string; plate: string | null; active: boolean };

const POSITION_LABELS: Record<string, { en: string; es: string }> = {
  office: { en: "Office", es: "Oficina" },
  sales: { en: "Sales", es: "Ventas" },
  warehouse: { en: "Warehouse", es: "Almacén" },
  manager: { en: "Manager", es: "Gerente" },
  owner: { en: "Owner", es: "Dueño" },
};

const DOW = {
  en: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  es: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"],
};

export function ClockinSettings({ userId, clockinRole }: { userId: string; clockinRole: string | null }) {
  const { lang, t } = usePrefs();
  const { notify } = useData();

  const [data, setData] = useState<{ settings: Settings | null; sites: Site[]; vehicles: Vehicle[]; timetracker: MitadTimeTracker } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await getClockinEmployeeSettings(userId);
    if (!res.ok) { setErr(res.message); return; }
    setErr(null);
    setData({ settings: res.settings, sites: res.sites, vehicles: res.vehicles, timetracker: res.timetracker });
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  // Every control funnels through here so a rejected save says so instead of silently reverting on
  // the next load — the server actions all answer { ok, message } rather than throwing.
  async function run(fn: () => Promise<{ ok: true } | { ok: false; message: string } | { ok: boolean; message?: string }>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { notify(res.message ?? t("Could not save.", "No se pudo guardar.")); return; }
    await load();
  }

  if (err) return <div className="hint" style={{ color: "var(--danger)" }}>⚠ {err}</div>;
  if (!data) return <div className="hint">{t("Loading…", "Cargando…")}</div>;

  const s = data.settings;

  // El tipo de trabajador va primero y SIEMPRE: vive en Time Tracker, no en fichaje, así que no
  // depende de que exista la ficha de fichaje de abajo.
  const tipoDeTrabajador = (
    <TipoDeTrabajadorCampo
      tt={data.timetracker}
      fichaje={s ? { active: s.active } : null}
      busy={busy}
      t={t}
      onElegir={(tipo) => run(() => setEmployeeWorkerType(userId, tipo))}
      onActivar={() => run(() => activateInTimeTracker(userId))}
    />
  );

  if (!s) {
    return (
      <div style={{ marginTop: 10 }}>
        {tipoDeTrabajador}
        <div className="hint">
          {t("No store clock-in setup yet (site, schedule, visits). A remote worker does not need one. It is created when Time Tracker access is saved — if it does not appear, uncheck and re-check Time Tracker above.",
             "Todavía no tiene ficha de fichaje en tienda (sitio, horario, visitas). Un remoto no la necesita. Se crea al guardar el acceso a Time Tracker — si no aparece, desmarca y vuelve a marcar Time Tracker arriba.")}
        </div>
      </div>
    );
  }

  const label = (o: Record<string, { en: string; es: string }>, k: string) =>
    lang === "es" ? (o[k]?.es ?? k) : (o[k]?.en ?? k);

  return (
    <div style={{ marginTop: 10 }}>
      {tipoDeTrabajador}

      <div className="grid g2">
        <div className="field">
          <label>{t("Job position", "Puesto")}</label>
          <select
            value={s.position ?? "sales"}
            disabled={busy}
            onChange={(e) => run(() => setEmployeePosition(userId, e.target.value as Position))}
          >
            {Object.keys(POSITION_LABELS).map((p) => (
              <option key={p} value={p}>{label(POSITION_LABELS, p)}</option>
            ))}
          </select>
          <div className="hint">
            {t("Groups them on the Coverage board. The role above is what governs what they can see.",
               "Los agrupa en el tablero de Cobertura. Lo que pueden ver lo decide el rol de arriba.")}
          </div>
        </div>

        <div className="field">
          <label>{t("Job site", "Sitio de trabajo")}</label>
          <select
            value={s.store_id ?? ""}
            disabled={busy}
            onChange={(e) => run(() => setEmployeeStore(userId, e.target.value || null))}
          >
            <option value="">{t("All sites", "Todos los sitios")}</option>
            {data.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
          <div className="hint">
            {t("Their geofence, and the crew a store manager can see.",
               "Su geocerca, y la gente que ve un gerente de tienda.")}
          </div>
        </div>
      </div>

      {/* Tiendas extra (D-127). Solo tiene sentido para un gerente de tienda: un admin ya lo
          ve todo y un empleado no ve a nadie, así que a esos dos el control sobra y confunde. */}
      {clockinRole === "manager" && (
        <div className="field">
          <label>{t("Other stores they can see", "Otras tiendas que puede ver")}</label>
          <div className="perm-panel">
            {data.sites.filter((site) => site.id !== s.store_id).map((site) => {
              const puesta = (s.extra_store_ids ?? []).includes(site.id);
              return (
                <label key={site.id} className="perm-opt">
                  <input
                    type="checkbox"
                    checked={puesta}
                    disabled={busy}
                    onChange={() => {
                      const actual = s.extra_store_ids ?? [];
                      const siguiente = puesta ? actual.filter((x) => x !== site.id) : [...actual, site.id];
                      run(() => setEmployeeExtraStores(userId, siguiente));
                    }}
                  />
                  {site.name}
                </label>
              );
            })}
            {data.sites.filter((site) => site.id !== s.store_id).length === 0 && (
              <div className="hint">{t("No other stores yet.", "No hay más tiendas todavía.")}</div>
            )}
          </div>
          <div className="hint">
            {t("Their own store above is always included. These are extras.",
               "Su tienda de arriba va siempre incluida. Estas son adicionales.")}
          </div>
        </div>
      )}

      <div className="field">
        <label>{t("Weekly schedule", "Horario semanal")}</label>
        <select
          value={s.default_schedule ?? ""}
          disabled={busy}
          onChange={(e) => run(() => setEmployeeSchedule(userId, e.target.value || null))}
        >
          <option value="">{t("None", "Ninguno")}</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
          <option value="custom">{t("Custom", "Personalizado")}</option>
        </select>
        <div className="hint">
          {t("Picking A, B or C lays out this week and next straight away; the daily job keeps extending it.",
             "Elegir A, B o C ya deja puesta esta semana y la siguiente; el trabajo diario la sigue extendiendo.")}
        </div>
      </div>

      {s.default_schedule === "custom" && (
        <CustomWeek
          userId={userId}
          pattern={s.custom_schedule}
          onSaved={load}
          notify={notify}
          lang={lang}
          t={t}
        />
      )}

      {/* «Visitas y mandados (con fotos)» — antes «Runner / Repartidor» (D-455). Es quien sale a
          visitar clientes o a hacer mandados y registra cada parada con foto y ubicación, en un
          vehículo de la empresa o en el suyo. Managers and owners are not offered it, matching
          the crew screen this replaced. */}
      {clockinRole === "employee" && (
        <div className="card" style={{ marginTop: 10 }}>
          <label className="perm-opt" style={{ marginBottom: s.is_runner ? 10 : 0 }}>
            <input
              type="checkbox"
              checked={s.is_runner}
              disabled={busy}
              onChange={(e) => run(() => setEmployeeRunner(userId, e.target.checked))}
            />
            <span>
              <b>{t("Field visits & errands (with photos)", "Visitas y mandados (con fotos)")}</b>
              <span className="hint" style={{ display: "block" }}>
                {t("Logs each stop with a photo and their location — in a company vehicle (odometer) or in their own (“personal trip”).",
                   "Registra cada parada con foto y ubicación; con vehículo de la empresa (odómetro) o en su propio vehículo («viaje personal»).")}
              </span>
              {/* Lo que la casilla NO es: un permiso. «Voy a salir» ya le pregunta a cualquier
                  presencial si va a visitar a un cliente y le deja tomar fotos. Decirlo evita que
                  alguien crea que sin marcarla no se pueden tomar fotos. */}
              <span className="hint" style={{ display: "block" }}>
                {t("Any in-house worker can already use “Going out” for a customer visit with photos. Check this for someone who goes out as part of the job or drives a company vehicle: their trips panel is always there and you can assign the vehicle.",
                   "Cualquier presencial ya puede usar «Voy a salir» para una visita con fotos. Márcalo para quien sale como parte de su trabajo o lleva un vehículo de la empresa: su panel de viajes sale siempre y se le puede asignar el vehículo.")}
              </span>
            </span>
          </label>
          {s.is_runner && (
            <div className="field">
              <label>{t("Company vehicle (optional)", "Vehículo de la empresa (opcional)")}</label>
              <select
                value={s.vehicle_id ?? ""}
                disabled={busy}
                onChange={(e) => run(() => setEmployeeVehicle(userId, e.target.value || null))}
              >
                <option value="">{t("No vehicle assigned = uses their own", "Sin vehículo asignado = usa el suyo")}</option>
                {data.vehicles.filter((v) => v.active || v.id === s.vehicle_id).map((v) => (
                  <option key={v.id} value={v.id}>{v.name}{v.plate ? ` · ${v.plate}` : ""}</option>
                ))}
              </select>
              {data.vehicles.length === 0 && (
                <div className="hint">{t("No company vehicles yet — add them in Time Tracker › Settings.", "Aún no hay vehículos de la empresa — se agregan en Time Tracker › Ajustes.")}</div>
              )}
            </div>
          )}
        </div>
      )}

      <label className="perm-opt" style={{ marginTop: 10 }}>
        <input
          type="checkbox"
          checked={s.active}
          disabled={busy}
          onChange={(e) => run(() => setEmployeeActive(userId, e.target.checked))}
        />
        <span>
          <b>{t("Counting time", "Contando tiempo")}</b>
          <span className="hint" style={{ display: "block" }}>
            {t("Turn off to stop their punches and reminders without touching their account or their history.",
               "Apágalo para detener sus fichajes y avisos sin tocar su cuenta ni su historial.")}
          </span>
        </span>
      </label>
    </div>
  );
}

/** The custom weekly pattern, in the hub's own controls. Saved as a whole, because a half-typed
 *  row is not a schedule — this is the one place in the dialog with a Save button. */
function CustomWeek({
  userId, pattern, onSaved, notify, lang, t,
}: {
  userId: string;
  pattern: WeekPattern | null;
  onSaved: () => Promise<void>;
  notify: (m: string) => void;
  lang: string;
  t: (en: string, es: string) => string;
}) {
  type Row = { on: boolean; start: string; end: string; lunch: number };
  const init = (): Row[] =>
    Array.from({ length: 7 }, (_, d) => {
      const p = pattern?.[String(d)];
      return p
        ? { on: true, start: p.start.slice(0, 5), end: p.end.slice(0, 5), lunch: p.lunch ?? 0 }
        : { on: false, start: "08:00", end: "16:00", lunch: 30 };
    });

  const [rows, setRows] = useState<Row[]>(init);
  const [busy, setBusy] = useState(false);
  const days = lang === "es" ? DOW.es : DOW.en;
  const set = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function save() {
    const wp: WeekPattern = {};
    for (let d = 0; d < 7; d++) {
      const r = rows[d];
      if (r.on && r.start && r.end) wp[String(d)] = { start: r.start, end: r.end, lunch: r.lunch };
    }
    if (Object.keys(wp).length === 0) {
      notify(t("Pick at least one working day.", "Elige al menos un día de trabajo."));
      return;
    }
    setBusy(true);
    const res = await setCustomSchedule(userId, wp);
    setBusy(false);
    if (!res.ok) { notify(res.message); return; }
    notify(t("Schedule saved.", "Horario guardado."));
    await onSaved();
  }

  return (
    <div className="card" style={{ marginTop: 6 }}>
      <div className="section-label" style={{ marginTop: 0 }}>{t("Custom week", "Semana personalizada")}</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
          <label className="perm-opt" style={{ width: 130, marginBottom: 0, flexShrink: 0 }}>
            <input type="checkbox" checked={r.on} onChange={(e) => set(i, { on: e.target.checked })} />
            <span>{days[i]}</span>
          </label>
          {r.on ? (
            <>
              <input type="time" value={r.start} style={{ width: 110 }} onChange={(e) => set(i, { start: e.target.value })} />
              <span className="hint">–</span>
              <input type="time" value={r.end} style={{ width: 110 }} onChange={(e) => set(i, { end: e.target.value })} />
              <select value={r.lunch} style={{ width: 120 }} onChange={(e) => set(i, { lunch: parseInt(e.target.value, 10) })}>
                <option value={0}>{t("No lunch", "Sin comida")}</option>
                {[15, 30, 45, 60, 90].map((n) => <option key={n} value={n}>{n}m 🍽️</option>)}
              </select>
            </>
          ) : (
            <span className="hint">{t("Day off", "Descanso")}</span>
          )}
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={save}>
        {busy ? "…" : t("Save the week", "Guardar la semana")}
      </button>
    </div>
  );
}
