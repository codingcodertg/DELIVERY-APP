/**
 * ¿Es la página de la tarjeta pública? Recibe el primer segmento de la ruta que Next ha CASADO (no la URL del
 * navegador): en el dominio de las tarjetas el middleware reescribe `/<slug>` a `/tarjeta/<slug>` y la URL sigue
 * siendo `/<slug>`, así que solo el segmento casado dice de qué página se trata. Vale igual para `/tarjeta/...` abierto
 * en el dominio del hub (las previsualizaciones).
 *
 * El layout raíz lo usa para no montar ni pedir nada del hub en estas rutas (ver `components/HubSegunRuta.tsx`).
 */
export function esRutaDeTarjeta(segmento: string | null | undefined): boolean {
  return segmento === "tarjeta";
}
