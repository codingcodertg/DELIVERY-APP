"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { centralWallToUtc } from "@/lib/clockin/tz";
import { shiftDateISO } from "@/lib/utils";
import { faltaLaTabla } from "@/lib/encuesta";
import {
  esParadaVieja, guardaPausasLocales, horaDeCierreDe, horaDeCierreDeVieja, leePausasLocales, pausaAbierta,
  type CierreDePausa, type MotivoDePausa, type PausaDelChofer,
} from "@/lib/pausas-del-chofer";

/**
 * Leer y escribir las pausas de UN chofer (D-520). Lo usan «Mi ruta» (las suyas) y el Recorrido de logística (las del
 * chofer y el día que se miran).
 *
 * Dos lecturas (D-549, 2026-11-13): las paradas del DÍA que se mira, y LA parada abierta, sea del día que sea. La de
 * ayer seguía abierta y no salía en «Hoy»: no se podía terminar y tampoco empezar otra (la base solo deja una abierta).
 *
 * - **Con base**: la tabla `public.pausas_del_chofer` de la 167, con su RLS (306 para los recibos pendientes). Sin la 167
 *   aplicada, la lectura y la escritura contestan «no existe la tabla» (`faltaLaTabla`).
 * - **Sin base** (el demo) **o en el modo enseñanza**: en el `localStorage` de este navegador, como las encuestas del demo.
 *
 * Una parada abierta VIEJA (de otro día, o de más de `TOPE_DE_PARADA_ABIERTA_MS`) no se cierra sola al abrir la app: se
 * cierra a SU hora de cierre (`horaDeCierreDeVieja`) cuando el chofer empieza otra o pulsa «Seguir». Nunca a «ahora».
 *
 * El día es el del negocio (America/Chicago), con los mismos límites que el Recorrido (`centralWallToUtc`).
 */

const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
export const TABLA_DE_PAUSAS = "pausas_del_chofer";

export type EstadoDePausas = "cargando" | "lista" | "sin-tabla" | "error";
export type ResultadoDePausa = { ok: true; pausa: PausaDelChofer } | { ok: false; sinTabla: boolean; yaAbierta?: boolean; error: unknown };
export interface Ubicacion { lat: number; lng: number; accuracy?: number | null }
export type ReciboDePausa = { recibo_foto: string; recibo_monto: number | null; recibo_galones: number | null };

const almacen = () => (typeof window === "undefined" ? null : window.localStorage);
const limites = (dia: string) => ({ desde: centralWallToUtc(`${dia}T00:00`), hasta: centralWallToUtc(`${shiftDateISO(dia, 1)}T00:00`) });
const dentro = (iso: string, desde: string, hasta: string) => Date.parse(iso) >= Date.parse(desde) && Date.parse(iso) < Date.parse(hasta);
const delChofer = (driverId: string) => leePausasLocales(almacen()).filter((p) => p.driver_id === driverId);

type Err = { code?: string; message?: string } | null | undefined;
const fallo = (error: unknown): ResultadoDePausa => ({ ok: false, sinTabla: faltaLaTabla(error as Err), error });
/** La carrera de dos «Empezar» a la vez: la base lo corta por el índice de una abierta. Se dice en el idioma de la pantalla. */
const esYaAbierta = (error: unknown): boolean => String((error as Err)?.message ?? "").includes("pausas_del_chofer_una_abierta");
const YA_ABIERTA: ResultadoDePausa = { ok: false, sinTabla: false, yaAbierta: true, error: null };

export function usePausasDelChofer(driverId: string | null | undefined, dia: string, opciones: { practica?: boolean } = {}) {
  const local = SIN_BASE || !!opciones.practica;
  const [pausas, setPausas] = useState<PausaDelChofer[]>([]);
  const [abierta, setAbierta] = useState<PausaDelChofer | null>(null);
  const [estado, setEstado] = useState<EstadoDePausas>("cargando");

  useEffect(() => {
    let vivo = true;
    setPausas([]);
    setAbierta(null);
    if (!driverId) { setEstado("lista"); return; }
    setEstado("cargando");
    const { desde, hasta } = limites(dia);
    if (local) {
      const mias = delChofer(driverId);
      setPausas(mias.filter((p) => dentro(p.empezo_at, desde, hasta)));
      setAbierta(pausaAbierta(mias));
      setEstado("lista");
      return;
    }
    void (async () => {
      const sb = createClient();
      const [delDia, sinTerminar] = await Promise.all([
        sb.from(TABLA_DE_PAUSAS).select("*").eq("driver_id", driverId).gte("empezo_at", desde).lt("empezo_at", hasta).order("empezo_at", { ascending: true }),
        sb.from(TABLA_DE_PAUSAS).select("*").eq("driver_id", driverId).is("termino_at", null).order("empezo_at", { ascending: false }).limit(1),
      ]);
      if (!vivo) return;
      const error = delDia.error ?? sinTerminar.error;
      if (error) { setEstado(faltaLaTabla(error) ? "sin-tabla" : "error"); return; }
      setPausas((delDia.data ?? []) as PausaDelChofer[]);
      setAbierta(((sinTerminar.data ?? [])[0] ?? null) as PausaDelChofer | null);
      setEstado("lista");
    })();
    return () => { vivo = false; };
  }, [driverId, dia, local]);

  /** Sustituye (o añade) una fila en lo que se pinta y, en local, en el navegador. */
  const pon = useCallback((p: PausaDelChofer) => {
    const { desde, hasta } = limites(dia);
    setPausas((prev) => (prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x))
      : dentro(p.empezo_at, desde, hasta) ? [...prev, p] : prev));
    setAbierta((prev) => (p.termino_at ? (prev?.id === p.id ? null : prev) : p));
    if (local) {
      const todas = leePausasLocales(almacen());
      guardaPausasLocales(almacen(), todas.some((x) => x.id === p.id) ? todas.map((x) => (x.id === p.id ? p : x)) : [...todas, p]);
    }
  }, [local, dia]);

  /** Cambia columnas de una fila que ya existe (cerrar, poner recibo, ubicación tardía). Lo que devuelve la base manda. */
  const actualiza = useCallback(async (p: PausaDelChofer, cambio: Partial<PausaDelChofer>): Promise<ResultadoDePausa> => {
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

  // `recibo_foto` (D-523): la del recibo de gasolina, si la tomó al registrar la parada. La base solo la admite en una de
  // gasolina (`pausas_recibo_solo_gasolina`, 167); quien llama la manda `null` en las demás.
  const empezar = useCallback(async (inicio: { motivo: MotivoDePausa; nota: string | null; recibo_foto?: string | null }, gps: Ubicacion | null): Promise<ResultadoDePausa> => {
    if (!driverId) return fallo(new Error("no driver"));
    const ubicacion = { lat: gps?.lat ?? null, lng: gps?.lng ?? null, precision_m: gps?.accuracy ?? null };
    const sb = local ? null : createClient();
    // 1) Lo que sigue abierto DE VERDAD, sea del día que sea. Una vieja se cierra a su hora de cierre; una de hoy no deja
    //    abrir otra (lo que aparece en pantalla, «Terminar», es la forma de cerrarla).
    let actual: PausaDelChofer | null;
    if (sb) {
      const { data, error } = await sb.from(TABLA_DE_PAUSAS).select("*").eq("driver_id", driverId).is("termino_at", null)
        .order("empezo_at", { ascending: false }).limit(1);
      if (error) return fallo(error);
      actual = ((data ?? [])[0] ?? null) as PausaDelChofer | null;
    } else {
      actual = pausaAbierta(delChofer(driverId));
    }
    if (actual) {
      if (!esParadaVieja(actual)) return YA_ABIERTA;
      const cerrada = await actualiza(actual, { termino_at: horaDeCierreDeVieja(actual.empezo_at) });
      if (!cerrada.ok) return cerrada;
    }
    // 2) La nueva. La hora de inicio la pone la base (`default now()`): la de un teléfono puede ir adelantada o atrasada.
    const nueva = { driver_id: driverId, ...inicio, recibo_foto: inicio.recibo_foto ?? null, ...ubicacion };
    if (!sb) {
      const ahora = new Date().toISOString();
      const p: PausaDelChofer = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...nueva, motivo: inicio.motivo,
        empezo_at: ahora, termino_at: null, recibo_monto: null, recibo_galones: null, sin_recibo: false, created_at: ahora,
      };
      pon(p);
      return { ok: true, pausa: p };
    }
    const { data, error } = await sb.from(TABLA_DE_PAUSAS).insert(nueva).select("*").single();
    if (error || !data) return esYaAbierta(error) ? YA_ABIERTA : fallo(error);
    pon(data as PausaDelChofer);
    return { ok: true, pausa: data as PausaDelChofer };
  }, [driverId, local, pon, actualiza]);

  /** «▶ Seguir»: la hora de cierre es la regla de `horaDeCierreDe` (ahora, o la de una parada vieja). */
  const seguir = useCallback((p: PausaDelChofer, cierre: CierreDePausa): Promise<ResultadoDePausa> =>
    actualiza(p, { termino_at: horaDeCierreDe(p), ...cierre }), [actualiza]);

  /** El recibo que llega después (D-548): solo fotos y cifras de una parada de gasolina; nunca fechas ni lugar. */
  const recibir = useCallback((p: PausaDelChofer, recibo: ReciboDePausa): Promise<ResultadoDePausa> =>
    actualiza(p, { recibo_foto: recibo.recibo_foto, recibo_monto: recibo.recibo_monto, recibo_galones: recibo.recibo_galones, sin_recibo: false }),
  [actualiza]);

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

  return { pausas, abierta, estado, empezar, seguir, recibir, ubicarTarde };
}
