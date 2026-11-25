"use client";

import { useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { usePrefs } from "@/lib/prefs";
import { horaDeReloj, type ParadaVista, type RutaVista } from "@/lib/route-plan/vista";
import { numeroDePallets, textoDeLaCuenta, textoDelExceso, type FilaDeCuenta } from "@/lib/lista-unica";
import { cambiaConLaVecina, type Movimiento } from "@/lib/route-plan/ajuste";
import { ordenDeLaParte } from "@/lib/route-plan/publicar";
import { COLUMNAS_DEL_GESTOR, seVeEnLaRecogida, type ColumnaDelGestor } from "@/lib/routes-columns";
import { claseDeLaFilaDelPlan } from "@/lib/route-plan/celdas-del-plan";
import { numeracionDeLasParadas, type FilaDelPlanParaParada, type NumeroDeLaFila } from "@/lib/route-plan/paradas-del-plan";
import type { FacturaYId } from "@/lib/route-plan/etiqueta";
import type { Delivery } from "@/lib/types";

/**
 * La ruta de cada chofer, parada a parada (D-322): recogidas (P) y entregas (D) con su etiqueta, a qué hora
 * llega y sale, con cuántos pallets viaja el camión en cada tramo, y los totales del día.
 *
 * Solo PINTA. Las horas, la carga y los totales llegan calculados de `vistaDelPlan`, que a su vez no calcula
 * horas: son las que guardó el motor. Aquí no hay ni una suma.
 *
 * Con `ajuste` cada parada lleva sus controles: subir, bajar, pasar la orden a otro chofer, fijarla, y ARRASTRARLA
 * (como en la tabla de paradas del Gestor): a otro puesto de su ruta (`a_puesto`) o a la ruta de otro chofer (`a_chofer`).
 * Aquí tampoco se decide nada: se manda el movimiento y se pinta lo que el servidor contesta. Desde D-429 también en un
 * plan PUBLICADO (el servidor hace una copia en borrador); lo que ya no está pendiente lleva 🔒 y no se mueve (`noSeMueven`).
 *
 * LA TABLA es la de paradas del Gestor, compacta (`table.orders.tabla-de-paradas`): filas de su alto, el número de parada
 * con el círculo del color del chofer, y la base en una fila. La cabecera de cada chofer es una sola línea.
 *
 * LAS COLUMNAS (D-429): las de Órdenes, en el orden de Órdenes, elegibles y movibles en ⚙ y con plantillas como el resto
 * del Gestor (`columnas`, que arma la página con `columnasDeLaTabla("plan", …)`). Fijas: la factura (con su ID), la
 * cuenta de pallets y Ajustar. En una RECOGIDA, lo que es de la entrega (dirección, ventanas, contacto) va vacío
 * (`seVeEnLaRecogida`).
 *
 * D-443: sin viajes: la ruta es una lista. La cuenta de pallets es una columna FIJA («a bordo antes ± la parada = después ·
 * libres»), y la ruta empieza y acaba en la Base con 0 a bordo; si al volver no da 0, se marca.
 *
 * D-456: la columna fija de la parada es la FACTURA, que abre la orden, con el ID al lado, más pequeño; una orden sin
 * factura enseña su ID en gris.
 *
 * D-435: cada fila lleva el color de su parada —recogida verde, entrega amarilla, muy suaves— (`claseDeLaFilaDelPlan`).
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

/** Lo que se arrastra: la parada de una ruta (su chofer, su puesto y su orden). */
interface ParadaArrastrada { chofer: string; indice: number; orden: string }

/** Sin columnas de la página, las cuatro de siempre: la tabla se ve como antes de D-429. */
const SOLO_LAS_DEL_PLAN = COLUMNAS_DEL_GESTOR.filter((c) => c.tablas.includes("plan") && !c.deOrdenes);

/** Los manejadores de arrastre de una fila: vacíos si la fila no se arrastra. */
interface ArrastreDeFila {
  draggable: boolean;
  onMouseDown?: (e: { target: EventTarget }) => void;
  onTouchStart?: (e: { target: EventTarget }) => void;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: () => void;
}

/** El arrastre de una fila no empieza en un control: el clic llega a su botón, desplegable, campo o enlace (como en la tabla del Gestor). */
const CONTROLES = "button, select, input, textarea, a, label, [data-abre-la-orden], .col-resizer";

export function RutaDelPlan({ rutas, facturaDeOrden, abrirOrden, ajuste, columnas, colorDelChofer, iconosDeLaOrden, tiendaDeDestino }: {
  rutas: RutaVista[]; facturaDeOrden: (ref: string) => FacturaYId; abrirOrden?: (ref: string) => void; ajuste?: AjusteDeRuta; columnas?: ColumnasDeLaRuta;
  /** La tienda a la que va la entrega de una orden, si es una tienda (`misma-visita`): descarga y carga ahí son una parada. */
  tiendaDeDestino?: (ref: string) => string | null;
  /** El color del chofer (el del mapa y la tabla de paradas): la raya de la izquierda y el círculo del número. */
  colorDelChofer?: (choferId: string, nombre: string) => string;
  /** Lo que va tras la factura de una orden, como en la tabla de paradas: el 📅 de reprogramar y el ⇄ de relevo. */
  iconosDeLaOrden?: (d: Delivery) => ReactNode;
}) {
  const { t, lang } = usePrefs();
  const [cerradas, setCerradas] = useState<Record<string, boolean>>({});
  const [arrastrada, setArrastrada] = useState<ParadaArrastrada | null>(null);
  /** Sobre qué se está pasando: «fila:<chofer>:<puesto>» o «ruta:<chofer>» (su cabecera o su tarjeta). */
  const [sobre, setSobre] = useState<string | null>(null);
  const enUnControl = useRef(false);
  // Todos los hooks van ANTES del `return` de abajo: la lista de rutas puede venir vacía en el primer pintado.
  const numeros = useMemo(() => new Map(rutas.map((r) => [r.choferId, numeracionDeLasParadas(filasDeLaRuta(r, columnas))])), [rutas, columnas, tiendaDeDestino]);
  if (!rutas.length) return null;
  const lista = columnas?.lista ?? SOLO_LAS_DEL_PLAN;
  // El rótulo del catálogo sin su «Plan: »: el de Órdenes, tal cual, para las que vienen de allí.
  const rotulo = (c: ColumnaDelGestor) => (lang === "es" ? c.es : c.en).replace(/^[^:]+: /, "");
  // El color de un chofer: el de la página (el del mapa); sin él, un acento neutro.
  const colorDe = (ruta: RutaVista) => colorDelChofer?.(ruta.choferId, ruta.chofer) ?? "var(--accent)";
  /** Hay un arrastre en curso y se puede soltar aquí: sin plan editable no hay nada que arrastrar. */
  const sePuedeSoltar = !!arrastrada && !!ajuste && !ajuste.ocupado;

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
    }
    // En una recogida, lo que es de la entrega no se pinta: esa parada es en la tienda.
    if (p.kind === "P" && !seVeEnLaRecogida(c)) return <td key={c.key} data-solo-entrega />;
    const d = columnas?.orden(p.order_ref);
    return <td key={c.key} className={columnas?.clase?.(c.key)}>{d && columnas ? columnas.celda(c.key, d) : "—"}</td>;
  };

  const duracion = (min: number) => `${Math.floor(min / 60)} h ${min % 60} min`;

  /** La celda fija de la cuenta (D-443): «+4 = 4» desde D-444 y, si se pasa, cuánto, en ESTA fila. */
  const celdaDeCuenta = (f: FilaDeCuenta, capacidad: number | null) => (
    <td data-cuenta style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontSize: 12 }} title={t("What this stop loads (+) or unloads (−) = pallets on board after it", "Lo que carga (+) o descarga (−) esta parada = pallets a bordo después")}>
      {textoDeLaCuenta(f)}
      {f.exceso > 0 && <div data-exceso style={{ color: "var(--red)", fontWeight: 700 }}>{textoDelExceso(f, capacidad, lang === "es")}</div>}
    </td>
  );
  /** La fila de la Base, como en la tabla de paradas: 🏠 y «Base: salida» / «Base: regreso» en una sola fila compacta. */
  const filaDeBase = (ruta: RutaVista, cual: "salida" | "regreso") => {
    const f = cual === "salida" ? ruta.salida : ruta.regreso;
    const mal = cual === "regreso" && ruta.totales.finalNoCero;
    return (
      <tr key={cual} data-base={cual}>
        <td style={{ fontWeight: 700 }} title={t("Base", "Base")} aria-label={t("Base", "Base")}>🏠</td>
        <td className="hint" style={{ margin: 0 }}>{cual === "salida" ? t("Base: leaves", "Base: salida") : t("Base: returns", "Base: regreso")}</td>
        <td data-cuenta style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontSize: 12, color: mal ? "var(--red)" : undefined, fontWeight: mal ? 700 : undefined }}>
          {numeroDePallets(f.despues)}
          {mal && <div data-no-cuadra>⚠ {t("doesn’t come back empty: the count doesn’t add up", "no vuelve vacío: la cuenta no cuadra")}</div>}
        </td>
        {lista.map((c) => <td key={c.key} />)}
        {ajuste && <td />}
      </tr>
    );
  };

  /** Arrastrar una parada: solo las que las flechas también mueven (no las de `noSeMueven`), y solo con el plan libre. */
  const arrastre = (ruta: RutaVista, p: ParadaVista, k: number, quieta: boolean): ArrastreDeFila => {
    if (!ajuste || ajuste.ocupado || quieta) return { draggable: false };
    return {
      draggable: true,
      onMouseDown: (e: { target: EventTarget }) => { enUnControl.current = !!(e.target as Element).closest?.(CONTROLES); },
      onTouchStart: (e: { target: EventTarget }) => { enUnControl.current = !!(e.target as Element).closest?.(CONTROLES); },
      onDragStart: (e: DragEvent) => {
        if (enUnControl.current) { e.preventDefault(); return; }
        e.dataTransfer.setData("text/plain", p.order_ref);
        e.dataTransfer.effectAllowed = "move";
        setArrastrada({ chofer: ruta.choferId, indice: k, orden: p.order_ref });
      },
      onDragEnd: () => { setArrastrada(null); setSobre(null); },
    };
  };
  /** Lo que hace de una fila un sitio donde soltar (su puesto, o la ruta de su chofer). Sin arrastre no pone nada. */
  const sueltaEnLaFila = (ruta: RutaVista, k: number) => {
    if (!sePuedeSoltar) return {};
    const clave = `fila:${ruta.choferId}:${k}`;
    return {
      onDragOver: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; if (sobre !== clave) setSobre(clave); },
      onDrop: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); soltar(ruta, k); },
    };
  };
  /** La cabecera o la tarjeta de un chofer: soltar ahí manda la orden a su ruta, al final. */
  const sueltaEnLaRuta = (ruta: RutaVista) => {
    if (!sePuedeSoltar) return {};
    const clave = `ruta:${ruta.choferId}`;
    return {
      onDragOver: (e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (sobre !== clave) setSobre(clave); },
      onDrop: (e: DragEvent) => { e.preventDefault(); soltar(ruta, null); },
    };
  };
  /** Lo que se suelta: en su misma ruta, a otro puesto (`a_puesto`); en la de otro chofer, la orden entera (`a_chofer`). */
  const soltar = (destino: RutaVista, indice: number | null) => {
    const a = arrastrada;
    setArrastrada(null);
    setSobre(null);
    if (!a || !ajuste || ajuste.ocupado) return;
    if (a.chofer === destino.choferId) {
      if (indice == null || indice === a.indice) return;
      ajuste.mueve({ tipo: "a_puesto", chofer: a.chofer, indice: a.indice, destino: indice });
      return;
    }
    ajuste.mueve({ tipo: "a_chofer", orden: a.orden, chofer: destino.choferId });
  };
  /** La raya que dice dónde cae: arriba, o abajo si viene de más arriba en la misma ruta (como la tabla de paradas). */
  const claseDeSoltar = (ruta: RutaVista, k: number, esLaArrastrada: boolean) => {
    if (!sePuedeSoltar || esLaArrastrada || sobre !== `fila:${ruta.choferId}:${k}`) return "";
    const vieneDeArriba = arrastrada!.chofer === ruta.choferId && arrastrada!.indice < k;
    return vieneDeArriba ? " suelta-abajo" : " suelta-arriba";
  };

  const fila = (p: ParadaVista, k: number, ruta: RutaVista, num: NumeroDeLaFila) => {
    // La misma regla que aplica el servidor (`aplicaMovimiento`): la flecha se apaga si la parada o su vecina no se mueven.
    const ordenesDeLaRuta = ruta.paradas.map((x) => x.order_ref);
    const quieta = !!ajuste?.noSeMueven.has(ordenDeLaParte(p.order_ref));
    const color = colorDe(ruta);
    const esLaArrastrada = arrastrada?.chofer === ruta.choferId && arrastrada.indice === k;
    // D-435: recogida en verde muy suave, entrega en amarillo (los tintes, en `globals.css`). Y la recogida en grupo.
    const grupo = num.inicioDeGrupo ? " fila-grupo-recoger fila-grupo-inicio" : num.enGrupoDeRecogidas ? " fila-grupo-recoger" : "";
    const d = columnas?.orden(p.order_ref);
    const n = facturaDeOrden(p.order_ref);
    const arrastrable = arrastre(ruta, p, k, quieta);
    return (
      <tr key={`${p.seq}`} className={`${claseDeLaFilaDelPlan(p.kind)}${grupo}${claseDeSoltar(ruta, k, esLaArrastrada)}`.trim() || undefined}
        data-fila-del-plan={p.kind} data-fila-arrastrable={arrastrable.draggable ? "parada" : undefined}
        draggable={arrastrable.draggable} onMouseDown={arrastrable.onMouseDown} onTouchStart={arrastrable.onTouchStart}
        onDragStart={arrastrable.onDragStart} onDragEnd={arrastrable.onDragEnd} {...sueltaEnLaFila(ruta, k)}
        style={{ ...(arrastrable.draggable ? { cursor: "grab" } : {}), ...(esLaArrastrada ? { opacity: 0.5 } : {}) }}>
        <td title={p.kind === "P" ? t("Pick up", "Recoger") : t("Deliver", "Entregar")} style={{ borderLeft: `4px solid ${color}`, fontWeight: 700, whiteSpace: "nowrap" }}>
          {/* El número de la parada: el círculo del color del chofer en la primera fila de la parada; la raya, en las demás. */}
          {num.primera
            ? <span className="numero-de-parada" data-numero-de-parada={num.numero} style={{ background: color }}>{num.numero}</span>
            : <span className="numero-de-parada sigue" data-sigue-la-parada={num.numero} style={{ color }} />}
          <b>{p.label}</b>{p.pinned && <span title={t("Pinned", "Fijada")}> 📌</span>}
          {quieta && <span data-no-se-mueve title={t("No longer pending that day (picked up, delivered, canceled or moved): it isn't moved or rewritten", "Ya no está pendiente ese día (recogida, entregada, anulada o movida): no se mueve ni se reescribe")}> 🔒</span>}
        </td>
        <td className="ordno">
          {/* D-456: la FACTURA, que abre la ficha (D-428), y el ID al lado; sin factura, el ID en gris. El tipo de cliente y la
              ciudad de recogida van en sus columnas; «Recoger / Entregar» lo dice la etiqueta P/D (y su título). */}
          {(() => {
            // Sin factura, el ID en gris (el gris que se lee sobre los dos tintes de la fila, D-435).
            const gris = n.esFactura ? {} : { color: "var(--ink-soft)" };
            return (
              <span className="factura-e-id">
                {abrirOrden
                  ? <button type="button" data-abrir-orden data-factura={n.esFactura ? "" : undefined} style={{ background: "none", border: 0, padding: 0, color: "var(--blue, #2563eb)", textDecoration: "underline", cursor: "pointer", font: "inherit", fontWeight: 600, ...gris }} title={t("Open the order", "Abrir la orden")} onClick={() => abrirOrden(p.order_ref)}>{n.principal}</button>
                  : <b data-factura={n.esFactura ? "" : undefined} style={gris}>{n.principal}</b>}
                {n.id && <span data-id-de-la-orden title={n.id}>{n.id}</span>}
              </span>
            );
          })()}
          {/* Una orden partida sale dos veces con el mismo id: sin esto no se sabe cuál carga es cada fila. */}
          {p.carga && <span className="hint" style={{ margin: 0 }}> · {t(`load ${p.carga.numero} of ${p.carga.de}`, `carga ${p.carga.numero} de ${p.carga.de}`)}</span>}
          {/* El 📅 de reprogramar y el ⇄ de relevo, los mismos de la tabla de paradas, después de la factura. */}
          {d && iconosDeLaOrden?.(d)}
        </td>
        {celdaDeCuenta(p.cuenta, ruta.capacidad)}
        {lista.map((c) => celda(c, p, k))}
        {ajuste && (
          <td className="celda-acciones" onClick={(e) => e.stopPropagation()}>
            <div className="acciones-de-parada">
              <button type="button" className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} data-sube-parada disabled={ajuste.ocupado || !cambiaConLaVecina(ordenesDeLaRuta, k, -1, ajuste.noSeMueven)} title={t("Move up", "Subir")} onClick={() => ajuste.mueve({ tipo: "sube", chofer: ruta.choferId, indice: k })}>↑</button>
              <button type="button" className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} data-baja-parada disabled={ajuste.ocupado || !cambiaConLaVecina(ordenesDeLaRuta, k, 1, ajuste.noSeMueven)} title={t("Move down", "Bajar")} onClick={() => ajuste.mueve({ tipo: "baja", chofer: ruta.choferId, indice: k })}>↓</button>
              <button type="button" className="btn btn-ghost btn-sm" style={{ padding: "2px 6px", minHeight: 0 }} disabled={ajuste.ocupado} title={p.pinned ? t("Unpin this order", "Soltar esta orden") : t("Pin this order where it is", "Fijar esta orden donde está")}
                onClick={() => ajuste.mueve({ tipo: p.pinned ? "suelta" : "fija", orden: p.order_ref })}>{p.pinned ? "📌" : "📍"}</button>
              {/* «Pasar a…» en las recogidas Y las entregas: el servidor mueve la orden entera desde cualquiera de las dos. */}
              {!quieta && ajuste.choferes.length > 1 && (
                <select data-pasar-a style={{ width: "auto", maxWidth: 84, padding: "2px 2px", fontSize: 12 }} disabled={ajuste.ocupado} value="" aria-label={t("Move order to another driver", "Pasar la orden a otro chofer")}
                  onChange={(e) => { if (e.target.value) ajuste.mueve({ tipo: "a_chofer", orden: p.order_ref, chofer: e.target.value }); }}>
                  <option value="">{t("Move to…", "Pasar a…")}</option>
                  {ajuste.choferes.filter((c) => c.id !== ruta.choferId).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              )}
            </div>
          </td>
        )}
      </tr>
    );
  };

  /** Las filas de una ruta, como las lee la numeración de paradas: la recogida por su tienda, la entrega por su dirección. */
  function filasDeLaRuta(ruta: RutaVista, cols: ColumnasDeLaRuta | undefined): FilaDelPlanParaParada[] {
    return ruta.paradas.map((p) => ({
      tipo: p.kind,
      orden: p.order_ref,
      tienda: p.kind === "P" ? p.place : null,
      direccion: p.kind === "D" ? cols?.orden(p.order_ref)?.delivery_address ?? null : null,
      tiendaDeDestino: tiendaDeDestino?.(p.order_ref) ?? null,
    }));
  }

  return (
    // `minWidth: 0` aquí y en cada tarjeta: un hijo de grid crece hasta lo que mida su tabla, y con las columnas de Órdenes
    // (D-429) la tabla empujaba la PÁGINA de lado en vez de desplazarse dentro de su caja (medido en el demo: 297 px a 1440).
    <div style={{ display: "grid", gap: 8, marginTop: 6, minWidth: 0 }}>
      {/* Un ⚙ para todas las rutas: las columnas son de la persona, no de cada chofer. */}
      {columnas?.selector && <div data-columnas-del-plan style={{ textAlign: "right" }}>{columnas.selector}</div>}
      {rutas.map((ruta) => {
        const x = ruta.totales;
        const cerrada = !!cerradas[ruta.choferId];
        const numerosDeLaRuta = numeros.get(ruta.choferId) ?? [];
        return (
          <div key={ruta.choferId} data-ruta-del-plan={ruta.choferId} {...sueltaEnLaRuta(ruta)} style={{ minWidth: 0 }}>
            {/* La cabecera de la ruta: UNA línea, sin botón con borde (el texto de siempre, con sus avisos). */}
            <button type="button" onClick={() => setCerradas((c) => ({ ...c, [ruta.choferId]: !cerrada }))}
              style={{ background: "none", border: 0, padding: "2px 2px", width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", font: "inherit", color: "inherit", cursor: "pointer" }}>
              <span>{cerrada ? "▸" : "▾"}</span>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: colorDe(ruta), flex: "0 0 auto" }} />
              <b>{ruta.chofer}</b>
              <span className="hint" style={{ margin: 0 }}>
                {horaDeReloj(x.inicio)}–{horaDeReloj(x.fin)} · {duracion(x.minutos)} · {x.entregas} {t("deliveries", "entregas")} · {x.paradas} {t("stops", "paradas")}
                {" "}· {x.millas} mi · {t("driving", "manejo")} {duracion(x.manejoMin)} · {x.palletsMovidos} {t("pallets moved", "pallets movidos")} · {t("peak load", "carga máxima")} {x.palletsMax}{ruta.capacidad != null ? `/${ruta.capacidad}` : ""}
                {x.esperaMin > 0 && ` · ${t("waiting", "espera")} ${x.esperaMin} min`}
              </span>
              {x.paradasConExceso > 0 && <span className="sema" data-rutas-con-exceso style={{ border: "1px solid var(--red)", color: "var(--red)" }}>⚠ {t(`over capacity at ${x.paradasConExceso} stop(s)`, `se pasa en ${x.paradasConExceso} parada(s)`)}</span>}
              {x.finalNoCero && <span className="sema" style={{ border: "1px solid var(--red)", color: "var(--red)" }}>⚠ {t("doesn’t end at 0", "no acaba en 0")}</span>}
              {x.tardeMin > 0 && <span className="sema" style={{ border: "1px solid var(--red)", color: "var(--red)" }}>{x.tardeMin} {t("min late", "min tarde")}</span>}
            </button>
            {!cerrada && (
              <div className="tbl-scroll" style={{ minWidth: 0, marginTop: 4 }}>
                <table className="orders tabla-de-paradas" data-tabla-del-plan>
                  <thead>
                    <tr>
                      <th>#</th><th data-columna-factura title={t("The invoice opens the order; its ID goes next to it", "La factura abre la orden; al lado va su ID")}>{t("Invoice #", "Factura #")}</th><th data-columna-cuenta title={t("Pallets: before ± stop = after · free", "Pallets: antes ± parada = después · libres")}>{t("Pallets", "Pallets")}</th>
                      {lista.map((c) => <th key={c.key} data-columna-del-plan={c.key}>{rotulo(c)}</th>)}
                      {ajuste && <th>{t("Adjust", "Ajustar")}</th>}
                    </tr>
                  </thead>
                  <tbody>{filaDeBase(ruta, "salida")}{ruta.paradas.map((p, k) => fila(p, k, ruta, numerosDeLaRuta[k]))}{filaDeBase(ruta, "regreso")}</tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
