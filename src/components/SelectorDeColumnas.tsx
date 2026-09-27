"use client";

import { useRef, useState, type ComponentProps } from "react";
import { useCierraAlSalir } from "@/lib/menu-desplegable";
import { PlantillasDeColumnas } from "@/components/PlantillasDeColumnas";

/**
 * El ⚙ Columnas de las tablas del Gestor de Rutas (D-379), con el mismo aspecto que el de Órdenes (`.col-menu`, `.col-opt`).
 *
 * Por qué es un componente y no un trozo de la página: el de la tabla de paradas se pinta UNA VEZ POR CHOFER, dentro de un
 * `map`, y colgaba de un solo estado y una sola `ref` de la página. Medido en el demo (2026-09-23, 4 choferes): pulsar el ⚙
 * de una tarjeta abría los cuatro, y la `ref` apuntaba a la caja de la ÚLTIMA tarjeta, así que el `mousedown` sobre una
 * casilla de cualquier otra contaba como «clic fuera» y cerraba el menú antes de que la casilla se marcara. Aquí cada ⚙
 * tiene su propio estado y su propia caja.
 *
 * Y por qué `.col-opt`: el `label` y el `input` de la app llevan estilo de formulario (mayúsculas, `width: 100%` y relleno
 * en la casilla). Un `label` suelto dentro del menú los heredaba: rótulos en mayúsculas, casillas de 130 px empujando el
 * texto, «SO #» partido en dos renglones. `.col-opt` es el que ya los neutraliza en el menú de Órdenes.
 */
export function SelectorDeColumnas<C extends { key: string; en: string; es: string; fija?: true }>({
  columnas, elegidas, onAlterna, rotulo, titulo, nota, t, alLado = "derecha", plantillas, mover,
}: {
  columnas: readonly C[];
  elegidas: readonly string[];
  onAlterna: (key: string) => void;
  rotulo: (c: C) => string;
  titulo: string;
  nota: string;
  t: (en: string, es: string) => string;
  /** Hacia dónde se abre: a la derecha del botón queda pegado a su borde derecho, y al revés. */
  alLado?: "derecha" | "izquierda";
  /** Las plantillas (D-394): el mismo bloque que en Órdenes, arriba del todo. Sin esto, el menú no las enseña. */
  plantillas?: Omit<ComponentProps<typeof PlantillasDeColumnas>, "t">;
  /**
   * MOVER columnas (D-410): las flechas ↑ ↓ de Órdenes (D-332) y Promos (D-385), con el mismo marcado —`.col-opt` con
   * `flex: 1` y dos `btn btn-ghost btn-sm`—, y «Restablecer orden» en la cabecera cuando hay orden propio. Lo que mueve lo
   * decide la página (`mueveEnElGestor`): aquí solo se pinta. `columnas` llega ya en el orden de la persona. Una columna
   * `fija` sale con la casilla marcada y apagada: se mueve, no se quita.
   */
  mover?: { seMueve: (key: string, delta: -1 | 1) => boolean; onMueve: (key: string, delta: -1 | 1) => void; ordenPropio: boolean; onRestablece: () => void };
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useCierraAlSalir(abierto, () => setAbierto(false), () => [caja.current]);
  return (
    <div ref={caja} style={{ position: "relative", display: "inline-block", textAlign: "left" }}>
      <button className="btn btn-ghost btn-sm" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>⚙ {t("Columns", "Columnas")}</button>
      {abierto && (
        <div className="col-menu" style={alLado === "izquierda" ? { left: 0, right: "auto" } : undefined}>
          <div className="col-menu-head">
            <b>{titulo}</b>
            {mover?.ordenPropio && <button className="notif-clear" onClick={mover.onRestablece}>{t("Reset order", "Restablecer orden")}</button>}
          </div>
          {plantillas && <PlantillasDeColumnas {...plantillas} t={t} />}
          {columnas.map((c) => mover ? (
            <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <label className="col-opt" style={{ flex: 1 }} title={c.fija ? t("Always shown", "Siempre visible") : undefined}>
                <input type="checkbox" checked={!!c.fija || elegidas.includes(c.key)} disabled={!!c.fija} onChange={() => onAlterna(c.key)} />
                {rotulo(c)}
              </label>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!mover.seMueve(c.key, -1)} aria-label={t(`Move ${c.en} up`, `Subir ${c.es}`)} onClick={() => mover.onMueve(c.key, -1)}>↑</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!mover.seMueve(c.key, 1)} aria-label={t(`Move ${c.en} down`, `Bajar ${c.es}`)} onClick={() => mover.onMueve(c.key, 1)}>↓</button>
            </div>
          ) : (
            <label key={c.key} className="col-opt">
              <input type="checkbox" checked={elegidas.includes(c.key)} onChange={() => onAlterna(c.key)} />
              {rotulo(c)}
            </label>
          ))}
          <div className="hint" style={{ margin: 0, padding: "6px 8px 2px" }}>{nota}</div>
        </div>
      )}
    </div>
  );
}
