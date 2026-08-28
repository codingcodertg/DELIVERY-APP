"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/data-provider";
import {
  getClockinEmployeeSettings,
  setEmployeeSchedule,
  setEmployeeStore,
  setEmployeePosition,
  setEmployeeRunner,
  setEmployeeVehicle,
  setEmployeeActive,
} from "@/app/timetracker/clock-in/actions/team";
import { setCustomSchedule } from "@/app/timetracker/clock-in/actions/schedule";
import type { WeekPattern } from "@/lib/clockin/schedule";
import type { Position } from "@/lib/clockin/positions";

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
// ============================================================

type Settings = {
  position: string | null;
  default_schedule: string | null;
  custom_schedule: WeekPattern | null;
  store_id: string | null;
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

  const [data, setData] = useState<{ settings: Settings | null; sites: Site[]; vehicles: Vehicle[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await getClockinEmployeeSettings(userId);
    if (!res.ok) { setErr(res.message); return; }
    setErr(null);
    setData({ settings: res.settings, sites: res.sites, vehicles: res.vehicles });
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
  if (!s) {
    return (
      <div className="hint">
        {t("No clock-in row yet — it appears as soon as the access above is saved.",
           "Todavía no tiene ficha de fichaje — aparece en cuanto se guarde el acceso de arriba.")}
      </div>
    );
  }

  const label = (o: Record<string, { en: string; es: string }>, k: string) =>
    lang === "es" ? (o[k]?.es ?? k) : (o[k]?.en ?? k);

  return (
    <div style={{ marginTop: 10 }}>
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

      {/* Runners are employees who drive a company vehicle and log stops. Managers and owners are
          not offered it, matching the crew screen this replaced. */}
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
              <b>{t("Runner", "Repartidor")}</b>
              <span className="hint" style={{ display: "block" }}>
                {t("Drives a company vehicle and logs each stop.", "Maneja un vehículo de la empresa y registra cada parada.")}
              </span>
            </span>
          </label>
          {s.is_runner && (
            <div className="field">
              <label>{t("Vehicle", "Vehículo")}</label>
              <select
                value={s.vehicle_id ?? ""}
                disabled={busy}
                onChange={(e) => run(() => setEmployeeVehicle(userId, e.target.value || null))}
              >
                <option value="">{t("None assigned", "Sin asignar")}</option>
                {data.vehicles.filter((v) => v.active || v.id === s.vehicle_id).map((v) => (
                  <option key={v.id} value={v.id}>{v.name}{v.plate ? ` · ${v.plate}` : ""}</option>
                ))}
              </select>
              {data.vehicles.length === 0 && (
                <div className="hint">{t("No vehicles yet — add them in Clock-in › Vehicles.", "Aún no hay vehículos — se agregan en Fichaje › Vehículos.")}</div>
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
