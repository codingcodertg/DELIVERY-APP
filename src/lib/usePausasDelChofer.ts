"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { centralWallToUtc } from "@/lib/clockin/tz";
import { shiftDateISO } from "@/lib/utils";
import { faltaLaTabla } from "@/lib/encuesta";
import {
  guardaPausasLocales, horaDeCierre, leePausasLocales,
  type CierreDePausa, type MotivoDePausa, type PausaDelChofer,
} from "@/lib/pausas-del-chofer";

/**
 * Leer y escribir las pausas de UN chofer en UN día (D-520). Lo usan «Mi ruta» (las suyas, hoy) y el Recorrido de
 * logística (las del chofer y el día que se miran).
 *
 * - **Con base**: la tabla `public.pausas_del_chofer` de la 167, con su RLS: el chofer escribe y lee las suyas; admin,
 *   logística y gerentes leen todas. Sin la 167 aplicada, la lectura y la escritura contestan «no existe la tabla»
 *   (`faltaLaTabla`): el estado lo dice y la pantalla sigue.
 * - **Sin base** (el demo) **o en el modo enseñanza**: en el `localStorage` de este navegador, como las encuestas del demo.
 *   Nada de lo que se practica llega a nadie.
 *
 * El día es el del negocio (America/Chicago), con los mismos límites que el Recorrido (`centralWallToUtc`).
 */

const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
export const TABLA_DE_PAUSAS = "pausas_del_chofer";

export type EstadoDePausas = "cargando" | "lista" | "sin-tabla" | "error";
export type ResultadoDePausa = { ok: true; pausa: PausaDelChofer } | { ok: false; sinTabla: boolean; mensaje: string };
export interface Ubicacion { lat: number; lng: number; accuracy?: number | null }

const almacen = () => (typeof window === "undefined" ? null : window.localStorage);
const limites = (dia: string) => ({ desde: centralWallToUtc(`${dia}T00:00`), hasta: centralWallToUtc(`${shiftDateISO(dia, 1)}T00:00`) });
const fallo = (e: { code?: string; message?: string } | null | undefined): ResultadoDePausa =>
  ({ ok: false, sinTabla: faltaLaTabla(e), mensaje: e?.message ?? "error" });

export function usePausasDelChofer(driverId: string | null | undefined, dia: string, opciones: { practica?: boolean } = {}) {
  const local = SIN_BASE || !!opciones.practica;
  const [pausas, setPausas] = useState<PausaDelChofer[]>([]);
  const [estado, setEstado] = useState<EstadoDePausas>("cargando");

  useEffect(() => {
    let vivo = true;
    setPausas([]);
    if (!driverId) { setEstado("lista"); return; }
    setEstado("cargando");
    const { desde, hasta } = limites(dia);
    if (local) {
      const desdeMs = Date.parse(desde), hastaMs = Date.parse(hasta);
      setPausas(leePausasLocales(almacen()).filter((p) => p.driver_id === driverId && Date.parse(p.empezo_at) >= desdeMs && Date.parse(p.empezo_at) < hastaMs));
      setEstado("lista");
      return;
    }
    void (async () => {
      const { data, error } = await createClient().from(TABLA_DE_PAUSAS).select("*")
        .eq("driver_id", driverId).gte("empezo_at", desde).lt("empezo_at", hasta).order("empezo_at", { ascending: true });
      if (!vivo) return;
      if (error) { setEstado(faltaLaTabla(error) ? "sin-tabla" : "error"); return; }
      setPausas((data ?? []) as PausaDelChofer[]);
      setEstado("lista");
    })();
    return () => { vivo = false; };
  }, [driverId, dia, local]);

  /** Sustituye (o añade) una fila en lo que se pinta y, en local, en el navegador. */
  const pon = useCallback((p: PausaDelChofer) => {
    setPausas((prev) => (prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]));
    if (local) {
      const todas = leePausasLocales(almacen());
      guardaPausasLocales(almacen(), todas.some((x) => x.id === p.id) ? todas.map((x) => (x.id === p.id ? p : x)) : [...todas, p]);
    }
  }, [local]);

  // `recibo_foto` (D-523): la del recibo de gasolina, si la tomó al registrar la parada. La base solo la admite en una de
  // gasolina (`pausas_recibo_solo_gasolina`, 167); quien llama la manda `null` en las demás.
  const empezar = useCallback(async (inicio: { motivo: MotivoDePausa; nota: string | null; recibo_foto?: string | null }, gps: Ubicacion | null): Promise<ResultadoDePausa> => {
    if (!driverId) return { ok: false, sinTabla: false, mensaje: "no driver" };
    const ubicacion = { lat: gps?.lat ?? null, lng: gps?.lng ?? null, precision_m: gps?.accuracy ?? null };
    if (local) {
      const ahora = new Date().toISOString();
      const p: PausaDelChofer = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, driver_id: driverId, ...inicio, ...ubicacion,
        empezo_at: ahora, termino_at: null, recibo_foto: inicio.recibo_foto ?? null, recibo_monto: null, recibo_galones: null, sin_recibo: false, created_at: ahora,
      };
      pon(p);
      return { ok: true, pausa: p };
    }
    // La hora de inicio la pone la base (`default now()`): la de un teléfono puede ir adelantada o atrasada.
    const { data, error } = await createClient().from(TABLA_DE_PAUSAS)
      .insert({ driver_id: driverId, ...inicio, recibo_foto: inicio.recibo_foto ?? null, ...ubicacion }).select("*").single();
    if (error || !data) return fallo(error);
    pon(data as PausaDelChofer);
    if (estado !== "lista") setEstado("lista");
    return { ok: true, pausa: data as PausaDelChofer };
  }, [driverId, local, pon, estado]);

  const seguir = useCallback(async (p: PausaDelChofer, cierre: CierreDePausa): Promise<ResultadoDePausa> => {
    const cambio = { termino_at: horaDeCierre(p.empezo_at), ...cierre };
    if (local) {
      const q = { ...(leePausasLocales(almacen()).find((x) => x.id === p.id) ?? p), ...cambio };
      pon(q);
      return { ok: true, pausa: q };
    }
    const { data, error } = await createClient().from(TABLA_DE_PAUSAS).update(cambio).eq("id", p.id).select("*").single();
    if (error || !data) return fallo(error);
    pon(data as PausaDelChofer);
    return { ok: true, pausa: data as PausaDelChofer };
  }, [local, pon]);

  /** La ubicación que llegó tarde, en silencio, como en «Recogido» (D-218): el chofer ya siguió con lo suyo. Se aplica
   *  sobre la fila de AHORA, no sobre la de cuando empezó: si ya pulsó «Seguir», no se le reabre. En la base, la RLS solo
   *  deja tocar la pausa abierta, así que una ubicación que llega con la pausa ya cerrada se pierde sin ruido. */
  const ubicarTarde = useCallback(async (id: string, gps: Ubicacion) => {
    const cambio = { lat: gps.lat, lng: gps.lng, precision_m: gps.accuracy ?? null };
    if (local) {
      const actual = leePausasLocales(almacen()).find((x) => x.id === id);
      if (actual) pon({ ...actual, ...cambio });
      return;
    }
    const { data } = await createClient().from(TABLA_DE_PAUSAS).update(cambio).eq("id", id).select("*").single();
    if (data) pon(data as PausaDelChofer);
  }, [local, pon]);

  return { pausas, estado, empezar, seguir, ubicarTarde };
}
