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
export function SelectorDeColumnas<C extends { key: string }>({
  columnas, elegidas, onAlterna, rotulo, titulo, nota, t, alLado = "derecha", plantillas,
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
  /** Las plantillas (D-NEXT): el mismo bloque que en Órdenes, arriba del todo. Sin esto, el menú no las enseña. */
  plantillas?: Omit<ComponentProps<typeof PlantillasDeColumnas>, "t">;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useCierraAlSalir(abierto, () => setAbierto(false), () => [caja.current]);
  return (
    <div ref={caja} style={{ position: "relative", display: "inline-block", textAlign: "left" }}>
      <button className="btn btn-ghost btn-sm" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>⚙ {t("Columns", "Columnas")}</button>
      {abierto && (
        <div className="col-menu" style={alLado === "izquierda" ? { left: 0, right: "auto" } : undefined}>
          <div className="col-menu-head"><b>{titulo}</b></div>
          {plantillas && <PlantillasDeColumnas {...plantillas} t={t} />}
          {columnas.map((c) => (
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
