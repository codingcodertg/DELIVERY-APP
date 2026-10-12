"use client";

import { useRef, useState } from "react";
import { compress } from "@/components/PhotoUpload";

// ============================================================
// La cámara de «Entregado» (D-NEXT). El dueño, 2026-10-11: «when you pres deliverd it should open the camera so you can
// add the proof of delikvery for the driver».
//
// El navegador solo abre la cámara si el `.click()` del `<input type="file" capture>` ocurre DENTRO del gesto del usuario:
// en el mismo manejador del clic y sin nada asíncrono antes. Un `useEffect` después (o un `await`) no vale en iOS Safari:
// el selector no se abre y no hay error que ver. Por eso esto es un gancho que devuelve el `<input>` —que quien lo usa
// pinta SIEMPRE, antes del clic— y `abrir()`, que se llama lo primero en el manejador del botón.
//
// Las fotos se comprimen igual que en `PhotoUpload` (la misma función: 1280 px, JPEG 0,7). Si el chofer cancela la cámara
// no pasa nada aquí: quien llama ya abrió el paso de la prueba de entrega a la vez, y ese paso sigue pidiendo la foto si la
// oficina la exige (`podSinCumplir`), o deja confirmar sin ella si no.
// ============================================================

export function useCamaraDeEntrega(alTomar: (fotos: string[]) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const [procesando, setProcesando] = useState(false);

  /** Abre la cámara. Llamarlo lo PRIMERO del manejador del clic, antes de cualquier `await`. */
  const abrir = () => {
    const input = ref.current;
    if (!input) return false;
    input.value = "";
    input.click();
    return true;
  };

  const alElegir = async (files: FileList | null) => {
    if (!files?.length) return;
    setProcesando(true);
    const fotos: string[] = [];
    try {
      for (const f of [...files]) {
        if (!f.type.startsWith("image/")) continue;
        try { fotos.push(await compress(f)); } catch { /* una foto que no se lee se salta, como en PhotoUpload */ }
      }
      if (fotos.length) alTomar(fotos);
    } finally {
      setProcesando(false);
      if (ref.current) ref.current.value = "";
    }
  };

  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      capture="environment"
      hidden
      data-camara-de-entrega=""
      onChange={(e) => void alElegir(e.target.files)}
    />
  );

  return { abrir, input, procesando };
}
