"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { PrefsProvider } from "@/lib/prefs";
import { esRutaDeTarjeta } from "@/lib/tarjetas/ruta";

/**
 * Por qué existe este fichero (la tarjeta pública no debe montar ni pedir nada del hub).
 *
 * El layout raíz envuelve TODAS las páginas, también `/tarjeta/...`. Antes, la tarjeta solo ocultaba el hub con CSS,
 * así que sus componentes se montaban igual y pedían `/api/impersonate/*`, `/api/security/seen`, el manifest, etc.
 * Ahora el layout raíz pasa su chrome del hub por estos dos componentes: en una ruta de tarjeta no se renderiza
 * (ni el proveedor de preferencias ni el chrome), así que el servidor manda el HTML de la tarjeta sin nada del hub
 * y el navegador no monta ningún efecto del hub. En cualquier otra ruta el resultado es el mismo árbol de antes.
 *
 * Se decide con `useSelectedLayoutSegment`, no con `usePathname`: en el dominio de las tarjetas la URL es `/<slug>` y
 * el middleware la reescribe a `/tarjeta/<slug>`; `usePathname` seguía dando `/<slug>` en el servidor y el chrome
 * salía en el HTML, mientras que el segmento casado es `tarjeta`. Lo decide el servidor, así que el HTML inicial
 * ya sale sin el hub. Si cambia de ruta de hub a tarjeta dentro de la misma sesión (solo pasa por la previsualización),
 * el árbol se desmonta y se vuelve a montar: es lo esperado.
 */

/** El `PrefsProvider` solo para el hub: la tarjeta no lee preferencias de la persona. */
export function PrefsSegunRuta({ children }: { children: ReactNode }) {
  const segmento = useSelectedLayoutSegment();
  if (esRutaDeTarjeta(segmento)) return <>{children}</>;
  return <PrefsProvider>{children}</PrefsProvider>;
}

/** Un trozo del chrome del hub (burbujas, avisos, versión): no existe en las rutas de tarjeta. */
export function SoloEnHub({ children }: { children: ReactNode }) {
  const segmento = useSelectedLayoutSegment();
  if (esRutaDeTarjeta(segmento)) return null;
  return <>{children}</>;
}
