"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { createClient } from "@/lib/supabase/client";
import { catalogoDeRequisitos, faltanAlChofer, habilidadesPorNombre } from "@/lib/requisitos";
import type { Delivery, DriverSettings } from "@/lib/types";

/**
 * Lo que necesita «Mejor lugar» en el Gestor (D-418): el catálogo de requisitos y qué tiene el camión de cada chofer,
 * para preguntar «¿qué le falta a este chofer para llevar esta orden?». Auto-asignar NO lo usa en esta rama: el
 * orquestador lo dejó fuera (2026-09-27) porque otra rama lo reescribe sobre el motor de «Planificar el día», que ya
 * respeta los requisitos.
 *
 * Lo de los camiones vive en `driver_settings.features` (151) y se lee aquí con una consulta directa, como hace Ajustes
 * (`RouteEngineSettings`): el `DataProvider` no carga esa tabla. **Solo se pregunta si hay catálogo**: sin él (una base
 * sin la 151, o un catálogo vacío) ninguna orden pide nada y la respuesta es siempre «nada», sin consulta.
 *
 * Si la lectura falla, cada chofer cuenta como que no tiene nada: una orden que pide algo no se coloca, y el aviso dice
 * lo que falta. Es el lado seguro: mandar un camión sin liftgate a una entrega que lo necesita es un viaje
 * perdido; dejarla sin asignar es un clic de una persona.
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export function useRequisitosDelCamion(): { catalogo: string[]; faltanA: (orden: Delivery, chofer: string) => readonly string[] } {
  const { settings, users } = useData();
  const catalogo = useMemo(() => catalogoDeRequisitos(settings), [settings]);
  const [filas, setFilas] = useState<Pick<DriverSettings, "profile_id" | "features">[]>([]);
  const hayCatalogo = catalogo.length > 0;

  useEffect(() => {
    if (!hayCatalogo || LOCAL_MODE) return;
    let vivo = true;
    void (async () => {
      const { data, error } = await createClient().from("driver_settings").select("profile_id, features");
      if (vivo) setFilas(error ? [] : ((data ?? []) as Pick<DriverSettings, "profile_id" | "features">[]));
    })();
    return () => { vivo = false; };
  }, [hayCatalogo]);

  const habilidades = useMemo(() => habilidadesPorNombre(filas, users, catalogo), [filas, users, catalogo]);
  const carriles = settings.route_buckets;
  const faltanA = useCallback(
    (orden: Delivery, chofer: string) => faltanAlChofer(orden, chofer, catalogo, habilidades, carriles ?? []),
    [catalogo, habilidades, carriles],
  );
  return { catalogo, faltanA };
}
