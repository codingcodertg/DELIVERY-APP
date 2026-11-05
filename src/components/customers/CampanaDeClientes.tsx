"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AppNotification } from "@/lib/notifications";
import { CampanaDeAvisos } from "@/components/NotificationBell";

const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * La campana 🔔 en Clientes (D-867). Clientes no monta el `DataProvider` de Entregas, así que lee sus avisos aquí: la
 * MISMA tabla (`public.notifications`, la RLS de la 001 deja leer y marcar solo los propios) y la MISMA campana
 * (`CampanaDeAvisos`). Enseña todos los avisos de quien mira, no solo los de Clientes: es su bandeja, y cada aviso lleva
 * a su sitio (`lib/destino-del-aviso.ts`).
 *
 * `select("*")`: con la 243 trae `link` y `message_es`; sin ella, las columnas de siempre, y funciona igual.
 */
export function CampanaDeClientes() {
  const supabase = useMemo(() => (SIN_BASE ? null : createClient()), []);
  const [yo, setYo] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<AppNotification[]>([]);

  useEffect(() => {
    if (!supabase) return;
    let vivo = true;
    void supabase.auth.getUser().then(({ data }) => { if (vivo) setYo(data.user?.id ?? null); });
    return () => { vivo = false; };
  }, [supabase]);

  const carga = useCallback(async () => {
    if (!supabase || !yo) return;
    const r = await supabase.from("notifications").select("*").eq("user_id", yo).order("created_at", { ascending: false }).limit(50);
    if (r.data) setAvisos(r.data as AppNotification[]);
  }, [supabase, yo]);

  useEffect(() => {
    if (!supabase || !yo) return;
    void carga();
    // En vivo: un aviso nuevo (o leído en otra pestaña) se ve sin recargar. Y al volver a la pestaña, por si el canal se cayó.
    const canal = supabase
      .channel(`avisos-clientes-${yo}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${yo}` }, () => { void carga(); })
      .subscribe();
    const alVolver = () => { if (document.visibilityState === "visible") void carga(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      void supabase.removeChannel(canal);
    };
  }, [supabase, yo, carga]);

  const marcaLeido = useCallback(async (id: string) => {
    if (!supabase) return;
    setAvisos((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  }, [supabase]);

  // «Marcar todo leído» de UNA sección (D-NEXT): los ids que la campana le pasa, en una sola escritura.
  const marcaVarios = useCallback(async (ids: string[]) => {
    if (!supabase || !yo || !ids.length) return;
    const set = new Set(ids);
    setAvisos((prev) => prev.map((n) => (set.has(n.id) ? { ...n, read: true } : n)));
    await supabase.from("notifications").update({ read: true }).eq("user_id", yo).in("id", ids);
  }, [supabase, yo]);

  if (!supabase) return null;
  return <CampanaDeAvisos notifications={avisos} markNotifRead={marcaLeido} markManyRead={marcaVarios} />;
}
