"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseWindow } from "@/lib/dispatch";
import { fmtWindows, orderLabel } from "@/lib/utils";
import {
  huecoMasCercano, huecosDeLaFila, porQueNoSuelta, textoDePrevia,
  type BarraDelGantt, type Destino, type PlanDeSoltar,
} from "@/lib/arrastre-de-paradas";
import { horaDe } from "@/lib/mejor-lugar";
import type { Delivery } from "@/lib/types";

// The day axis starts at 07:00 and runs to 19:00, or later if a route runs later.
const AXIS_START = 7 * 60;
const AXIS_END_MIN = 19 * 60;
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
  const finDelEje = useMemo(() => {
    let fin = AXIS_END_MIN;
    for (const r of rows) for (const b of r.barras) fin = Math.max(fin, b.finMin, b.ventana ? b.ventana[1] : 0);
    return Math.min(24 * 60, Math.ceil(fin / 60) * 60);
  }, [rows]);
  const range = finDelEje - AXIS_START;
  const pct = (m: number) => Math.max(0, Math.min(100, ((m - AXIS_START) / range) * 100));
  const hours: number[] = [];
  for (let m = AXIS_START; m <= finDelEje; m += 60) hours.push(m);

  const nombres = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) for (const d of r.orders) m.set(d.id, orderLabel(d));
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
        const min = AXIS_START + Math.max(0, Math.min(1, (x - pi.left) / pi.width)) * range;
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

  return (
    <div className="gantt-scroll">
      {arrastre && estrecho && (
        <p className="hint" data-gantt-solo-flechas style={{ margin: "0 0 8px" }}>
          {t("On a phone the timeline is read-only: reorder with the ↑ ↓ arrows in Routes.", "En el teléfono la línea de tiempo solo se mira: reordene con las flechas ↑ ↓ de «Rutas».")}
        </p>
      )}
      <div className="gantt">
        <div className="gantt-axis">
          <div className="gantt-rowlabel" />
          <div className="gantt-track gantt-hours">
            {hours.map((m) => (
              <span key={m} className="gantt-hour" style={{ left: `${pct(m)}%` }}>{String(Math.floor(m / 60)).padStart(2, "0")}:00</span>
            ))}
          </div>
        </div>
        {rows.map((row) => {
          const noWindow = row.orders.filter((d) => !parseWindow(d.delivery_windows)).length;
          const aqui = arr?.activo && objetivo?.fila === row.key ? objetivo : null;
          const marca = aqui ? avisoDelObjetivo(aqui) : null;
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
                {hours.map((m) => <span key={m} className="gantt-grid" style={{ left: `${pct(m)}%` }} />)}
                {row.barras.map((b) => {
                  const d = porId.get(b.id);
                  const left = pct(b.llegadaMin);
                  const width = Math.max(1.2, Math.min(100 - left, pct(b.finMin) - left));
                  const arrastrada = arr?.activo && arr.id === b.id;
                  return (
                    <div key={b.id}>
                      {b.ventana && (
                        <span className="gantt-ventana" style={{ left: `${pct(b.ventana[0])}%`, width: `${Math.max(0.5, pct(b.ventana[1]) - pct(b.ventana[0]))}%`, background: row.color }} />
                      )}
                      <div
                        className={"gantt-bar" + (b.tardeMin > 0 ? " gantt-bar-tarde" : "") + (puedeArrastrar ? " gantt-bar-arrastrable" : "") + (arrastrada ? " gantt-bar-arrastrada" : "")}
                        data-gantt-bar={b.id}
                        title={`#${nombre(b.id)} · ${t("stop", "parada")} ${b.puesto + 1} · ~${horaDe(b.llegadaMin)}${d ? ` · ${fmtWindows(d.delivery_windows)} · ${d.account || ""}` : ""}${b.tardeMin > 0 ? ` · ⚠ ${b.tardeMin} min ${t("late", "tarde")}` : ""}`}
                        style={{ left: `${left}%`, width: `${width}%`, background: row.color }}
                        onPointerDown={puedeArrastrar ? (e) => alBajar(e, b.id) : undefined}
                        onPointerMove={puedeArrastrar ? alMover : undefined}
                        onPointerUp={puedeArrastrar ? alSoltar : undefined}
                        onPointerCancel={puedeArrastrar ? cancela : undefined}
                      >
                        {b.tardeMin > 0 ? "⚠" : ""}#{nombre(b.id)}
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
          <b>#{nombre(arr.id)}</b>
          {objetivo ? (() => { const a = avisoDelObjetivo(objetivo); return <span className={a.mal ? "gantt-previa-mal" : ""}>{a.texto}</span>; })()
            : <span>{t("Drop on a driver's row, or on their name for Best fit", "Suelte en la fila de un chofer, o en su nombre para Mejor lugar")}</span>}
        </div>
      )}
    </div>
  );
}
