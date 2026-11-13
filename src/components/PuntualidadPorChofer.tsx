"use client";

import { useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { BUSINESS_TZ } from "@/lib/utils";
import { puntualidadPorChofer, rangoValido, DIAS_MAX_DEL_RANGO, type FilaDePuntualidad } from "@/lib/puntualidad";
import type { Delivery, OrderEvent, Profile } from "@/lib/types";
import { TablaEstandar } from "@/components/TablaEstandar";

/**
 * «Puntualidad por chofer» (D-414) — en el Panel, bajo «KPIs de choferes y flota», con el rango del Panel.
 *
 * El orden es el de la honestidad (D-328): primero de cuántas entregas hay HORA REAL y de dónde sale (GPS / toque del
 * propio chofer), y cuántas no la tienen y por qué; solo después el % a tiempo y el retraso. Se calcula al pulsar, no
 * al abrir el Panel: lee posiciones GPS y paradas de todo el rango, y eso no se hace en cada visita.
 *
 * Con base, todo sale de `GET /api/puntualidad` (solo lectura, con la sesión). En el demo no hay base: se calcula aquí,
 * con la MISMA función (`puntualidadPorChofer`) y lo que el demo tiene en memoria — sin planes publicados ni GPS, así
 * que esas columnas salen «—», y la pantalla lo dice.
 */

const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

type Respuesta = { filas: FilaDePuntualidad[]; planesPublicados: number | null; rastroCortado: boolean; alcance?: string };

export function PuntualidadPorChofer({ desde, hasta, entregasDelPanel, eventos, usuarios }: {
  desde: string; hasta: string;
  /** Las del Panel, ya acotadas a las tiendas de quien mira (D-396). Solo se usan en el demo. */
  entregasDelPanel: readonly Delivery[]; eventos: readonly OrderEvent[]; usuarios: readonly Pick<Profile, "id" | "full_name" | "role">[];
}) {
  const { t } = usePrefs();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<Respuesta | null>(null);
  // Cambiar el rango deja viejo lo calculado: se borra, y se vuelve a pulsar.
  useEffect(() => { setR(null); setError(null); }, [desde, hasta]);

  const calcula = async () => {
    setOcupado(true); setError(null);
    try {
      if (SIN_BASE) {
        setR({
          filas: puntualidadPorChofer({
            entregas: entregasDelPanel.filter((d) => !!d.delivery_date && d.delivery_date >= desde && d.delivery_date <= hasta),
            choferes: usuarios.filter((u) => u.role === "driver"), eventos, paradas: [], posiciones: null, zona: BUSINESS_TZ,
          }),
          planesPublicados: null, rastroCortado: false,
        });
      } else {
        const res = await fetch(`/api/puntualidad?from=${encodeURIComponent(desde)}&to=${encodeURIComponent(hasta)}`);
        const b = await res.json().catch(() => ({}));
        if (!res.ok || !b.ok) setError(String(b.error ?? res.status)); else setR(b as Respuesta);
      }
    } catch { setError(t("Network error.", "Error de red.")); }
    setOcupado(false);
  };

  const rangoOk = rangoValido(desde, hasta);
  const filas = r?.filas ?? [];
  const total = (k: (f: FilaDePuntualidad) => number) => filas.reduce((s, f) => s + k(f), 0);
  const medidas = total((f) => f.medidas), aTiempo = total((f) => f.aTiempo);
  const min = (n: number | null) => (n == null ? "—" : n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n}m`);

  return (
    <div className="card" data-puntualidad>
      <h2>⏱ {t("On-time by driver (delivery window)", "Puntualidad por chofer (ventana de entrega)")}</h2>
      <p className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
        {t(
          "On time = the real time is not past the END of the order's window. Real time: the GPS arrival saved for the published route plan; if there is none, the driver's own “delivered” tap. A delivery marked by someone else doesn't count (it says when the order was closed, not where the truck was). The “On-time” column above measures something else: delivered by the end of the window or the day, whoever marked it.",
          "A tiempo = la hora real no pasa del FIN de la ventana de la orden. Hora real: la llegada por GPS guardada en el plan de ruta publicado; si no hay, el toque «entregado» del propio chofer. Una entrega marcada por otra persona no cuenta (dice cuándo se cerró la orden, no dónde estaba el camión). La columna «A tiempo» de arriba mide otra cosa: entregada antes del fin de la ventana o del día, la marcara quien la marcara.",
        )}
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary btn-sm" data-calcular-puntualidad disabled={ocupado || !rangoOk} onClick={() => void calcula()}>
          {ocupado ? t("Calculating…", "Calculando…") : t("Calculate for this range", "Calcular para este rango")}
        </button>
        {!rangoOk && <span className="hint" style={{ margin: 0 }}>{t(`Pick a range of at most ${DIAS_MAX_DEL_RANGO} days.`, `Elija un rango de ${DIAS_MAX_DEL_RANGO} días como mucho.`)}</span>}
        {SIN_BASE && <span className="hint" style={{ margin: 0 }}>{t("Demo: no published plans or GPS here, so only the driver's tap counts.", "Demo: aquí no hay planes publicados ni GPS, así que solo cuenta el toque del chofer.")}</span>}
      </div>
      {error && <div className="hint" style={{ margin: "8px 0 0", color: "var(--red)" }}>{error}</div>}
      {r && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <div className="hint" data-puntualidad-resumen style={{ margin: 0 }}>
            {t(
              `${total((f) => f.entregas)} delivered · real time for ${total((f) => f.conGPS) + total((f) => f.conToque)} (GPS ${total((f) => f.conGPS)}, driver's tap ${total((f) => f.conToque)}) · no real time for ${total((f) => f.sinDato.la_marco_otra_persona) + total((f) => f.sinDato.sin_hora)} (marked by someone else ${total((f) => f.sinDato.la_marco_otra_persona)}, no time ${total((f) => f.sinDato.sin_hora)}) · ${medidas} with a window to judge, ${aTiempo} on time${medidas ? ` (${Math.round((aTiempo / medidas) * 100)}%)` : ""}.`,
              `${total((f) => f.entregas)} entregadas · con hora real ${total((f) => f.conGPS) + total((f) => f.conToque)} (GPS ${total((f) => f.conGPS)}, toque del chofer ${total((f) => f.conToque)}) · sin hora real ${total((f) => f.sinDato.la_marco_otra_persona) + total((f) => f.sinDato.sin_hora)} (la marcó otra persona ${total((f) => f.sinDato.la_marco_otra_persona)}, sin hora ${total((f) => f.sinDato.sin_hora)}) · ${medidas} con ventana para juzgar, ${aTiempo} a tiempo${medidas ? ` (${Math.round((aTiempo / medidas) * 100)}%)` : ""}.`,
            )}
            {r.planesPublicados != null && ` ${t(`${r.planesPublicados} published plan(s) in the range.`, `${r.planesPublicados} plan(es) publicado(s) en el rango.`)}`}
            {r.rastroCortado && ` ${t("Too many GPS positions in this range: GPS miles are not shown (a partial track would undercount). Pick a shorter range.", "Demasiadas posiciones GPS en este rango: no se dan millas por GPS (un rastro a medias contaría de menos). Elija un rango más corto.")}`}
          </div>
          {filas.length === 0 ? (
            <div className="empty">{t("No deliveries with a driver in this range.", "No hay entregas con chofer en este rango.")}</div>
          ) : (
            // Estándar de tablas (`TablaEstandar`): ▾ ⚙ mover y anchos. Las cifras son las mismas que antes.
            // La tabla es más ancha que la tarjeta: se desliza dentro de su caja (si no, la barra del ⚙ se sale).
            <div style={{ minWidth: 0, maxWidth: "100%", overflowX: "auto" }}>
            <TablaEstandar id="puntualidad-choferes" sinCaja data-tabla="puntualidad-choferes" filas={filas} claveDe={(f) => f.chofer}
              columnas={[
                { key: "chofer", en: "Driver", es: "Chofer", ancho: 160, fija: true, valor: (f) => f.chofer, celda: (f) => <strong>{f.chofer}</strong> },
                { key: "entregadas", en: "Delivered", es: "Entregadas", ancho: 110, numerico: true, valor: (f) => f.entregas },
                { key: "horareal", en: "Real time (GPS · tap)", es: "Hora real (GPS · toque)", ancho: 150, valor: (f) => f.conGPS, celda: (f) => `${f.conGPS} · ${f.conToque}`, },
                { key: "sinhora", en: "No real time", es: "Sin hora real", ancho: 130, valor: (f) => f.sinDato.la_marco_otra_persona + f.sinDato.sin_hora, celda: (f) => (
                  <span style={f.sinDato.la_marco_otra_persona + f.sinDato.sin_hora > 0 ? { color: "var(--amber-text)" } : undefined}>{f.sinDato.la_marco_otra_persona} · {f.sinDato.sin_hora}</span>
                ) },
                { key: "atiempo", en: "On time", es: "A tiempo", ancho: 170, valor: (f) => f.pctATiempo, celda: (f) => (
                  <span style={f.pctATiempo != null ? { fontWeight: 700, color: f.pctATiempo >= 90 ? "var(--green)" : "var(--amber-text)" } : undefined}
                    title={f.antesDeAbrir ? t(`${f.antesDeAbrir} before the window opened`, `${f.antesDeAbrir} antes de que abriera la ventana`) : undefined}>
                    {f.medidas ? `${f.aTiempo} / ${f.medidas} (${f.pctATiempo}%)` : "—"}{f.sinVentana ? <span className="hint" style={{ margin: 0 }}> {t(`+${f.sinVentana} no window`, `+${f.sinVentana} sin ventana`)}</span> : null}
                  </span>
                ) },
                { key: "tarde", en: "Late", es: "Tarde", ancho: 90, numerico: true, valor: (f) => (f.medidas ? f.tarde : null), celda: (f) => (
                  <span style={f.tarde ? { color: "var(--red)" } : undefined}>{f.medidas ? f.tarde : "—"}</span>
                ) },
                { key: "retraso", en: "Delay (avg · worst)", es: "Retraso (medio · peor)", ancho: 150, valor: (f) => f.retrasoMedioMin, celda: (f) => (f.retrasoMedioMin == null ? "—" : `${min(f.retrasoMedioMin)} · ${min(f.retrasoMaxMin)}`) },
                { key: "millasplan", en: "Plan miles", es: "Millas del plan", ancho: 150, valor: (f) => f.millasPlan, celda: (f) => (f.millasPlan == null ? "—" : `${f.millasPlan} mi · ${f.diasConPlan} ${t("d", "d")}`) },
                { key: "millasgps", en: "GPS miles", es: "Millas GPS", ancho: 140, valor: (f) => f.millasGPS, celda: (f) => (f.millasGPS == null ? "—" : `${f.millasGPS} mi · ${f.diasConRastro} ${t("d", "d")}`) },
              ]} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
