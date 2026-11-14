"use client";

import { useEffect, useState } from "react";
import { textoDeMarca } from "@/lib/marca-de-agua";
import "./marca-de-agua.css";

/** Cuántas celdas de texto cubren la pantalla girada. Sobra a propósito: en una pantalla grande aún cubren. */
const CELDAS = 320;

/**
 * La marca de agua de las apps sensibles (ver `lib/marca-de-agua.ts`). Se monta desde cada layout que la
 * lleva. No intercepta clics (`pointer-events: none`), no se puede seleccionar el texto y no sale al imprimir.
 *
 * Se pinta solo en el navegador: la hora cambia, y el servidor no sabe en qué zona horaria está quien mira.
 * La hora se refresca al cambiar de minuto.
 */
export function MarcaDeAgua({ nombre }: { nombre: string }) {
  const [ahora, setAhora] = useState<Date | null>(null);

  useEffect(() => {
    setAhora(new Date());
    let intervalo: ReturnType<typeof setInterval> | undefined;
    // Primero se espera al próximo cambio de minuto, y desde ahí cada minuto exacto.
    const alCambiarMinuto = setTimeout(() => {
      const tick = () => setAhora(new Date());
      tick();
      intervalo = setInterval(tick, 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      clearTimeout(alCambiarMinuto);
      if (intervalo !== undefined) clearInterval(intervalo);
    };
  }, []);

  if (!ahora) return null;

  const texto = textoDeMarca(nombre, ahora);
  return (
    <div className="marca-de-agua" aria-hidden="true">
      <div className="marca-de-agua__tinta">
        {Array.from({ length: CELDAS }, (_, i) => (
          <span key={i}>{texto}</span>
        ))}
      </div>
    </div>
  );
}
