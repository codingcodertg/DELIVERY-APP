"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useData } from "@/lib/data-provider";
import { createClient } from "@/lib/supabase/client";
import { tablaAusente, type SolicitudDeAsignacion } from "@/lib/solicitud-de-asignacion";

const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
/** Cada cuánto se relee con la pestaña a la vista. Una consulta pequeña a la base. */
const RELEE_CADA_MS = 60_000;

export interface SolicitudesDeAsignacion {
  /** null = aún no se sabe; false = no hay tabla (176 sin aplicar), demo o modo enseñanza: nada se pinta. */
  disponible: boolean | null;
  lista: SolicitudDeAsignacion[];
  pedir: (args: { deliveryId: string; fecha: string; chofer: string | null; nota: string }) => Promise<boolean>;
  cancelar: (id: string) => Promise<boolean>;
  decidir: (id: string, decision: { status: "approved" | "rejected"; motivo?: string | null; chofer?: string | null }) => Promise<boolean>;
  relee: () => void;
}

/**
 * Las solicitudes de asignación que esta persona puede ver (D-NEXT, 176): las suyas, o todas si es logística o admin — eso
 * lo decide la RLS de la tabla, no este gancho. Se relee al entrar, al volver a la pestaña, cada minuto, después de cada
 * escritura propia, y cuando llega un aviso a la campana (la base avisa a quien decide de cada solicitud nueva, y a quien
 * pidió de cada decisión).
 *
 * Sin base (demo), en modo enseñanza, o sin la tabla todavía: `disponible: false` y las escrituras no hacen nada. Pedir en
 * modo enseñanza escribiría una solicitud de verdad que vería logística, así que ahí no se ofrece.
 */
export function useSolicitudesDeAsignacion(activo = true): SolicitudesDeAsignacion {
  const { teaching, notify, notifications, me } = useData();
  const apagado = SIN_BASE || teaching || !activo || !me;
  const [disponible, setDisponible] = useState<boolean | null>(apagado ? false : null);
  const [lista, setLista] = useState<SolicitudDeAsignacion[]>([]);
  const [vuelta, setVuelta] = useState(0);
  const relee = useCallback(() => setVuelta((n) => n + 1), []);

  useEffect(() => {
    if (apagado) { setDisponible(false); setLista([]); return; }
    let vivo = true;
    void createClient().from("assign_requests").select("*").order("created_at", { ascending: false }).limit(300)
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) {
          if (tablaAusente(error)) { setDisponible(false); setLista([]); }
          else console.error("assign_requests:", error.message);
          return;
        }
        setDisponible(true);
        setLista((data ?? []) as SolicitudDeAsignacion[]);
      });
    return () => { vivo = false; };
  }, [apagado, vuelta]);

  // Al volver a la pestaña y cada minuto con ella a la vista.
  useEffect(() => {
    if (apagado) return;
    const alVolver = () => { if (document.visibilityState === "visible") relee(); };
    window.addEventListener("focus", alVolver);
    document.addEventListener("visibilitychange", alVolver);
    const id = setInterval(alVolver, RELEE_CADA_MS);
    return () => { window.removeEventListener("focus", alVolver); document.removeEventListener("visibilitychange", alVolver); clearInterval(id); };
  }, [apagado, relee]);

  // Un aviso nuevo en la campana: puede ser una solicitud o una decisión. Se relee sin prisa.
  const avisos = notifications?.length ?? 0;
  const primera = useRef(true);
  useEffect(() => {
    if (apagado) return;
    if (primera.current) { primera.current = false; return; }
    const id = setTimeout(relee, 800);
    return () => clearTimeout(id);
  }, [avisos, apagado, relee]);

  const pedir = useCallback<SolicitudesDeAsignacion["pedir"]>(async ({ deliveryId, fecha, chofer, nota }) => {
    if (apagado || !me) return false;
    const { error } = await createClient().from("assign_requests").insert({
      delivery_id: deliveryId,
      requested_by: me.id,
      requested_date: fecha,
      suggested_driver: chofer?.trim() || null,
      note: nota.trim().replace(/\s+/g, " ") || null,
    });
    if (error) { notify("Error: " + error.message); return false; }
    relee();
    return true;
  }, [apagado, me, notify, relee]);

  // `.select("id")`: un UPDATE que la RLS deja en cero filas vuelve limpio; sin filas de vuelta no se cuenta como hecho.
  const actualiza = useCallback(async (id: string, patch: Record<string, unknown>) => {
    if (apagado) return false;
    const { data, error } = await createClient().from("assign_requests").update(patch).eq("id", id).eq("status", "open").select("id");
    if (error) { notify("Error: " + error.message); return false; }
    if (!data || data.length === 0) { notify("Error: the request is no longer open / la solicitud ya no está abierta"); relee(); return false; }
    relee();
    return true;
  }, [apagado, notify, relee]);

  const cancelar = useCallback<SolicitudesDeAsignacion["cancelar"]>((id) => actualiza(id, { status: "canceled" }), [actualiza]);

  const decidir = useCallback<SolicitudesDeAsignacion["decidir"]>((id, { status, motivo, chofer }) =>
    actualiza(id, {
      status,
      decision_note: motivo?.trim().replace(/\s+/g, " ") || null,
      assigned_driver: status === "approved" ? (chofer?.trim() || null) : null,
    }), [actualiza]);

  return { disponible: apagado ? false : disponible, lista: apagado ? [] : lista, pedir, cancelar, decidir, relee };
}
