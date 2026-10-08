"use client";

import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useCierraAlSalir } from "@/lib/menu-desplegable";
import { altoDelMenu, colocacionDelMenu, focoAlTeclear } from "@/lib/menu-de-acciones";

/** Una opción del menú, ya traducida. Qué opciones hay lo decide quien lo usa. */
export type OpcionDelMenu = {
  id: string;
  texto: string;
  /** El `title` que tenía el botón, si lo tenía. */
  titulo?: string | null;
  /** Destructiva: en rojo, y con una raya que la separa de las de arriba. */
  peligro?: boolean;
  /** Por qué no se puede pulsar ahora. Sale en el `title` y la opción no hace nada. `null` = se puede. */
  deshabilitada?: string | null;
  alPulsar: () => void;
};

/** ¿Lleva raya? Solo si hay destructivas Y algo encima de ellas: una raya arriba del todo no separa nada. */
function indiceDeLaRaya(opciones: readonly OpcionDelMenu[]): number {
  const i = opciones.findIndex((o) => o.peligro);
  return i > 0 ? i : -1;
}

/**
 * Las opciones, tal cual se pintan dentro del menú. Aparte del armazón para que las pruebas las rendericen sin
 * navegador (`renderToStaticMarkup`) y comprueben lo que lee un lector de pantalla: `menuitem`, `aria-disabled` y
 * el motivo en el `title`.
 */
export function OpcionesDelMenu({ opciones, onElegir }: { opciones: readonly OpcionDelMenu[]; onElegir: (o: OpcionDelMenu) => void }) {
  const raya = indiceDeLaRaya(opciones);
  return (
    <>
      {opciones.map((o, i) => (
        <Fragment key={o.id}>
          {i === raya && <div role="separator" className="menu-acciones-raya" />}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-accion={o.id}
            className={"col-opt menu-accion" + (o.peligro ? " menu-accion-peligro" : "")}
            // `aria-disabled` y no `disabled`: una opción apagada sigue recibiendo el foco con las flechas (así se
            // descubre que existe) y su `title` sale al pasar el ratón, cosa que un `disabled` no garantiza.
            aria-disabled={o.deshabilitada ? true : undefined}
            title={o.deshabilitada ?? o.titulo ?? undefined}
            onClick={() => onElegir(o)}
          >
            {o.texto}
          </button>
        </Fragment>
      ))}
    </>
  );
}

/**
 * El botón «Acciones ▾» y su menú (D-497). Imita el menú de cuenta (`MenuDeCuenta`): las mismas clases
 * (`.col-menu`, `.col-opt`), el ▾ y `aria-expanded`; y usa el cierre de los menús de Órdenes
 * (`useCierraAlSalir`: clic fuera y Escape). Añade lo que aquel no tiene y una lista de acciones necesita:
 *
 * - **Teclado**: ↓/↑ en el botón lo abren con el foco en la primera/última opción; dentro, ↓ ↑ Inicio Fin
 *   recorren las opciones (`focoAlTeclear`); Escape y Tab lo cierran y el foco vuelve al botón.
 * - **Elegir cierra** el menú antes de hacer la acción.
 * - **Teléfono**: opciones de 44 px de alto, y el menú en un portal con `position: fixed` colocado para no
 *   salirse de la ventana (`colocacionDelMenu`). Como queda fijo, si la ficha se desplaza se cierra: un menú
 *   flotando lejos de su botón no se sabe de dónde salió.
 */
export function MenuDeAcciones({
  rotulo,
  opciones,
  className = "btn btn-ghost",
}: {
  rotulo: string;
  opciones: readonly OpcionDelMenu[];
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [estilo, setEstilo] = useState<CSSProperties>({});
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const alAbrir = useRef<"primera" | "ultima">("primera");
  const id = useId();

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

  const cerrar = () => {
    // Si el foco estaba dentro, vuelve al botón: si no, se iría al <body> y el teclado empezaría de cero.
    if (menu.current?.contains(document.activeElement)) boton.current?.focus();
    setAbierto(false);
  };
  useCierraAlSalir(abierto, cerrar, () => [boton.current, menu.current]);

  // Fijo a la ventana: si la ficha se desplaza o la ventana cambia, se cierra. El desplazamiento DENTRO del menú
  // (cuando no cabe entero) no cuenta.
  useEffect(() => {
    if (!abierto) return;
    const alMoverse = (ev: Event) => {
      if (ev.target instanceof Node && menu.current?.contains(ev.target)) return;
      setAbierto(false);
    };
    window.addEventListener("resize", alMoverse);
    document.addEventListener("scroll", alMoverse, true);
    return () => {
      window.removeEventListener("resize", alMoverse);
      document.removeEventListener("scroll", alMoverse, true);
    };
  }, [abierto]);

  // Al abrir, el foco entra en el menú (el patrón «menu button»): en la primera opción, o en la última con ↑.
  useEffect(() => {
    if (!abierto) return;
    const lista = items();
    (alAbrir.current === "ultima" ? lista[lista.length - 1] : lista[0])?.focus({ preventScroll: true });
  }, [abierto]);

  const abrir = (foco: "primera" | "ultima") => {
    const b = boton.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const rayas = indiceDeLaRaya(opciones) > 0 ? 1 : 0;
    setEstilo(colocacionDelMenu(
      { top: r.top, bottom: r.bottom, right: r.right },
      { ancho: window.innerWidth, alto: window.innerHeight },
      altoDelMenu(opciones.length, rayas),
    ));
    alAbrir.current = foco;
    setAbierto(true);
  };

  const alTeclearEnElBoton = (ev: KeyboardEvent<HTMLButtonElement>) => {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    ev.preventDefault();
    abrir(ev.key === "ArrowUp" ? "ultima" : "primera");
  };

  const alTeclearEnElMenu = (ev: KeyboardEvent<HTMLDivElement>) => {
    // Tab sale del menú: se cierra con el foco en el botón, y el Tab sigue desde ahí.
    if (ev.key === "Tab") { cerrar(); return; }
    const lista = items();
    const siguiente = focoAlTeclear(ev.key, lista.indexOf(document.activeElement as HTMLButtonElement), lista.length);
    if (siguiente == null) return;
    ev.preventDefault();
    lista[siguiente]?.focus();
  };

  const elegir = (o: OpcionDelMenu) => {
    if (o.deshabilitada) return;
    cerrar();
    o.alPulsar();
  };

  if (opciones.length === 0) return null;
  return (
    <>
      <button
        ref={boton}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? id : undefined}
        data-menu-de-acciones
        onClick={() => (abierto ? cerrar() : abrir("primera"))}
        onKeyDown={alTeclearEnElBoton}
      >
        {rotulo} <span aria-hidden>▾</span>
      </button>
      {abierto && createPortal(
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={rotulo}
          className="col-menu menu-acciones"
          style={estilo}
          onKeyDown={alTeclearEnElMenu}
        >
          <OpcionesDelMenu opciones={opciones} onElegir={elegir} />
        </div>,
        document.body,
      )}
    </>
  );
}
