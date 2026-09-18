"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import {
  CAMPOS_DE_LA_HOJA, celdasDeTexto, columnasDeLaHoja, filaParaEnviar, filasDeLaHoja, hojaUtilizable, textoDeCelda, type CampoDeHoja, type MapaDeColumnas,
} from "@/lib/route-plan/hoja";
import type { RespuestaDeImportar } from "@/lib/route-plan/importa";
import type { Desglose } from "@/lib/route-engine";

/**
 * Importar la hoja del despachador y compararla con el plan del motor (D-NEXT).
 *
 * El fichero se lee AQUÍ, en el navegador, y no sale de él: al servidor viajan solo, por fila, los identificadores de
 * la orden, el chofer y el número de carga. No se guarda el fichero en ningún sitio.
 *
 * Esta pantalla no decide nada: qué columna es cuál, qué casa con qué y cuánto cuesta cada plan vive en
 * `src/lib/route-plan/`. Y no publica ni toca órdenes: una hoja importada es para comparar.
 */

const CAMPOS_PARA_ELEGIR: CampoDeHoja[] = ["invoice", "po", "so", "chofer", "carga", "deliveryDate"];
const NOMBRE: Record<CampoDeHoja, [string, string]> = {
  orderType: ["Order type", "Tipo de orden"], store: ["Store", "Tienda"], po: ["PO #", "PO #"], so: ["SO #", "SO #"], invoice: ["Invoice #", "Factura #"],
  inputDate: ["Input date", "Fecha de entrada"], inputTime: ["Input time", "Hora de entrada"], deliveryDate: ["Delivery date", "Fecha de entrega"],
  pickupName: ["Pickup name", "Tienda de recogida"], carga: ["Load number («Pickup Address»)", "Número de carga («Pickup Address»)"], pallets: ["Pallets", "Pallets"],
  chofer: ["Assigned driver", "Chofer asignado"], deliveryAddress: ["Delivery address", "Dirección de entrega"], ventana: ["Delivery window", "Ventana de entrega"], account: ["Account", "Cuenta"],
};
const SIN_CASAR: Record<string, [string, string]> = {
  sin_identificador: ["no invoice, PO or SO", "sin factura, PO ni SO"], no_esta_en_la_app: ["not in the app for this date", "no está en la app para esta fecha"],
  varias_ordenes: ["matches more than one order", "casa con más de una orden"], identificadores_en_conflicto: ["its numbers point to different orders", "sus números apuntan a órdenes distintas"],
  otra_fecha: ["is for another delivery date", "es de otra fecha de entrega"], repetida_en_la_hoja: ["that order is already on an earlier row", "esa orden ya está en un renglón anterior"],
};
const SIN_ASIGNAR: Record<string, [string, string]> = {
  sin_chofer: ["no driver on the sheet", "sin chofer en la hoja"], chofer_desconocido: ["its driver isn't in today's plan", "su chofer no está en el plan de hoy"],
  sin_carga: ["no load number", "sin número de carga"],
};
const RECORDADO = "rtg.hoja.columnas";

export function ComparaConLaHoja({ date, nombreDeOrden }: { date: string; nombreDeOrden: (id: string) => string }) {
  const { t, lang } = usePrefs();
  const [abierto, setAbierto] = useState(false);
  const [celdas, setCeldas] = useState<string[][] | null>(null);
  const [pegado, setPegado] = useState("");
  const [elegido, setElegido] = useState<MapaDeColumnas>({});
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<RespuestaDeImportar | null>(null);
  const es = lang === "es" ? 1 : 0;

  const reconocido = useMemo(() => (celdas?.length ? columnasDeLaHoja(celdas[0]) : null), [celdas]);
  // Lo que la persona eligió a mano manda sobre lo reconocido; y lo que eligió otra vez para esa cabecera se recuerda.
  const mapa = useMemo((): MapaDeColumnas => {
    if (!reconocido || !celdas) return {};
    let recordado: Record<string, string> = {};
    try { recordado = JSON.parse(window.localStorage.getItem(RECORDADO) ?? "{}") as Record<string, string>; } catch { /* sin memoria, sin problema */ }
    const deMemoria: MapaDeColumnas = {};
    for (const campo of CAMPOS_PARA_ELEGIR) {
      if (reconocido.mapa[campo] !== undefined) continue;
      const i = celdas[0].findIndex((h) => h.trim() !== "" && recordado[h.trim().toLowerCase()] === campo);
      if (i >= 0) deMemoria[campo] = i;
    }
    return { ...reconocido.mapa, ...deMemoria, ...elegido };
  }, [reconocido, celdas, elegido]);
  const filas = useMemo(() => (celdas ? filasDeLaHoja(celdas, mapa) : []), [celdas, mapa]);

  const carga = (nuevas: string[][]) => { setCeldas(nuevas.length ? nuevas : null); setElegido({}); setR(null); setError(nuevas.length ? null : t("The sheet is empty.", "La hoja está vacía.")); };

  const alElegirFichero = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      if (/\.xlsx$/i.test(f.name)) {
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await f.arrayBuffer());
        const ws = wb.worksheets.find((w) => w.state === "visible") ?? wb.worksheets[0];
        const nuevas: string[][] = [];
        ws?.eachRow({ includeEmpty: false }, (row) => { nuevas.push((row.values as unknown[]).slice(1).map(textoDeCelda)); });
        carga(nuevas.filter((x) => x.some((c) => c !== "")));
      } else carga(celdasDeTexto(await f.text()));
    } catch { setError(t("That file couldn't be read. Try CSV, or paste the rows.", "No se pudo leer ese fichero. Pruebe con CSV, o pegue las filas.")); }
  };

  const elige = (campo: CampoDeHoja, indice: number | undefined) => {
    setElegido((m) => { const n = { ...m }; if (indice === undefined) delete n[campo]; else n[campo] = indice; return n; });
    if (indice === undefined || !celdas) return;
    try {
      const recordado = JSON.parse(window.localStorage.getItem(RECORDADO) ?? "{}") as Record<string, string>;
      recordado[celdas[0][indice].trim().toLowerCase()] = campo;
      window.localStorage.setItem(RECORDADO, JSON.stringify(recordado));
    } catch { /* sin memoria, sin problema */ }
  };

  const compara = async () => {
    setOcupado(true); setError(null); setR(null);
    try {
      const res = await fetch("/api/route-plan/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, filas: filas.map(filaParaEnviar) }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok || !b.ok) setError(b.error === "NO_PLAN" ? t("Plan the day first: the sheet is compared against the engine's plan.", "Planifique el día primero: la hoja se compara contra el plan del motor.") : String(b.error ?? res.status));
      else setR(b as RespuestaDeImportar);
    } catch { setError(t("Network error.", "Error de red.")); }
    setOcupado(false);
  };

  const signo = (n: number) => `${n > 0 ? "+" : ""}${n}`;
  const terminos: [keyof Desglose, string][] = [["builder", t("Builder minutes", "Minutos-builder")], ["manejoMin", t("Driving (min)", "Manejo (min)")], ["millas", t("Miles", "Millas")], ["tardeMin", t("Late (min)", "Tarde (min)")], ["balanceMin", t("Balance (min)", "Balance (min)")]];
  const nombreDeChofer = (id: string | null) => r?.choferes.find((c) => c.id === id)?.nombre ?? "—";

  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAbierto((a) => !a)}>{abierto ? "▾" : "▸"} {t("Compare with the dispatcher's sheet", "Comparar con la hoja del despachador")}</button>
      {abierto && (
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          <div className="hint" style={{ margin: 0 }}>
            {t("The file is read in your browser and is not stored. Importing never assigns orders or notifies anyone.", "El fichero se lee en su navegador y no se guarda. Importar nunca asigna órdenes ni avisa a nadie.")}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={(e) => void alElegirFichero(e)} />
            <span className="hint" style={{ margin: 0 }}>{t("or paste the rows (with the header):", "o pegue las filas (con la cabecera):")}</span>
          </div>
          <textarea rows={3} value={pegado} onChange={(e) => setPegado(e.target.value)} placeholder={t("Paste from Excel here", "Pegue aquí desde Excel")} />
          <div><button type="button" className="btn btn-ghost btn-sm" disabled={!pegado.trim()} onClick={() => carga(celdasDeTexto(pegado))}>{t("Read pasted rows", "Leer lo pegado")}</button></div>

          {reconocido && celdas && (
            <div style={{ display: "grid", gap: 6 }}>
              <div>
                {t(`${filas.length} row(s) read.`, `${filas.length} fila(s) leídas.`)}{" "}
                {t(`Columns recognized: ${CAMPOS_DE_LA_HOJA.length - reconocido.faltan.length} of ${CAMPOS_DE_LA_HOJA.length}.`, `Columnas reconocidas: ${CAMPOS_DE_LA_HOJA.length - reconocido.faltan.length} de ${CAMPOS_DE_LA_HOJA.length}.`)}
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {CAMPOS_PARA_ELEGIR.map((campo) => (
                  <label key={campo} className="hint" style={{ margin: 0, display: "grid", gap: 2 }}>
                    {NOMBRE[campo][es]}
                    <select value={mapa[campo] ?? ""} onChange={(e) => elige(campo, e.target.value === "" ? undefined : Number(e.target.value))} style={{ width: "auto", padding: "4px 6px", fontSize: 12 }}>
                      <option value="">{t("— not in the sheet —", "— no está en la hoja —")}</option>
                      {celdas[0].map((h, i) => (h.trim() ? <option key={i} value={i}>{h}</option> : null))}
                    </select>
                  </label>
                ))}
              </div>
              {!hojaUtilizable(mapa) && <div className="hint" style={{ margin: 0, color: "var(--red)" }}>{t("To compare, the sheet needs an invoice, PO or SO column, the driver, and the load number.", "Para comparar, la hoja necesita una columna de factura, PO o SO, el chofer y el número de carga.")}</div>}
              <div><button type="button" className="btn btn-primary btn-sm" disabled={ocupado || !hojaUtilizable(mapa) || filas.length === 0} onClick={() => void compara()}>{ocupado ? t("Comparing…", "Comparando…") : t("Compare", "Comparar")}</button></div>
            </div>
          )}
          {error && <div className="hint" style={{ margin: 0, color: "var(--red)" }}>{error}</div>}

          {r && (
            <div style={{ display: "grid", gap: 8 }}>
              <div>
                <b>{t(`${r.casadas} row(s) matched an order.`, `${r.casadas} fila(s) casaron con una orden.`)}</b>{" "}
                {t(`Same driver as the engine: ${r.comparacion.cuenta.mismoChofer} of ${r.comparacion.cuenta.comparadas}. Same load position: ${r.comparacion.cuenta.mismaCarga}.`,
                   `Mismo chofer que el motor: ${r.comparacion.cuenta.mismoChofer} de ${r.comparacion.cuenta.comparadas}. Misma posición de carga: ${r.comparacion.cuenta.mismaCarga}.`)}
              </div>
              <div className="hint" style={{ margin: 0 }}>
                {t("The sheet only orders pickups. The DELIVERY order on the sheet's side was chosen by the engine — the best one that pickup order allows.",
                   "La hoja solo ordena las recogidas. El orden de ENTREGAS del lado de la hoja lo puso el motor: el mejor que ese orden de recogidas permite.")}
                {r.delMotor.length > 0 && ` ${t(`${r.delMotor.length} order(s) the sheet doesn't assign were placed by the engine so both plans carry the same orders.`, `${r.delMotor.length} orden(es) que la hoja no asigna las colocó el motor, para que los dos planes lleven las mismas.`)}`}
              </div>

              <div style={{ overflowX: "auto" }}>
                <table className="orders" style={{ minWidth: 520 }}>
                  <thead><tr><th>{t("Whole plan", "Plan entero")}</th><th>{t("Sheet", "Hoja")}</th><th>{t("Engine", "Motor")}</th><th>{t("Sheet − engine", "Hoja − motor")}</th></tr></thead>
                  <tbody>
                    {terminos.map(([k, nombre]) => (
                      <tr key={k}><td>{nombre}</td><td>{r.comparacion.total.hoja[k]}</td><td>{r.comparacion.total.motor[k]}</td><td><b>{signo(r.comparacion.total.diferencia[k])}</b></td></tr>
                    ))}
                    <tr><td>{t("Rule violations", "Reglas incumplidas")}</td><td>{r.comparacion.violaciones.hoja.length}</td><td>{r.comparacion.violaciones.motor.length}</td><td /></tr>
                  </tbody>
                </table>
              </div>
              <div className="hint" style={{ margin: 0 }}>
                {r.comparacion.total.diferencia.total > 0 ? t("With the owner's weights, the engine's plan scores better.", "Con los pesos del dueño, el plan del motor puntúa mejor.")
                  : r.comparacion.total.diferencia.total < 0 ? t("With the owner's weights, the DISPATCHER's plan scores better: the dispatcher knows something the model doesn't, or a weight is off.", "Con los pesos del dueño, el plan del DESPACHADOR puntúa mejor: el despachador sabe algo que el modelo no, o hay un peso mal puesto.")
                  : t("Both plans score the same.", "Los dos planes puntúan igual.")}
              </div>

              <div style={{ overflowX: "auto" }}>
                <table className="orders" style={{ minWidth: 620 }}>
                  <thead><tr><th>{t("Driver", "Chofer")}</th><th>{t("Orders (sheet / engine)", "Órdenes (hoja / motor)")}</th><th>{t("Driving min", "Min de manejo")}</th><th>{t("Miles", "Millas")}</th><th>{t("Late min", "Min tarde")}</th><th>{t("Late stops", "Paradas tarde")}</th></tr></thead>
                  <tbody>
                    {r.comparacion.porChofer.map((c) => (
                      <tr key={c.choferId}><td>{nombreDeChofer(c.choferId)}</td><td>{c.hoja.ordenes} / {c.motor.ordenes}</td><td>{c.hoja.manejoMin} / {c.motor.manejoMin}</td><td>{c.hoja.millas} / {c.motor.millas}</td><td>{c.hoja.tardeMin} / {c.motor.tardeMin}</td><td>{c.hoja.paradasTarde} / {c.motor.paradasTarde}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {r.comparacion.ordenes.some((o) => !o.mismoChofer || o.mismaCarga === false) && (
                <div>
                  <b>{t("Where they differ", "En qué difieren")}</b>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {r.comparacion.ordenes.filter((o) => !o.mismoChofer || o.mismaCarga === false).map((o) => (
                      <li key={o.orden}>
                        <b>{nombreDeOrden(o.orden)}</b>:{" "}
                        {o.mismoChofer
                          ? t(`same driver; the sheet loads it as ${o.etiquetaHoja} (load ${o.cargaHoja} on the sheet), the engine as P${(o.cargaMotor ?? 0) + 1}.`, `mismo chofer; la hoja la carga como ${o.etiquetaHoja} (carga ${o.cargaHoja} en la hoja), el motor como P${(o.cargaMotor ?? 0) + 1}.`)
                          : t(`sheet → ${nombreDeChofer(o.choferHoja)}; engine → ${nombreDeChofer(o.choferMotor)}.`, `hoja → ${nombreDeChofer(o.choferHoja)}; motor → ${nombreDeChofer(o.choferMotor)}.`)}
                        {o.comoEnLaHoja && (
                          <span className="hint" style={{ margin: 0 }}>{" "}
                            {o.comoEnLaHoja.diferencia
                              ? t(`As on the sheet, the engine's plan would change by ${signo(o.comoEnLaHoja.diferencia.manejoMin)} min driving, ${signo(o.comoEnLaHoja.diferencia.millas)} mi, ${signo(o.comoEnLaHoja.diferencia.tardeMin)} min late.`,
                                  `Como en la hoja, el plan del motor cambiaría en ${signo(o.comoEnLaHoja.diferencia.manejoMin)} min de manejo, ${signo(o.comoEnLaHoja.diferencia.millas)} mi, ${signo(o.comoEnLaHoja.diferencia.tardeMin)} min tarde.`)
                              : t(`The engine can't put it as on the sheet: ${o.comoEnLaHoja.noPuede}.`, `El motor no puede ponerla como en la hoja: ${o.comoEnLaHoja.noPuede}.`)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(r.sinCasar.length > 0 || r.fueraDelPlan.length > 0 || r.sinAsignarEnHoja.length > 0 || r.soloEnLaApp.length > 0) && (
                <div className="hint" style={{ margin: 0, display: "grid", gap: 2 }}>
                  <b>{t("Left out of the comparison — nothing is guessed", "Fuera de la comparación — no se adivina nada")}</b>
                  {r.sinCasar.map((s) => <span key={`s${s.renglon}`}>{t(`Row ${s.renglon}`, `Renglón ${s.renglon}`)}: {SIN_CASAR[s.motivo]?.[es] ?? s.motivo}.</span>)}
                  {r.fueraDelPlan.map((s) => <span key={`f${s.renglon}`}>{t(`Row ${s.renglon}`, `Renglón ${s.renglon}`)} ({nombreDeOrden(s.ordenId)}): {t("the order isn't in the engine's plan, so it isn't scored", "la orden no está en el plan del motor, así que no se puntúa")}.</span>)}
                  {r.sinAsignarEnHoja.map((s) => <span key={`a${s.renglon}`}>{t(`Row ${s.renglon}`, `Renglón ${s.renglon}`)} ({nombreDeOrden(s.ordenId)}): {SIN_ASIGNAR[s.motivo]?.[es] ?? s.motivo} — {t("placed by the engine", "la colocó el motor")}.</span>)}
                  {r.soloEnLaApp.length > 0 && <span>{t("In the plan but not on the sheet", "En el plan pero no en la hoja")}: {r.soloEnLaApp.map(nombreDeOrden).join(", ")}.</span>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
