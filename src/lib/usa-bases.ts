"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { createClient } from "@/lib/supabase/client";
import { basesPorNombre } from "@/lib/optimizar-desde-el-gestor";
import type { DriverSettings } from "@/lib/types";

/**
 * La tienda base de cada chofer, por NOMBRE, para el Gestor de Rutas (D-NEXT): de dónde sale su camión y a dónde vuelve. Es
 * la de Ajustes → Rutas (`driver_settings.base_store`, 128), la misma de la que lo saca «Armar rutas».
 *
 * Se lee con una consulta directa, como las zonas y los requisitos (`usa-zonas.ts`, `usa-requisitos.ts`): el `DataProvider`
 * no carga `driver_settings`. Si la lectura falla, o en el demo, nadie tiene base de Ajustes y queda la tienda del perfil
 * (`tiendaBaseDelChofer`); sin ninguna, la ruta se mide abierta y la tarjeta dice «⚠ sin base».
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export function useBasesDeChofer(): ReadonlyMap<string, string> {
  const { users } = useData();
  const [filas, setFilas] = useState<Pick<DriverSettings, "profile_id" | "base_store">[]>([]);

  useEffect(() => {
    if (LOCAL_MODE) return;
    let vivo = true;
    void (async () => {
      const { data, error } = await createClient().from("driver_settings").select("profile_id, base_store");
      if (vivo) setFilas(error ? [] : ((data ?? []) as Pick<DriverSettings, "profile_id" | "base_store">[]));
    })();
    return () => { vivo = false; };
  }, []);

  return useMemo(() => basesPorNombre(filas, users), [filas, users]);
}
