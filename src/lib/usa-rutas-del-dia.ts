"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/data-provider";
import { createClient } from "@/lib/supabase/client";
import { ciudadesConocidas } from "@/lib/ciudad-de-entrega";
import { leeRutasDelDia, paradasDeLasOrdenes, type ClienteDeRutas, type OrigenDeLasRutas, type ParadaDelDia } from "@/lib/rutas-del-dia";

const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
/** Cada cuánto se relee con la pestaña a la vista. Es una consulta a la base, no una llamada a mapas. */
const RELEE_CADA_MS = 60_000;

/**
 * Las paradas del día que pinta «Ruta de hoy» (D-NEXT), y de dónde salieron.
 *
 *   · Con la migración 160 aplicada: `rutas_del_dia(fecha)` — las rutas ENTERAS, lo mínimo de cada parada, para cualquier
 *     rol con el módulo. Una consulta al entrar, otra al cambiar de día, al volver a la pestaña, cuando cambia algo de lo
 *     que la persona ya recibe en vivo, y cada minuto con la pestaña a la vista.
 *   · Sin la 160 (o si falla): lo que la RLS de cada quien ya le deja leer, por la MISMA proyección (`paradasDeLasOrdenes`).
 *     El chofer verá solo su ruta y almacén no verá las pendientes; la pantalla se lo dice al admin.
 *   · En el demo (sin base): las órdenes del demo, por la misma proyección.
 */
export function useRutasDelDia(fecha: string): { paradas: ParadaDelDia[]; origen: OrigenDeLasRutas | null } {
  const { deliveries, settings } = useData();
  const [leido, setLeido] = useState<{ fecha: string; origen: OrigenDeLasRutas; paradas: ParadaDelDia[] } | null>(null);
  const [vuelta, setVuelta] = useState(0);
  const relee = useCallback(() => setVuelta((n) => n + 1), []);

  // Algo de lo que esta persona recibe en vivo cambió (una orden suya, o cualquiera si las lee todas): se relee, sin prisa.
  const primera = useRef(true);
  useEffect(() => {
    if (SIN_BASE) return;
    if (primera.current) { primera.current = false; return; }
    const id = setTimeout(relee, 1500);
    return () => clearTimeout(id);
  }, [deliveries, relee]);
  useEffect(() => {
    if (SIN_BASE) return;
    const alVolver = () => { if (document.visibilityState === "visible") relee(); };
    window.addEventListener("focus", alVolver);
    document.addEventListener("visibilitychange", alVolver);
    const id = setInterval(alVolver, RELEE_CADA_MS);
    return () => { window.removeEventListener("focus", alVolver); document.removeEventListener("visibilitychange", alVolver); clearInterval(id); };
  }, [relee]);

  useEffect(() => {
    if (SIN_BASE) return;
    let vivo = true;
    void leeRutasDelDia(createClient() as unknown as ClienteDeRutas, fecha).then((r) => {
      if (!vivo) return;
      const paradas = r.origen === "funcion" ? r.paradas : [];
      // Si llegó lo mismo, se conserva la lista de antes: releer cada minuto no puede mover nada de lo que cuelga de ella
      // (la medida de cada ruta se pide por su FORMA, pero ni siquiera se vuelve a preguntar).
      setLeido((antes) => (antes && antes.fecha === fecha && antes.origen === r.origen && JSON.stringify(antes.paradas) === JSON.stringify(paradas) ? antes : { fecha, origen: r.origen, paradas }));
    });
    return () => { vivo = false; };
  }, [fecha, vuelta]);

  // Lo que ya se podía leer, por la misma proyección: el demo, y el respaldo cuando la función no está.
  const deLoQueLee = useMemo(
    () => paradasDeLasOrdenes(deliveries, fecha, settings.stores ?? [], ciudadesConocidas(deliveries.map((d) => d.delivery_address))),
    [deliveries, fecha, settings.stores],
  );

  if (SIN_BASE) return { paradas: deLoQueLee, origen: "demo" };
  // Otro día aún sin leer: nada que pintar todavía (no se enseña el día anterior con la fecha nueva).
  if (!leido || leido.fecha !== fecha) return { paradas: [], origen: null };
  if (leido.origen === "funcion") return { paradas: leido.paradas, origen: "funcion" };
  return { paradas: deLoQueLee, origen: leido.origen };
}
