"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/data-provider";
import {
  getClockinEmployeeSettings,
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
import { ETIQUETAS_DE_PUESTO, PUESTO_POR_DEFECTO } from "@/lib/timetracker/tienda-y-puesto";

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

// Los textos de los puestos y el que se enseña cuando nadie lo puso viven en `tienda-y-puesto.ts`
// desde D-493: para un presencial, «tienda · puesto» es su proyecto en Time Tracker, y lo que se ve
// aquí tiene que ser exactamente lo que sale allí.
const POSITION_LABELS = ETIQUETAS_DE_PUESTO;

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
            value={s.position ?? PUESTO_POR_DEFECTO}
            disabled={busy}
            onChange={(e) => run(() => setEmployeePosition(userId, e.target.value as Position))}
          >
            {Object.keys(POSITION_LABELS).map((p) => (
              <option key={p} value={p}>{label(POSITION_LABELS, p)}</option>
            ))}
          </select>
          <div className="hint">
            {t("Groups them on the Coverage board and, for an in-house worker, it is their project in Time Tracker together with the store (they need no other). The role above is what governs what they can see.",
               "Los agrupa en el tablero de Cobertura y, para un presencial, es su proyecto en Time Tracker junto con la tienda (no necesita otro). Lo que pueden ver lo decide el rol de arriba.")}
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

      {/* El horario semanal ya NO se edita aquí (D-750; Roberto: «Why is their week schedule on permissions»; el dueño:
          «en permissions solo es permisos, esto se configura en el time tracker»): se lleva en Time Tracker › Horario.
          Aquí solo se dice cuál tiene, para no mandar a nadie a buscarlo a ciegas. */}
      <div className="hint" data-horario-en-time-tracker>
        {t("Weekly schedule: ", "Horario semanal: ")}<b>{s.default_schedule ? (s.default_schedule === "custom" ? t("custom", "personalizado") : s.default_schedule) : t("none", "ninguno")}</b>
        {" · "}{t("It is set in Time Tracker › Schedule, not here.", "Se configura en Time Tracker › Horario, no aquí.")}
      </div>

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
