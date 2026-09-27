"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { DELIVERY_WINDOW_PRESETS } from "@/lib/constants";
import { MINUTOS_POR_ORDEN_EN_BALANCE } from "@/lib/route-engine";
import {
  COLUMNAS_DE_CHOFER, COLUMNAS_OPCIONALES_DE_CHOFER, TURNO_POR_DEFECTO, choferParaElMotor, erroresDeAjustesDeChofer, laBaseTieneAjustesDeRuta,
  opcionesDeReparto, pesoDeZona, pesosDeRuta, routeWeightsAlGuardar, topeDeRetrasoMin, ventanasDuras,
} from "@/lib/route-settings";
import { alternaZona, ciudadesElegibles, claveDeZona, zonasDelChofer } from "@/lib/zonas";
import type { DriverSettings, RouteBalanceOptions, RouteWeights, Settings } from "@/lib/types";
import { leeConOpcionales } from "@/lib/columnas-opcionales";
import { alternaRequisito, anadeAlCatalogo, catalogoDeRequisitos, habilidadesDelChofer, laBaseTieneRequisitos, MAX_LARGO_DE_REQUISITO } from "@/lib/requisitos";

/**
 * Los ajustes del motor de rutas, solo para el admin (D-316): los pesos, qué ventanas son duras, el tope de
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

const PESOS: { key: Exclude<keyof RouteWeights, "zona">; en: string; es: string }[] = [
  { key: "builder", en: "1 · Builder early (per minute until a builder is delivered)", es: "1 · Builder temprano (por minuto hasta entregar a un builder)" },
  { key: "manejo", en: "2 · Short route — per driving minute", es: "2 · Ruta corta — por minuto de manejo" },
  { key: "millas", en: "2 · Short route — per mile", es: "2 · Ruta corta — por milla" },
  { key: "tarde", en: "3 · Wide windows (per minute late)", es: "3 · Ventanas anchas (por minuto tarde)" },
  { key: "balance", en: "4 · Balance between drivers (per minute of difference)", es: "4 · Balance entre choferes (por minuto de diferencia)" },
];

type Fila = Pick<DriverSettings, "base_store" | "capacity_pallets" | "shift_start" | "shift_end" | "returns_to_base" | "routable" | "features" | "preferred_zones">;

const horaCorta = (h: string | null | undefined) => (h ?? "").slice(0, 5);

export function RouteEngineSettings() {
  const { settings, users, deliveries, saveSettings, notify } = useData();
  const { lang, t } = usePrefs();
  const supabase = useMemo(() => createClient(), []);

  const pesos = pesosDeRuta(settings);
  const duras = ventanasDuras(settings);
  const tope = topeDeRetrasoMin(settings);
  // `settings` se lee con `select("*")`: si la clave viene, la columna existe (130). Sin ella no se deja
  // editar: guardar fallaría, y el «Guardado» de después taparía el aviso del fallo.
  const hayColumnas = laBaseTieneAjustesDeRuta(settings);

  const reparto = opcionesDeReparto(settings);
  // `route_weights` se guarda ENTERO: pesos y opciones de reparto viven en el mismo jsonb, y mandar solo una parte
  // borraría la otra (`routeWeightsAlGuardar`).
  const guardaPeso = (k: keyof RouteWeights, v: number) => {
    saveSettings({ route_weights: routeWeightsAlGuardar(settings, { [k]: v }) } as Partial<Settings>);
    notify(t("Saved", "Guardado"));
  };
  const guardaReparto = (cambio: RouteBalanceOptions) => {
    saveSettings({ route_weights: routeWeightsAlGuardar(settings, cambio) } as Partial<Settings>);
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
  // ¿La base ya tiene `driver_settings.features` (151)? Sin ella, la columna «Su camión tiene» no sale y no se manda.
  const [hayFeatures, setHayFeatures] = useState(false);
  // ¿Y `driver_settings.preferred_zones` (152, D-421)? Sin ella, la columna «Zonas preferidas» no sale y no se manda.
  const [hayZonas, setHayZonas] = useState(false);

  const cargar = useCallback(async () => {
    // Con `features` si la base la tiene; si no, sin ella (una columna que falta rechaza la consulta ENTERA).
    let pedidas = "";
    const { data, error } = await leeConOpcionales((columnas) => { pedidas = columnas; return supabase.from("driver_settings").select(columnas); }, COLUMNAS_DE_CHOFER, COLUMNAS_OPCIONALES_DE_CHOFER);
    if (error) { setSinTabla(error.message); setFilas({}); return; }
    setSinTabla(null);
    setHayFeatures(pedidas.split(", ").includes("features"));
    setHayZonas(pedidas.split(", ").includes("preferred_zones"));
    setFilas(Object.fromEntries(((data ?? []) as unknown as DriverSettings[]).map((f) => [f.profile_id, f])));
  }, [supabase]);
  useEffect(() => { void cargar(); }, [cargar]);

  const filaDe = (id: string): Fila => filas?.[id] ?? {
    base_store: null, capacity_pallets: null, shift_start: TURNO_POR_DEFECTO.entrada, shift_end: TURNO_POR_DEFECTO.salida,
    returns_to_base: true, routable: true,
  };
  const edita = (id: string, patch: Partial<Fila>) => setFilas((f) => ({ ...(f ?? {}), [id]: { ...filaDe(id), ...patch } }));

  // ---- Requisitos del camión (D-418, 151): el catálogo, y qué tiene cada camión ----
  const catalogo = catalogoDeRequisitos(settings);
  const hayCatalogo = laBaseTieneRequisitos(settings);
  const [nuevoRequisito, setNuevoRequisito] = useState("");
  const guardaCatalogo = (siguiente: string[]) => {
    saveSettings({ delivery_requirements: siguiente } as Partial<Settings>);
    notify(t("Saved", "Guardado"));
  };
  const anadeRequisito = () => {
    const r = anadeAlCatalogo(catalogo, nuevoRequisito);
    if (!r.ok) {
      notify(r.motivo === "repetido" ? t("That one is already in the list.", "Ese ya está en la lista.")
        : r.motivo === "largo" ? t(`At most ${MAX_LARGO_DE_REQUISITO} characters.`, `Como mucho ${MAX_LARGO_DE_REQUISITO} caracteres.`)
        : r.motivo === "lleno" ? t("The list is full.", "La lista está llena.") : t("Write a name first.", "Escriba un nombre primero."));
      return;
    }
    guardaCatalogo(r.catalogo);
    setNuevoRequisito("");
  };

  // ---- Zonas preferidas (D-421, 152): qué ciudades se ofrecen. Salen de los datos —las direcciones de las órdenes que
  // tiene la app y las de las tiendas—, más las que ya tenga guardadas algún chofer; ninguna escrita en el código.
  const ciudades = useMemo(
    () => ciudadesElegibles(deliveries, settings.stores ?? [], Object.values(filas ?? {}).flatMap((f) => zonasDelChofer(f))),
    [deliveries, settings.stores, filas],
  );
  const zona = pesoDeZona(settings);

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
          label={t("5 · Preferred zone (per delivery outside it)", "5 · Zona preferida (por entrega fuera de ella)")}
          value={zona} paso="5" disabled={!hayColumnas} onSave={(v) => guardaPeso("zona", v)} />
        <NumeroConGuardado
          label={t("Latest a wide window may run (minutes)", "Retraso máximo en una ventana ancha (minutos)")}
          value={tope} paso="5" disabled={!hayColumnas}
          onSave={(v) => { saveSettings({ route_late_cap_min: Math.round(v) } as Partial<Settings>); notify(t("Saved", "Guardado")); }}
        />
      </div>

      <div className="field" style={{ marginTop: 6 }}>
        <label>{t("Balance drivers by", "Repartir entre choferes por")}</label>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {([["tiempo", "Working time", "Tiempo de jornada"], ["ordenes", "Number of orders", "Número de órdenes"]] as const).map(([v, en, es]) => (
            <label key={v} className="col-opt" style={{ margin: 0 }}>
              <input type="radio" name="balance_por" checked={reparto.balancePor === v} disabled={!hayColumnas} onChange={() => guardaReparto({ balance_por: v })} />
              {lang === "es" ? es : en}
            </label>
          ))}
        </div>
        <label className="col-opt" style={{ margin: "8px 0 0" }}>
          <input type="checkbox" checked={reparto.usarTodos} disabled={!hayColumnas} onChange={() => guardaReparto({ usar_todos: !reparto.usarTodos })} />
          {t("Use all available drivers", "Usar todos los choferes disponibles")}
        </label>
        <div className="hint">
          {t(
            `What the balance weight evens out: minutes of each driver's day, or how many deliveries each one gets (one delivery of difference counts as ${MINUTOS_POR_ORDEN_EN_BALANCE} minutes). «Use all» gives every routed driver at least one order when there is enough work, even if it costs more driving — never by leaving an order out.`,
            `Qué iguala el peso de balance: los minutos de jornada de cada chofer, o cuántas entregas lleva cada uno (una entrega de diferencia cuenta como ${MINUTOS_POR_ORDEN_EN_BALANCE} minutos). «Usar todos» le da al menos una orden a cada chofer que rutea cuando hay trabajo para todos, aunque cueste más manejo — nunca dejando una orden fuera.`,
          )}
        </div>
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

      <div className="field" style={{ marginTop: 6 }} data-catalogo-requisitos>
        <label>{t("Truck requirements", "Requisitos del camión")}</label>
        {!hayCatalogo ? (
          <div className="hint">{t("Not available yet (the database update is pending).", "Todavía no está disponible (falta la actualización de la base).")}</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              {catalogo.map((r) => (
                <span key={r} className="sema" style={{ background: "var(--line)", color: "inherit", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {r}
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={t(`Remove ${r}`, `Quitar ${r}`)} style={{ padding: "0 4px" }}
                    onClick={() => guardaCatalogo(catalogo.filter((x) => x !== r))}>✕</button>
                </span>
              ))}
              {catalogo.length === 0 && <span className="hint" style={{ margin: 0 }}>{t("None yet.", "Ninguno todavía.")}</span>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={nuevoRequisito} maxLength={MAX_LARGO_DE_REQUISITO} placeholder={t("e.g. Liftgate", "p. ej. Liftgate")} style={{ maxWidth: 240 }}
                onChange={(e) => setNuevoRequisito(e.target.value)} onKeyDown={(e) => e.key === "Enter" && anadeRequisito()} />
              <button type="button" className="btn btn-primary btn-sm" onClick={anadeRequisito}>{t("Add", "Añadir")}</button>
            </div>
          </>
        )}
        <div className="hint">
          {t(
            "What an order can ask of the truck (liftgate, forklift, big truck, two people…). Mark on each order what it needs and, below, what each driver's truck has: Plan the day and Best fit never give an order to a driver whose truck lacks it, and they say what is missing. Removing one here switches it off everywhere.",
            "Lo que una orden puede pedirle al camión (liftgate, montacargas, camión grande, dos personas…). Marque en cada orden lo que necesita y, abajo, lo que tiene el camión de cada chofer: Planificar el día y Mejor lugar nunca le dan una orden a un chofer cuyo camión no lo tiene, y dicen qué falta. Quitar uno aquí lo apaga en todas partes.",
          )}
        </div>
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
                {hayFeatures && catalogo.length > 0 && <th>{t("Truck has", "Su camión tiene")}</th>}
                {hayZonas && <th>{t("Preferred zones", "Zonas preferidas")}</th>}
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
                    {hayFeatures && catalogo.length > 0 && (
                      <td data-camion-de={u.full_name ?? ""}>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          {catalogo.map((r) => (
                            <label key={r} className="col-opt" style={{ margin: 0, whiteSpace: "nowrap" }}>
                              <input type="checkbox" checked={habilidadesDelChofer(f, catalogo).includes(r)}
                                onChange={() => edita(u.id, { features: alternaRequisito(f.features, r, catalogo) })} />
                              {r}
                            </label>
                          ))}
                        </div>
                      </td>
                    )}
                    {hayZonas && (
                      <td data-zonas-de={u.full_name ?? ""} style={{ minWidth: 130 }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                          {zonasDelChofer(f).map((z) => (
                            <span key={z} className="sema" style={{ background: "var(--line)", color: "inherit", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                              {z}
                              <button type="button" className="btn btn-ghost btn-sm" aria-label={t(`Remove ${z}`, `Quitar ${z}`)} style={{ padding: "0 4px" }}
                                onClick={() => edita(u.id, { preferred_zones: alternaZona(f.preferred_zones, z) })}>✕</button>
                            </span>
                          ))}
                        </div>
                        <select value="" style={{ maxWidth: 130 }} aria-label={t(`Add a zone for ${u.full_name ?? ""}`, `Añadir una zona a ${u.full_name ?? ""}`)}
                          onChange={(e) => { if (e.target.value) edita(u.id, { preferred_zones: alternaZona(f.preferred_zones, e.target.value) }); }}>
                          <option value="">{t("+ zone", "+ zona")}</option>
                          {ciudades.filter((c) => !zonasDelChofer(f).some((z) => claveDeZona(z) === claveDeZona(c.nombre))).map((c) => (
                            <option key={c.nombre} value={c.nombre}>{c.nombre}{c.n ? ` (${c.n})` : ""}</option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td><button className="btn btn-primary btn-sm" disabled={ocupado === u.id} onClick={() => void guardaChofer(u.id)}>{t("Save", "Guardar")}</button></td>
                  </tr>
                );
              })}
              {choferes.length === 0 && <tr><td colSpan={8 + (hayFeatures && catalogo.length > 0 ? 1 : 0) + (hayZonas ? 1 : 0)} className="empty">{t("No drivers yet.", "Todavía no hay choferes.")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {!sinTabla && filas !== null && (
        <div className="hint" data-zonas-ayuda>
          {hayZonas
            ? t(
              "Preferred zones are the delivery cities (as in the Routes Manager's «Delivery city» column) each driver should get first. A preference, not a rule: when a driver's zone has more than fits, or another city has no driver, the engine still gives them work elsewhere, and it never leaves an order out because of a zone. Weight 5 says how much it weighs, in minutes of driving per delivery outside the zone; 0 turns it off. A driver with no zones takes anything at no extra cost.",
              "Las zonas preferidas son las ciudades de entrega (como la columna «Ciudad de entrega» del Gestor de Rutas) que cada chofer recibe primero. Preferencia, no regla: si la zona de un chofer tiene más de lo que cabe, u otra ciudad no tiene chofer, el motor le da trabajo de otra zona, y nunca deja una orden fuera por la zona. El peso 5 dice cuánto pesa, en minutos de manejo por entrega fuera de su zona; 0 lo apaga. Un chofer sin zonas lleva cualquier cosa sin coste de más.",
            )
            : t("Preferred zones per driver aren't available yet (the database update is pending).", "Las zonas preferidas por chofer todavía no están disponibles (falta la actualización de la base).")}
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
