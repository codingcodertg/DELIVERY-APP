"use client";

import { useCallback, useEffect, useState } from "react";
import { useData } from "@/lib/data-provider";
import { createClient } from "@/lib/supabase/client";
import {
  LLAVE_DE_PRACTICA, LLAVE_DEL_DEMO, corrigeEnElNavegador, guardaEnElNavegador, guardaInspeccion, leeDelNavegador,
  leeInspecciones, leeVehiculos, marcaCorregido, vehiculosDelDemo,
  type ClienteDeInspecciones, type Correccion, type Guardado, type Vehiculos,
} from "@/lib/inspeccion/almacen";
import type { EstadoDeLectura, Inspeccion, InspeccionNueva } from "@/lib/inspeccion/reglas";

const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

const navegador = () => (typeof window === "undefined" ? null : window.localStorage);
const cliente = () => createClient() as unknown as ClienteDeInspecciones;

/**
 * Las inspecciones de un día (D-518): las de `choferId`, o todas con `null` (logística y admin; la RLS decide qué
 * llega de verdad). En el demo y en el modo práctica, las de este navegador (`almacen.ts`).
 *
 * Se relee al volver a la pestaña: logística deja la lista abierta mientras los choferes salen.
 */
export function useInspecciones(fecha: string, choferId: string | null) {
  const { me, teaching } = useData();
  const local = SIN_BASE || teaching;
  const llave = SIN_BASE ? LLAVE_DEL_DEMO : LLAVE_DE_PRACTICA;
  const [estado, setEstado] = useState<EstadoDeLectura>("cargando");
  const [filas, setFilas] = useState<Inspeccion[]>([]);
  const [detalle, setDetalle] = useState<string | undefined>();
  const [vuelta, setVuelta] = useState(0);
  const recarga = useCallback(() => setVuelta((n) => n + 1), []);

  useEffect(() => {
    let vivo = true;
    const lee = local ? Promise.resolve(leeDelNavegador(navegador(), llave, fecha, choferId, SIN_BASE)) : leeInspecciones(cliente(), fecha, choferId);
    void lee.then((r) => {
      if (!vivo) return;
      setEstado(r.estado);
      setFilas(r.filas);
      setDetalle(r.detalle);
    });
    return () => { vivo = false; };
  }, [fecha, choferId, local, llave, vuelta]);

  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === "visible") recarga(); };
    window.addEventListener("focus", alVolver);
    document.addEventListener("visibilitychange", alVolver);
    return () => { window.removeEventListener("focus", alVolver); document.removeEventListener("visibilitychange", alVolver); };
  }, [recarga]);

  const guarda = useCallback(async (nueva: InspeccionNueva): Promise<Guardado> => {
    const r = local ? guardaEnElNavegador(navegador(), llave, nueva, new Date()) : await guardaInspeccion(cliente(), nueva);
    if (r.ok) setFilas((antes) => [...antes, r.fila]);
    else if (r.motivo === "sin_tabla") setEstado("sin_tabla");
    else if (r.motivo === "repetida") recarga();
    return r;
  }, [local, llave, recarga]);

  const corrige = useCallback(async (id: string, punto: string, corregido: boolean, nota: string): Promise<Correccion> => {
    const r = local
      ? corrigeEnElNavegador(navegador(), llave, id, punto, corregido, nota, { id: me?.id ?? "", nombre: me?.full_name ?? "" }, new Date())
      : await marcaCorregido(cliente(), id, punto, corregido, nota);
    if (r.ok) setFilas((antes) => antes.map((f) => (f.id === id ? { ...f, repairs: r.repairs } : f)));
    return r;
  }, [local, llave, me?.id, me?.full_name]);

  return { estado, filas, detalle, recarga, guarda, corrige, local };
}

/** Los vehículos de la empresa para elegir (`vehiculos_para_inspeccion`), con el asignado marcado. */
export function useVehiculos(): Vehiculos | null {
  const { me } = useData();
  const [v, setV] = useState<Vehiculos | null>(null);
  useEffect(() => {
    if (SIN_BASE) { setV({ estado: "listo", vehiculos: vehiculosDelDemo(me?.id) }); return; }
    let vivo = true;
    void leeVehiculos(cliente()).then((r) => { if (vivo) setV(r); });
    return () => { vivo = false; };
  }, [me?.id]);
  return v;
}
