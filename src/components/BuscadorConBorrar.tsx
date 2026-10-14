"use client";

import { forwardRef, useRef, type Ref } from "react";
import { usePrefs } from "@/lib/prefs";
import { BORRAR_BUSQUEDA, BUSQUEDA_VACIA, hayTextoQueBorrar } from "@/lib/buscador";

/**
 * Un buscador de órdenes con una «✕» dentro, a la derecha, que lo vacía de un golpe (D-546): el dueño, *«it would
 * be easier to have an x to clear instead of having to backspace»*. La «✕» solo está cuando hay texto, y al
 * pulsarla el foco se queda en el campo para escribir la búsqueda siguiente.
 *
 * Los colores salen de clases de `globals.css` (`.buscador-con-borrar`), no de `style`: la guarda de colores a pelo
 * (`inline-colors.test.ts`) cuenta cada uno. El `ref` se reenvía al `<input>` (la tecla «/» de Órdenes lo enfoca).
 */
export const BuscadorConBorrar = forwardRef(function BuscadorConBorrar(
  { valor, onValor, placeholder, maxWidth }: {
    valor: string;
    onValor: (v: string) => void;
    placeholder?: string;
    maxWidth?: number;
  },
  ref: Ref<HTMLInputElement>,
) {
  const { t } = usePrefs();
  const propio = useRef<HTMLInputElement | null>(null);
  const engancha = (el: HTMLInputElement | null) => {
    propio.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as { current: HTMLInputElement | null }).current = el;
  };
  return (
    <span className="buscador-con-borrar" style={{ maxWidth }}>
      <input ref={engancha} value={valor} placeholder={placeholder} onChange={(e) => onValor(e.target.value)} />
      {hayTextoQueBorrar(valor) && (
        <button
          type="button"
          className="buscador-con-borrar-x"
          data-borrar-busqueda
          aria-label={t(BORRAR_BUSQUEDA.en, BORRAR_BUSQUEDA.es)}
          title={t(BORRAR_BUSQUEDA.en, BORRAR_BUSQUEDA.es)}
          // El foco no sale del campo: sin esto el clic lo pasa al botón, que desaparece al vaciarse.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { onValor(BUSQUEDA_VACIA); propio.current?.focus(); }}
        >
          ✕
        </button>
      )}
    </span>
  );
});
