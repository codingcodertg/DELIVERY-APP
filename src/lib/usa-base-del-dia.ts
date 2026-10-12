"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { guardaBaseDelDia, leeBasesDelDia, type BaseDelDia, type ClienteDeBasesDelDia } from "@/lib/base-del-dia";

/**
 * Lo elegido para el día que se mira en el Gestor: de qué tienda sale y en cuál termina cada chofer (165,
 * `driver_day_bases`; las reglas, en `base-del-dia.ts`). Lo lee el Gestor, «Ruta de hoy» y el mapa de «Mi ruta» (cada uno lo
 * que su RLS le deja: un chofer, lo suyo) y lo escribe el gerente de logística o el admin desde el panel «Choferes y rutas».
 *
 * `fuente`: «base» (la tabla está y se leyó), «sin_tabla» (la 165 aún no se aplicó: cada chofer en su base, y el selector se
 * apaga y lo dice), «error» (la lectura falló: lo mismo, con su porqué), «demo» (sin base: lo elegido vive en esta pestaña,
 * para poder probarlo) y «cargando».
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/** El demo no tiene base: lo elegido vive en ESTA pestaña (`sessionStorage`), y sobrevive a cambiar de pantalla o recargar. */
const LLAVE_DEL_DEMO = "rtg_demo_bases_del_dia";
const leeDelDemo = (): Record<string, Record<string, BaseDelDia>> => {
  try { return JSON.parse(sessionStorage.getItem(LLAVE_DEL_DEMO) ?? "{}") as Record<string, Record<string, BaseDelDia>>; } catch { return {}; }
};
const guardaDelDemo = (todo: Record<string, Record<string, BaseDelDia>>) => {
  try { sessionStorage.setItem(LLAVE_DEL_DEMO, JSON.stringify(todo)); } catch { /* sin almacén: dura lo que la pantalla */ }
};

export type FuenteDeBasesDelDia = "base" | "sin_tabla" | "error" | "demo" | "cargando";

export interface BasesDelDiaLeidas {
  bases: Readonly<Record<string, BaseDelDia>>;
  fuente: FuenteDeBasesDelDia;
  detalle?: string;
}

export function useBasesDelDia(fecha: string, activo = true) {
  const [estado, setEstado] = useState<BasesDelDiaLeidas>({ bases: {}, fuente: "cargando" });
  const cliente = () => createClient() as unknown as ClienteDeBasesDelDia;

  const lee = useCallback(async (): Promise<BasesDelDiaLeidas> => {
    if (LOCAL_MODE) return { bases: { ...(leeDelDemo()[fecha] ?? {}) }, fuente: "demo" };
    const r = await leeBasesDelDia(cliente(), fecha);
    if (r.fuente === "base") return { bases: r.bases, fuente: "base" };
    return { bases: {}, fuente: r.fuente, ...(r.fuente === "error" ? { detalle: r.detalle } : {}) };
  }, [fecha]);

  useEffect(() => {
    if (!activo || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { setEstado({ bases: {}, fuente: "cargando" }); return; }
    let vivo = true;
    setEstado({ bases: {}, fuente: "cargando" });
    void lee().then((e) => { if (vivo) setEstado(e); });
    return () => { vivo = false; };
  }, [fecha, activo, lee]);

  /** Guarda lo elegido para un chofer ese día (`baseTrasElCambio` ya limpio; `null` = vuelve a lo de siempre) y vuelve a leer,
   *  para ver también lo que cambió otra persona. Si falla, no cambia nada y devuelve el porqué. */
  const guarda = async (choferId: string, nueva: BaseDelDia | null): Promise<{ ok: true } | { ok: false; detalle: string; faltaLaTabla: boolean }> => {
    if (LOCAL_MODE) {
      const todo = leeDelDemo();
      const delDia = { ...(todo[fecha] ?? {}) };
      if (nueva) delDia[choferId] = nueva; else delete delDia[choferId];
      guardaDelDemo({ ...todo, [fecha]: delDia });
      setEstado({ bases: { ...delDia }, fuente: "demo" });
      return { ok: true };
    }
    const r = await guardaBaseDelDia(cliente(), fecha, choferId, nueva);
    if (!r.ok) return r;
    setEstado(await lee());
    return { ok: true };
  };

  return { ...estado, guarda };
}
