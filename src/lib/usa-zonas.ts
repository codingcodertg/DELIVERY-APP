"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { createClient } from "@/lib/supabase/client";
import { zonasPorNombre } from "@/lib/zonas";
import type { DriverSettings } from "@/lib/types";

/**
 * Las zonas preferidas de cada chofer, por NOMBRE, para «📍 Mejor lugar» en el Gestor (D-421, 152): los choferes de la
 * zona de lo marcado salen primero en «Elige conductor», con su marca. **Solo sugerencia**: no elige a nadie ni cambia el
 * cálculo del hueco.
 *
 * Se lee con una consulta directa, como los requisitos (`usa-requisitos.ts`): el `DataProvider` no carga `driver_settings`.
 * Si la lectura falla —una base sin la 152 (`42703`), o sin permiso—, nadie tiene zonas y el recuadro sale como siempre:
 * aquí el lado seguro es no sugerir nada.
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export function useZonasDeChofer(): ReadonlyMap<string, readonly string[]> {
  const { users } = useData();
  const [filas, setFilas] = useState<Pick<DriverSettings, "profile_id" | "preferred_zones">[]>([]);

  useEffect(() => {
    if (LOCAL_MODE) return;
    let vivo = true;
    void (async () => {
      const { data, error } = await createClient().from("driver_settings").select("profile_id, preferred_zones");
      if (vivo) setFilas(error ? [] : ((data ?? []) as Pick<DriverSettings, "profile_id" | "preferred_zones">[]));
    })();
    return () => { vivo = false; };
  }, []);

  return useMemo(() => zonasPorNombre(filas, users), [filas, users]);
}
