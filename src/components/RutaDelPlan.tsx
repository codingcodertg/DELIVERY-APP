"use client";

import { Fragment, useState, type ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";
import { horaDeReloj, type ParadaVista, type RutaVista } from "@/lib/route-plan/vista";
import { cambiaConLaVecina, type Movimiento } from "@/lib/route-plan/ajuste";
import { ordenDeLaParte } from "@/lib/route-plan/publicar";
import { COLUMNAS_DEL_GESTOR, seVeEnLaRecogida, type ColumnaDelGestor } from "@/lib/routes-columns";
import { claseDeLaFilaDelPlan } from "@/lib/route-plan/celdas-del-plan";
import type { Delivery } from "@/lib/types";

/**
 * La ruta de cada chofer, parada a parada (D-322): recogidas (P) y entregas (D) con su etiqueta, a qué hora
 * llega y sale, con cuántos pallets viaja el camión en cada tramo, y los totales del día.
 *
 * Solo PINTA. Las horas, la carga y los totales llegan calculados de `vistaDelPlan`, que a su vez no calcula
 * horas: son las que guardó el motor. Aquí no hay ni una suma.
 *
 * Con `ajuste` cada parada lleva sus controles: subir, bajar, pasar la orden a otro chofer, fijarla. Aquí tampoco se
 * decide nada: se manda el movimiento y se pinta lo que el servidor contesta. Desde D-429 también en un plan PUBLICADO
 * (el servidor hace una copia en borrador); lo que ya no está pendiente lleva 🔒 y no se mueve (`noSeMueven`).
 *
 * LAS COLUMNAS (D-429): las de Órdenes, en el orden de Órdenes, elegibles y movibles en ⚙ y con plantillas como el resto
 * del Gestor (`columnas`, que arma la página con `columnasDeLaTabla("plan", …)`). Fijas: la etiqueta, la parada y Ajustar.
 * Las cuatro de antes —llega–sale, ventana, tramo y pallets a bordo— son columnas más del ⚙, escondidas de partida. En una
 * RECOGIDA, lo que es de la entrega (dirección, ventanas, contacto) va vacío (`seVeEnLaRecogida`).
 *
 * D-434: la columna fija de la parada es SOLO el id de la orden (el dueño: «una columna solo para el id»). Se fueron de ahí la
 * factura, «Recoger / Entregar», la pastilla Builder, el lugar y la línea «📍 ciudad · dirección» de D-422: cada cosa tiene
 * ahora su columna (Factura, Tipo de cliente, Ciudad de recogida, Dirección de entrega) o ya la dice la etiqueta P/D.
 *
 * D-NEXT: cada fila lleva el color de su parada —recogida verde, entrega amarilla, muy suaves— para distinguirlas de un
 * vistazo (`claseDeLaFilaDelPlan`); y hay «Ciudad de entrega» tras la de recogida, vacía en las P como la dirección.
 */

export interface AjusteDeRuta {
  choferes: { id: string; nombre: string }[]; ocupado: boolean; mueve: (m: Movimiento) => void;
  /** Órdenes que ya no están pendientes (copia de un publicado): sus paradas no se mueven. Vacío en un borrador del motor. */
  noSeMueven: ReadonlySet<string>;
}

/** Qué columnas pinta la tabla y con qué: las de la persona (en su orden), la celda de Órdenes, y el ⚙. */
export interface ColumnasDeLaRuta {
  lista: readonly ColumnaDelGestor[];
  /** La orden de una parada (`order_ref`, que puede ser una parte «id#b»). */
  orden: (ref: string) => Delivery | undefined;
  /** La celda de Órdenes de una columna del Gestor (`columnaDeOrdenes`), y su clase de pastillas. */
  celda: (clave: string, d: Delivery) => ReactNode;
  clase?: (clave: string) => string | undefined;
  /** El ⚙ Columnas, con plantillas y flechas: lo pone la página, que es quien guarda. */
  selector?: ReactNode;
}

/** Sin columnas de la página, las cuatro de siempre: la tabla se ve como antes de D-429. */
const SOLO_LAS_DEL_PLAN = COLUMNAS_DEL_GESTOR.filter((c) => c.tablas.includes("plan") && !c.deOrdenes);

export function RutaDelPlan({ rutas, idDeOrden, abrirOrden, ajuste, columnas }: { rutas: RutaVista[]; idDeOrden: (ref: string) => string; abrirOrden?: (ref: string) => void; ajuste?: AjusteDeRuta; columnas?: ColumnasDeLaRuta }) {
  const { t, lang } = usePrefs();
  const [cerradas, setCerradas] = useState<Record<string, boolean>>({});
  if (!rutas.length) return null;
  const lista = columnas?.lista ?? SOLO_LAS_DEL_PLAN;
  // El rótulo del catálogo sin su «Plan: »: el de Órdenes, tal cual, para las que vienen de allí.
  const rotulo = (c: ColumnaDelGestor) => (lang === "es" ? c.es : c.en).replace(/^[^:]+: /, "");

  /** La celda de UNA columna en UNA parada: las propias del plan, de la parada; las de Órdenes, de su orden. */
  const celda = (c: ColumnaDelGestor, p: ParadaVista, k: number): ReactNode => {
    switch (c.key) {
      case "pl_horas": return (
        <td key={c.key}>
          {horaDeReloj(p.eta)}–{horaDeReloj(p.etd)}
          {p.wait_min > 0 && <span className="hint" style={{ margin: 0 }}> · {t(`waits ${p.wait_min} min`, `espera ${p.wait_min} min`)}</span>}
          {p.late_min > 0 && <span className="sema" style={{ border: "1px solid var(--red)", color: "var(--red)", marginLeft: 6 }}>{p.late_min} {t("min late", "min tarde")}</span>}
        </td>
      );
      case "pl_ventana": return (
        <td key={c.key}>
          {p.window_start != null && p.window_end != null ? `${horaDeReloj(p.window_start)}–${horaDeReloj(p.window_end)}` : "—"}
          {p.is_hard && <span title={t("Hard window", "Ventana dura")}> 🔒</span>}
        </td>
      );
      case "pl_tramo": return <td key={c.key}>{k === 0 ? "—" : `${p.leg_minutes} min · ${p.leg_miles} mi`}</td>;
      case "pl_bordo": return <td key={c.key} title={t("Pallets on board arriving → leaving", "Pallets a bordo al llegar → al salir")}>{p.aBordoAlLlegar} → {p.load_after}</td>;
    }
    // En una recogida, lo que es de la entrega no se pinta: esa parada es en la tienda.
    if (p.kind === "P" && !seVeEnLaRecogida(c)) return <td key={c.key} data-solo-entrega />;
    const d = columnas?.orden(p.order_ref);
    return <td key={c.key} className={columnas?.clase?.(c.key)}>{d && columnas ? columnas.celda(c.key, d) : "—"}</td>;
  };

  const duracion = (min: number) => `${Math.floor(min / 60)} h ${min % 60} min`;

  const fila = (p: ParadaVista, k: number, ruta: RutaVista) => {
    const otroViaje = k > 0 && ruta.paradas[k - 1].viaje !== p.viaje;
    // La misma regla que aplica el servidor (`aplicaMovimiento`): la flecha se apaga si la parada o su vecina no se mueven.
    const ordenesDeLaRuta = ruta.paradas.map((x) => x.order_ref);
    const quieta = !!ajuste?.noSeMueven.has(ordenDeLaParte(p.order_ref));
    return (
      <Fragment key={`${p.seq}`}>
      {/* D-NEXT: recogida en verde muy suave, entrega en amarillo, la fila entera (los tintes, en `globals.css`). */}
      <tr className={claseDeLaFilaDelPlan(p.kind)} style={otroViaje ? { borderTop: "2px solid var(--amber)" } : undefined}>
        <td title={p.kind === "P" ? t("Pick up", "Recoger") : t("Deliver", "Entregar")}><b>{p.label}</b>{p.pinned && <span title={t("Pinned", "Fijada")}> 📌</span>}
          {quieta && <span data-no-se-mueve title={t("No longer pending that day (picked up, delivered, canceled or moved): it isn't moved or rewritten", "Ya no está pendiente ese día (recogida, entregada, anulada o movida): no se mueve ni se reescribe")}> 🔒</span>}</td>
        <td>
          {/* D-434: SOLO el id («quiero que haya una columna solo para el id»); D-428: abre la ficha. La factura, el tipo de
              cliente y la ciudad de recogida van en sus columnas; «Recoger / Entregar» lo dice la etiqueta P/D (y su título). */}
          {abrirOrden
            ? <button type="button" data-abrir-orden style={{ background: "none", border: 0, padding: 0, color: "var(--blue, #2563eb)", textDecoration: "underline", cursor: "pointer", font: "inherit", fontWeight: 600 }} title={t("Open the order", "Abrir la orden")} onClick={() => abrirOrden(p.order_ref)}>{idDeOrden(p.order_ref)}</button>
            : <b>{idDeOrden(p.order_ref)}</b>}
          {/* Una orden partida sale dos veces con el mismo id: sin esto no se sabe cuál carga es cada fila. */}
          {p.carga && <span className="hint" style={{ margin: 0 }}> · {t(`load ${p.carga.numero} of ${p.carga.de}`, `carga ${p.carga.numero} de ${p.carga.de}`)}</span>}
        </td>
        {lista.map((c) => celda(c, p, k))}
        {ajuste && (
          <td style={{ whiteSpace: "nowrap" }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={ajuste.ocupado || !cambiaConLaVecina(ordenesDeLaRuta, k, -1, ajuste.noSeMueven)} title={t("Move up", "Subir")} onClick={() => ajuste.mueve({ tipo: "sube", chofer: ruta.choferId, indice: k })}>↑</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={ajuste.ocupado || !cambiaConLaVecina(ordenesDeLaRuta, k, 1, ajuste.noSeMueven)} title={t("Move down", "Bajar")} onClick={() => ajuste.mueve({ tipo: "baja", chofer: ruta.choferId, indice: k })}>↓</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={ajuste.ocupado} title={p.pinned ? t("Unpin this order", "Soltar esta orden") : t("Pin this order where it is", "Fijar esta orden donde está")}
              onClick={() => ajuste.mueve({ tipo: p.pinned ? "suelta" : "fija", orden: p.order_ref })}>{p.pinned ? "📌" : "📍"}</button>
            {p.kind === "P" && !quieta && ajuste.choferes.length > 1 && (
              <select style={{ width: "auto", display: "inline-block", padding: "4px 6px", fontSize: 12 }} disabled={ajuste.ocupado} value="" aria-label={t("Move order to another driver", "Pasar la orden a otro chofer")}
                onChange={(e) => { if (e.target.value) ajuste.mueve({ tipo: "a_chofer", orden: p.order_ref, chofer: e.target.value }); }}>
                <option value="">{t("Move to…", "Pasar a…")}</option>
                {ajuste.choferes.filter((c) => c.id !== ruta.choferId).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            )}
          </td>
        )}
      </tr>
      </Fragment>
    );
  };

  return (
    // `minWidth: 0` aquí y en cada tarjeta: un hijo de grid crece hasta lo que mida su tabla, y con las columnas de Órdenes
    // (D-429) la tabla empujaba la PÁGINA de lado en vez de desplazarse dentro de su caja (medido en el demo: 297 px a 1440).
    <div style={{ display: "grid", gap: 10, marginTop: 6, minWidth: 0 }}>
      {/* Un ⚙ para todas las rutas: las columnas son de la persona, no de cada chofer. */}
      {columnas?.selector && <div data-columnas-del-plan style={{ textAlign: "right" }}>{columnas.selector}</div>}
      {rutas.map((ruta) => {
        const x = ruta.totales;
        const cerrada = !!cerradas[ruta.choferId];
        return (
          <div key={ruta.choferId} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, minWidth: 0 }}>
            <button type="button" className="btn btn-ghost btn-sm" style={{ width: "100%", justifyContent: "flex-start", gap: 8, flexWrap: "wrap" }}
              onClick={() => setCerradas((c) => ({ ...c, [ruta.choferId]: !cerrada }))}>
              <span>{cerrada ? "▸" : "▾"}</span>
              <b>{ruta.chofer}</b>
              <span className="hint" style={{ margin: 0 }}>
                {horaDeReloj(x.inicio)}–{horaDeReloj(x.fin)} · {duracion(x.minutos)} · {x.entregas} {t("deliveries", "entregas")} · {x.paradas} {t("stops", "paradas")}
                {x.viajes > 1 && ` · ${x.viajes} ${t("trips", "viajes")}`} · {x.millas} mi · {t("driving", "manejo")} {duracion(x.manejoMin)} · {t("peak load", "carga máxima")} {x.palletsMax}
                {x.esperaMin > 0 && ` · ${t("waiting", "espera")} ${x.esperaMin} min`}
              </span>
              {x.tardeMin > 0 && <span className="sema" style={{ border: "1px solid var(--red)", color: "var(--red)" }}>{x.tardeMin} {t("min late", "min tarde")}</span>}
            </button>
            {!cerrada && (
              <div style={{ overflowX: "auto" }}>
                <table className="orders" style={{ minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th>#</th><th data-columna-id>{t("ID", "ID")}</th>
                      {lista.map((c) => <th key={c.key} data-columna-del-plan={c.key}>{rotulo(c)}</th>)}
                      {ajuste && <th>{t("Adjust", "Ajustar")}</th>}
                    </tr>
                  </thead>
                  <tbody>{ruta.paradas.map((p, k) => fila(p, k, ruta))}</tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
