"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { DELIVERY_WINDOW_PRESETS } from "@/lib/constants";
import {
  TURNO_POR_DEFECTO, choferParaElMotor, erroresDeAjustesDeChofer, laBaseTieneAjustesDeRuta, pesosDeRuta, topeDeRetrasoMin,
  ventanasDuras,
} from "@/lib/route-settings";
import type { DriverSettings, RouteWeights, Settings } from "@/lib/types";

/**
 * Los ajustes del motor de rutas, solo para el admin (D-NEXT): los pesos, qué ventanas son duras, el tope de
 * retraso, y de cada chofer su base, su camión y su turno.
 *
 * **Todavía no cambia nada del Gestor de Rutas.** Esto guarda los datos que el motor va a necesitar; el
 * motor llega en un incremento posterior. Por eso la página sigue funcionando igual si las migraciones
 * 128 y 130 aún no están aplicadas: los pesos enseñan sus valores por defecto, y la tabla de choferes dice
 * que no está disponible en vez de romper la pantalla.
 *
 * Lo de los choferes va por `profile_id` y se lee aquí con una consulta directa, no por el `DataProvider`:
 * no hace falta que cada pantalla de Entregas cargue una tabla que solo mira Ajustes.
 */

const PESOS: { key: keyof RouteWeights; en: string; es: string }[] = [
  { key: "builder", en: "1 · Builder early (per minute until a builder is delivered)", es: "1 · Builder temprano (por minuto hasta entregar a un builder)" },
  { key: "manejo", en: "2 · Short route — per driving minute", es: "2 · Ruta corta — por minuto de manejo" },
  { key: "millas", en: "2 · Short route — per mile", es: "2 · Ruta corta — por milla" },
  { key: "tarde", en: "3 · Wide windows (per minute late)", es: "3 · Ventanas anchas (por minuto tarde)" },
  { key: "balance", en: "4 · Balance between drivers (per minute of difference)", es: "4 · Balance entre choferes (por minuto de diferencia)" },
];

type Fila = Pick<DriverSettings, "base_store" | "capacity_pallets" | "shift_start" | "shift_end" | "returns_to_base" | "routable">;

const horaCorta = (h: string | null | undefined) => (h ?? "").slice(0, 5);

export function RouteEngineSettings() {
  const { settings, users, saveSettings, notify } = useData();
  const { lang, t } = usePrefs();
  const supabase = useMemo(() => createClient(), []);

  const pesos = pesosDeRuta(settings);
  const duras = ventanasDuras(settings);
  const tope = topeDeRetrasoMin(settings);
  // `settings` se lee con `select("*")`: si la clave viene, la columna existe (130). Sin ella no se deja
  // editar: guardar fallaría, y el «Guardado» de después taparía el aviso del fallo.
  const hayColumnas = laBaseTieneAjustesDeRuta(settings);

  const guardaPeso = (k: keyof RouteWeights, v: number) => {
    saveSettings({ route_weights: { ...pesos, [k]: v } } as Partial<Settings>);
    notify(t("Saved", "Guardado"));
  };
  const alternaDura = (valor: string) => {
    const next = duras.includes(valor) ? duras.filter((v) => v !== valor) : [...duras, valor];
    // En el orden de los slots, para que la lista guardada no dependa del orden en que se marcaron.
    saveSettings({ route_hard_windows: DELIVERY_WINDOW_PRESETS.map((p) => p.value).filter((v) => next.includes(v)) } as Partial<Settings>);
  };

  // ---- Choferes ----
  const choferes = useMemo(() => users.filter((u) => u.role === "driver").sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")), [users]);
  const [filas, setFilas] = useState<Record<string, Fila> | null>(null);
  const [sinTabla, setSinTabla] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from("driver_settings")
      .select("profile_id, base_store, capacity_pallets, shift_start, shift_end, returns_to_base, routable");
    if (error) { setSinTabla(error.message); setFilas({}); return; }
    setSinTabla(null);
    setFilas(Object.fromEntries(((data ?? []) as DriverSettings[]).map((f) => [f.profile_id, f])));
  }, [supabase]);
  useEffect(() => { void cargar(); }, [cargar]);

  const filaDe = (id: string): Fila => filas?.[id] ?? {
    base_store: null, capacity_pallets: null, shift_start: TURNO_POR_DEFECTO.entrada, shift_end: TURNO_POR_DEFECTO.salida,
    returns_to_base: true, routable: true,
  };
  const edita = (id: string, patch: Partial<Fila>) => setFilas((f) => ({ ...(f ?? {}), [id]: { ...filaDe(id), ...patch } }));

  const guardaChofer = async (id: string) => {
    const f = filaDe(id);
    const errores = erroresDeAjustesDeChofer(f, settings.stores ?? []);
    if (errores.length) {
      notify(errores.includes("turno") ? t("The shift must end after it starts.", "El turno tiene que acabar después de empezar.")
        : errores.includes("capacidad") ? t("Capacity must be greater than zero.", "La capacidad tiene que ser mayor que cero.")
        : t("That base is not one of the stores in Settings.", "Esa base no es una de las tiendas de Ajustes."));
      return;
    }
    setOcupado(id);
    // Con `.select`: un guardado que la política no deja pasar vuelve limpio y con cero filas, y eso no es
    // haber guardado. Quien escribe aquí es admin y puede leer la fila, así que pedirla de vuelta no choca.
    const { data, error } = await supabase.from("driver_settings")
      .upsert({ profile_id: id, ...f, base_store: (f.base_store ?? "").trim() || null }, { onConflict: "profile_id" })
      .select("profile_id");
    setOcupado(null);
    if (error || !data || data.length !== 1) { notify("Error: " + (error?.message ?? t("nothing was saved", "no se guardó nada"))); return; }
    notify(t("Saved", "Guardado"));
    await cargar();
  };

  return (
    <div className="card">
      <h2>🧭 {t("Route engine", "Motor de rutas")}</h2>
      <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
        {t(
          "What the route engine will use to plan the day. Nothing here changes the Routes Manager yet. The weights follow the dispatcher's order — builders first, then the shortest route, then wide windows, then balance — and are meant to be tuned against real days.",
          "Lo que usará el motor de rutas para planificar el día. Nada de esto cambia todavía el Gestor de Rutas. Los pesos siguen el orden del despachador —primero los builders, luego la ruta más corta, luego las ventanas anchas y por último el balance— y están para afinarse contra días reales.",
        )}
      </p>

      {!hayColumnas && (
        <div className="hint" style={{ marginBottom: 10 }}>
          {t("These are the default values. They can't be changed yet (the database update is pending).", "Estos son los valores por defecto. Todavía no se pueden cambiar (falta la actualización de la base).")}
        </div>
      )}
      <div className="grid g3">
        {PESOS.map((p) => (
          <NumeroConGuardado key={p.key} label={lang === "es" ? p.es : p.en} value={pesos[p.key]} paso="0.05" disabled={!hayColumnas} onSave={(v) => guardaPeso(p.key, v)} />
        ))}
        <NumeroConGuardado
          label={t("Latest a wide window may run (minutes)", "Retraso máximo en una ventana ancha (minutos)")}
          value={tope} paso="5" disabled={!hayColumnas}
          onSave={(v) => { saveSettings({ route_late_cap_min: Math.round(v) } as Partial<Settings>); notify(t("Saved", "Guardado")); }}
        />
      </div>

      <div className="field" style={{ marginTop: 6 }}>
        <label>{t("Hard windows — never late", "Ventanas duras — nunca se llega tarde")}</label>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {DELIVERY_WINDOW_PRESETS.map((w) => (
            <label key={w.value} className="col-opt" style={{ margin: 0 }}>
              <input type="checkbox" checked={duras.includes(w.value)} disabled={!hayColumnas} onChange={() => alternaDura(w.value)} />
              {lang === "es" ? w.es : w.en}
            </label>
          ))}
        </div>
        <div className="hint">{t("The five windows themselves don't change; this only says which ones are hard.", "Las cinco ventanas no cambian; esto solo dice cuáles son duras.")}</div>
      </div>

      <h3 style={{ marginTop: 18 }}>🚚 {t("Drivers", "Choferes")}</h3>
      {sinTabla ? (
        <div className="hint">{t("Driver settings aren't available yet (the database update is pending).", "Los ajustes de chofer todavía no están disponibles (falta la actualización de la base).")}</div>
      ) : filas === null ? (
        <div className="hint">{t("Loading…", "Cargando…")}</div>
      ) : (
        <div className="tbl-scroll" style={{ border: "none" }}>
          <table className="orders" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>{t("Driver", "Chofer")}</th>
                <th>{t("Base store", "Tienda base")}</th>
                <th>{t("Capacity (pallets)", "Capacidad (pallets)")}</th>
                <th>{t("Starts", "Entra")}</th>
                <th>{t("Ends", "Sale")}</th>
                <th style={{ textAlign: "center" }}>{t("Returns to base", "Vuelve a la base")}</th>
                <th style={{ textAlign: "center" }}>{t("Routes", "Rutea")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {choferes.map((u) => {
                const f = filaDe(u.id);
                const paraElMotor = choferParaElMotor(u, { profile_id: u.id, ...f }, settings);
                return (
                  <tr key={u.id}>
                    <td>
                      <b>{u.full_name}</b>
                      {f.routable && paraElMotor.falta.length > 0 && (
                        <div className="hint" style={{ margin: 0 }}>
                          {paraElMotor.falta.includes("base")
                            ? t("No base yet: the engine won't route them.", "Sin base todavía: el motor no le dará rutas.")
                            : t("That store has no map point in Settings.", "Esa tienda no tiene punto en el mapa en Ajustes.")}
                        </div>
                      )}
                    </td>
                    <td>
                      <select value={f.base_store ?? ""} onChange={(e) => edita(u.id, { base_store: e.target.value || null })}>
                        <option value="">{t("— none —", "— ninguna —")}</option>
                        {(settings.stores ?? []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <input type="number" min={0} step="0.5" style={{ width: 90 }} value={f.capacity_pallets ?? ""} placeholder={String(paraElMotor.capacidad)}
                        onChange={(e) => edita(u.id, { capacity_pallets: e.target.value === "" ? null : Number(e.target.value) })} />
                    </td>
                    <td><input type="time" value={horaCorta(f.shift_start)} onChange={(e) => edita(u.id, { shift_start: e.target.value })} /></td>
                    <td><input type="time" value={horaCorta(f.shift_end)} onChange={(e) => edita(u.id, { shift_end: e.target.value })} /></td>
                    <td style={{ textAlign: "center" }}><input type="checkbox" checked={f.returns_to_base} onChange={(e) => edita(u.id, { returns_to_base: e.target.checked })} /></td>
                    <td style={{ textAlign: "center" }}><input type="checkbox" checked={f.routable} onChange={(e) => edita(u.id, { routable: e.target.checked })} /></td>
                    <td><button className="btn btn-primary btn-sm" disabled={ocupado === u.id} onClick={() => void guardaChofer(u.id)}>{t("Save", "Guardar")}</button></td>
                  </tr>
                );
              })}
              {choferes.length === 0 && <tr><td colSpan={8} className="empty">{t("No drivers yet.", "Todavía no hay choferes.")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NumeroConGuardado({ label, value, paso, disabled, onSave }: { label: string; value: number; paso: string; disabled?: boolean; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  const commit = () => {
    const n = Number(v);
    if (v.trim() === "" || !Number.isFinite(n) || n < 0) { setV(String(value)); return; }
    if (n !== value) onSave(n);
  };
  return (
    <div className="field">
      <label>{label}</label>
      <input type="number" min={0} step={paso} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </div>
  );
}
