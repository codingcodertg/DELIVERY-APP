"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { parseWindow } from "@/lib/dispatch";
import { fmtWindows } from "@/lib/utils";
import { facturaYId } from "@/lib/route-plan/etiqueta";
import {
  huecoMasCercano, huecosDeLaFila, porQueNoSuelta, textoDePrevia,
  type BarraDelGantt, type Destino, type PlanDeSoltar,
} from "@/lib/arrastre-de-paradas";
import { horaDe } from "@/lib/mejor-lugar";
import {
  anchoEstimado, anchosParaElTexto, desplazamientoParaCentrar, etiquetaQueCabe, marcasDelEje, minutoEnElCentro,
  minutoEnLaPista, porcentajeEnElEje, siguienteZoom, tramoDelHorario, vistaDelEje,
} from "@/lib/gestor/zoom-del-horario";
import type { Delivery } from "@/lib/types";

// El eje ya no es un día fijo de 07:00 a 19:00: es el tramo con paradas, con su margen, y llena el ancho (D-NEXT,
// `lib/gestor/zoom-del-horario`). ＋ / － / Ajustar cambian la escala; nada de esto toca las horas.
/** El hueco entre la columna de nombres y la pista (`gap` de `.gantt-row`). */
const HUECO_COLUMNAS_PX = 10;
/** Una barra nunca mide menos que esto (una parada sin minutos de descarga). */
const BARRA_MIN_PX = 6;
/** Por debajo de este ancho (el teléfono) no se arrastra: queda con las flechas de «Rutas» (D-417). */
const SOLO_FLECHAS = "(max-width: 760px)";
/** Píxeles que hay que mover el puntero para que una pulsación sea un arrastre y no un toque. */
const UMBRAL_PX = 5;

export interface GanttRow {
  key: string;
  title: string;
  color: string;
  orders: Delivery[];
  /** Cada parada en su hora estimada (`barrasDeLaRuta`), en el orden y los viajes de la ruta. */
  barras: BarraDelGantt[];
  bloqueada: boolean;
  /** El número de PARADA de cada entrega, el de la tabla y el mapa (D-485). Sin él, su puesto entre las entregas. */
  paradaDe?: ReadonlyMap<string, number>;
}

/** Lo que la pantalla le da a la línea de tiempo para arrastrar (D-417). Sin esto, la línea solo pinta. */
export interface ArrastreDelGantt {
  inicioMin: number;
  /** Qué pasaría al soltar ahí, sin escribir nada (`planDeSoltar`). Se llama en cada movimiento del puntero. */
  previa: (movida: string, destino: Destino) => PlanDeSoltar;
  /** Soltar: escribe. */
  suelta: (movida: string, destino: Destino) => void;
  /** Mientras se escribe un movimiento (o se deshace), no se empieza otro. */
  ocupado: boolean;
}

interface Arrastre { id: string; x0: number; y0: number; x: number; y: number; activo: boolean }
interface Objetivo { fila: string; destino: Destino; plan: PlanDeSoltar; marcaMin: number | null }

/** A per-driver day timeline: each stop at its estimated arrival (straight-line estimate, as «📍 Best fit»), in route
 * order, with its window drawn under it. Stops are dragged with the mouse or a finger (pointer events) to another slot or
 * another driver; dropping on a driver's NAME places it with Best fit. */
export function GanttTimeline({ rows, t, arrastre }: { rows: GanttRow[]; t: (en: string, es: string) => string; arrastre?: ArrastreDelGantt }) {
  // El tramo con paradas (D-NEXT): de la primera llegada al último fin, con margen. Las ventanas no lo estiran.
  const tramo = useMemo(() => tramoDelHorario(rows.flatMap((r) => r.barras)), [rows]);
  // El ancho que hay para la pista: lo que mide la caja menos la columna de nombres. Se mide antes de pintar y al cambiar.
  const caja = useRef<HTMLDivElement>(null);
  const columnaDeNombres = useRef<HTMLDivElement>(null);
  const anchoVisible = () => Math.max(0, Math.floor((caja.current?.clientWidth ?? 0) - (columnaDeNombres.current?.getBoundingClientRect().width ?? 150) - HUECO_COLUMNAS_PX));
  const [anchoDisponible, setAnchoDisponible] = useState(0);
  useLayoutEffect(() => {
    const c = caja.current;
    if (!c) return;
    const mide = () => setAnchoDisponible(anchoVisible());
    mide();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(mide);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);
  const [zoom, setZoom] = useState(1);
  const vista = vistaDelEje(tramo, anchoDisponible, zoom);
  const ajustado = Math.abs(vista.zoom - 1) < 1e-6;
  const pct = (m: number) => porcentajeEnElEje(vista, m);
  const marcas = marcasDelEje(vista);
  // ＋ / － acercan sobre lo que está en el centro de la pista; «Ajustar» vuelve al principio.
  const centroPendiente = useRef<number | null>(null);
  const cambiaZoom = (hacia: "mas" | "menos" | "ajustar") => {
    const c = caja.current;
    if (hacia === "ajustar") { centroPendiente.current = null; setZoom(1); if (c) c.scrollLeft = 0; return; }
    if (c && vista.pxPorMin > 0) centroPendiente.current = minutoEnElCentro(vista, c.scrollLeft, anchoVisible());
    setZoom(siguienteZoom(tramo, anchoDisponible, zoom, hacia));
  };
  useLayoutEffect(() => {
    const c = caja.current;
    const centro = centroPendiente.current;
    if (!c || centro == null) return;
    centroPendiente.current = null;
    c.scrollLeft = desplazamientoParaCentrar(vista, centro, anchoVisible());
  });
  // El texto se mide de verdad en el navegador (Inter 700 a 11 px, como `.gantt-bar`); sin lienzo, por lo alto.
  const mideTexto = useMemo(() => {
    if (typeof document === "undefined") return anchoEstimado;
    const ctx = document.createElement("canvas").getContext?.("2d");
    if (!ctx) return anchoEstimado;
    ctx.font = `700 11px ${getComputedStyle(document.body).fontFamily || "Inter, system-ui, sans-serif"}`;
    return (s: string) => Math.ceil(ctx.measureText(s).width) + 1;
  }, []);

  const nombres = useMemo(() => {
    const m = new Map<string, string>();
    // D-456: la factura nombra la barra (cabe una cosa); sin factura, su ID con «#». El ID de las que tienen factura, al pasar el ratón.
    for (const r of rows) for (const d of r.orders) m.set(d.id, facturaYId(d).principal);
    return m;
  }, [rows]);
  const nombre = (id: string) => nombres.get(id) ?? id.slice(0, 6);
  const porId = useMemo(() => new Map(rows.flatMap((r) => r.orders.map((d) => [d.id, d] as const))), [rows]);

  // En el teléfono no se arrastra (queda con las flechas de «Rutas»): ver D-417.
  const [estrecho, setEstrecho] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(SOLO_FLECHAS);
    const cambia = () => setEstrecho(mq.matches);
    cambia();
    mq.addEventListener("change", cambia);
    return () => mq.removeEventListener("change", cambia);
  }, []);
  const puedeArrastrar = !!arrastre && !estrecho && !arrastre.ocupado;

  const pistas = useRef(new Map<string, HTMLDivElement>());
  const etiquetas = useRef(new Map<string, HTMLDivElement>());
  const [arr, setArr] = useState<Arrastre | null>(null);
  const [objetivo, setObjetivo] = useState<Objetivo | null>(null);
  const cancela = () => { setArr(null); setObjetivo(null); };

  useEffect(() => {
    if (!arr) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") cancela(); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [arr]);

  /** Qué hay bajo el puntero: el nombre de un chofer (Mejor lugar) o un hueco de su fila. */
  const bajoElPuntero = (id: string, x: number, y: number): Objetivo | null => {
    if (!arrastre) return null;
    for (const r of rows) {
      const et = etiquetas.current.get(r.key)?.getBoundingClientRect();
      if (et && x >= et.left && x <= et.right && y >= et.top - 4 && y <= et.bottom + 4) {
        const destino: Destino = { tipo: "nombre", ruta: r.key };
        return { fila: r.key, destino, plan: arrastre.previa(id, destino), marcaMin: null };
      }
      const pi = pistas.current.get(r.key)?.getBoundingClientRect();
      if (pi && x >= pi.left - 8 && x <= pi.right + 8 && y >= pi.top - 4 && y <= pi.bottom + 4) {
        const min = minutoEnLaPista(vista, x - pi.left, pi.width);
        const h = huecoMasCercano(huecosDeLaFila(r.barras, id, arrastre.inicioMin), min);
        if (!h) return null;
        const destino: Destino = { tipo: "hueco", ruta: r.key, viaje: h.viaje, puesto: h.puesto };
        return { fila: r.key, destino, plan: arrastre.previa(id, destino), marcaMin: h.min };
      }
    }
    return null;
  };

  const alBajar = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (!puedeArrastrar || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setArr({ id, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, activo: false });
  };
  const alMover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!arr) return;
    const activo = arr.activo || Math.hypot(e.clientX - arr.x0, e.clientY - arr.y0) > UMBRAL_PX;
    setArr({ ...arr, x: e.clientX, y: e.clientY, activo });
    if (activo) setObjetivo(bajoElPuntero(arr.id, e.clientX, e.clientY));
  };
  const alSoltar = () => {
    if (arr?.activo && objetivo?.plan.ok && arrastre) arrastre.suelta(arr.id, objetivo.destino);
    cancela();
  };

  const avisoDelObjetivo = (o: Objetivo): { texto: string; mal: boolean } => {
    if (!o.plan.ok) {
      const p = porQueNoSuelta(o.plan.motivo);
      return { texto: t(p.en, p.es), mal: o.plan.motivo !== "sin_cambio" };
    }
    const p = textoDePrevia(o.plan.previa, nombre);
    // Sin viajes (D-443): la parada, sin «viaje N».
    const donde = t(`stop ${o.plan.puesto + 1}`, `parada ${o.plan.puesto + 1}`);
    const cabeza = o.plan.porNombre ? `📍 ${t("Best fit", "Mejor lugar")}: ${donde}` : donde;
    return { texto: `${cabeza} · ${t(p.en, p.es)}`, mal: o.plan.previa.rotas.length > 0 };
  };

  // Cada barra en px (con la escala ya medida): su ancho, y el ancho para su texto (hasta la siguiente, si la pisa).
  const pxDeBarra = (b: BarraDelGantt) => ({
    id: b.id, izquierda: (b.llegadaMin - vista.inicio) * vista.pxPorMin, ancho: Math.max(BARRA_MIN_PX, (b.finMin - b.llegadaMin) * vista.pxPorMin),
  });
  const anchoMinPct = vista.anchoPista ? (BARRA_MIN_PX / vista.anchoPista) * 100 : 1.2;

  return (
    <div>
      <div className="gantt-zoom" data-gantt-zoom-barra>
        <span className="hint" data-gantt-tramo>{horaDe(vista.inicio)}–{horaDe(vista.fin)}</span>
        <button type="button" className="btn btn-ghost btn-sm" data-gantt-zoom="mas" disabled={!vista.puedeAcercar}
          onClick={() => cambiaZoom("mas")} title={t("Zoom in", "Acercar")} aria-label={t("Zoom in", "Acercar")}>＋</button>
        <button type="button" className="btn btn-ghost btn-sm" data-gantt-zoom="menos" disabled={!vista.puedeAlejar}
          onClick={() => cambiaZoom("menos")} title={t("Zoom out", "Alejar")} aria-label={t("Zoom out", "Alejar")}>－</button>
        <button type="button" className="btn btn-ghost btn-sm" data-gantt-zoom="ajustar" disabled={ajustado}
          onClick={() => cambiaZoom("ajustar")} title={t("Fit the day's stops to the width", "Ajustar las paradas del día al ancho")}>{t("Fit", "Ajustar")}</button>
      </div>
    <div className="gantt-scroll" ref={caja}>
      {arrastre && estrecho && (
        <p className="hint" data-gantt-solo-flechas style={{ margin: "0 0 8px" }}>
          {t("On a phone the timeline is read-only: reorder with the ↑ ↓ arrows in Routes.", "En el teléfono la línea de tiempo solo se mira: reordene con las flechas ↑ ↓ de «Rutas».")}
        </p>
      )}
      <div className="gantt" style={vista.anchoPista ? { width: `calc(var(--gantt-nombre) + ${HUECO_COLUMNAS_PX}px + ${vista.anchoPista}px)` } : undefined}>
        <div className="gantt-axis">
          <div className="gantt-rowlabel" ref={columnaDeNombres} />
          <div className="gantt-track gantt-hours">
            {marcas.map((m) => (
              <span key={m.min} className={"gantt-hour gantt-hour-" + m.alinea} style={{ left: `${m.pct}%` }}>{m.texto}</span>
            ))}
          </div>
        </div>
        {rows.map((row) => {
          const noWindow = row.orders.filter((d) => !parseWindow(d.delivery_windows)).length;
          const aqui = arr?.activo && objetivo?.fila === row.key ? objetivo : null;
          const marca = aqui ? avisoDelObjetivo(aqui) : null;
          // Lo que cabe escrito en cada barra (D-NEXT): completo, o una forma corta; el texto entero, en el `title`.
          const anchoDelTexto = vista.pxPorMin > 0 ? anchosParaElTexto(row.barras.map(pxDeBarra)) : null;
          return (
            <div className="gantt-row" key={row.key} data-gantt-row={row.key}>
              <div
                className={"gantt-rowlabel" + (aqui && aqui.destino.tipo === "nombre" ? (marca?.mal || !aqui.plan.ok ? " gantt-nombre-mal" : " gantt-nombre-ok") : "")}
                data-gantt-nombre={row.key}
                ref={(el) => { if (el) etiquetas.current.set(row.key, el); else etiquetas.current.delete(row.key); }}
                title={arrastre ? t("Drop a stop here: Best fit places it", "Suelte una parada aquí: Mejor lugar la coloca") : undefined}
              >
                <span className="dboard-dot" style={{ background: row.color }} /> {row.title}{row.bloqueada ? " 🔒" : ""}
                {noWindow > 0 && <span className="hint">+{noWindow} {t("no window", "sin ventana")}</span>}
              </div>
              <div className="gantt-track" ref={(el) => { if (el) pistas.current.set(row.key, el); else pistas.current.delete(row.key); }}>
                {marcas.map((m) => <span key={m.min} className={"gantt-grid" + (m.alinea === "fin" ? " gantt-grid-fin" : "")} style={{ left: `${m.pct}%` }} />)}
                {row.barras.map((b) => {
                  const d = porId.get(b.id);
                  const left = pct(b.llegadaMin);
                  const width = Math.max(anchoMinPct, Math.min(100 - left, pct(b.finMin) - left));
                  const arrastrada = arr?.activo && arr.id === b.id;
                  const parada = row.paradaDe?.get(b.id) ?? b.puesto + 1;
                  return (
                    <div key={b.id}>
                      {b.ventana && (
                        <span className="gantt-ventana" style={{ left: `${pct(b.ventana[0])}%`, width: `${Math.max(0.5, pct(b.ventana[1]) - pct(b.ventana[0]))}%`, background: row.color }} />
                      )}
                      <div
                        className={"gantt-bar" + (b.tardeMin > 0 ? " gantt-bar-tarde" : "") + (puedeArrastrar ? " gantt-bar-arrastrable" : "") + (arrastrada ? " gantt-bar-arrastrada" : "")}
                        data-gantt-bar={b.id}
                        title={`${nombre(b.id)}${d && facturaYId(d).id ? ` · ${facturaYId(d).id}` : ""} · ${t("stop", "parada")} ${parada} · ~${horaDe(b.llegadaMin)}${d ? ` · ${fmtWindows(d.delivery_windows)} · ${d.account || ""}` : ""}${b.tardeMin > 0 ? ` · ⚠ ${b.tardeMin} min ${t("late", "tarde")}` : ""}`}
                        style={{ left: `${left}%`, width: `${width}%`, background: row.color }}
                        onPointerDown={puedeArrastrar ? (e) => alBajar(e, b.id) : undefined}
                        onPointerMove={puedeArrastrar ? alMover : undefined}
                        onPointerUp={puedeArrastrar ? alSoltar : undefined}
                        onPointerCancel={puedeArrastrar ? cancela : undefined}
                      >
                        {anchoDelTexto ? etiquetaQueCabe(nombre(b.id), b.tardeMin > 0, anchoDelTexto.get(b.id) ?? 0, mideTexto, parada) : `${b.tardeMin > 0 ? "⚠" : ""}${nombre(b.id)}`}
                      </div>
                    </div>
                  );
                })}
                {aqui && aqui.marcaMin != null && (
                  <span className={"gantt-marca" + (marca?.mal || !aqui.plan.ok ? " gantt-marca-mal" : "")} data-gantt-marca style={{ left: `${pct(aqui.marcaMin)}%` }} />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {arr?.activo && (
        <div className="gantt-fantasma" style={{ left: arr.x + 14, top: arr.y + 14 }} data-gantt-previa>
          <b>{nombre(arr.id)}</b>
          {objetivo ? (() => { const a = avisoDelObjetivo(objetivo); return <span className={a.mal ? "gantt-previa-mal" : ""}>{a.texto}</span>; })()
            : <span>{t("Drop on a driver's row, or on their name for Best fit", "Suelte en la fila de un chofer, o en su nombre para Mejor lugar")}</span>}
        </div>
      )}
    </div>
    </div>
  );
}
