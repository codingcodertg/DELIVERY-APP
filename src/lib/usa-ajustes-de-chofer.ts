"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { leeConOpcionales } from "@/lib/columnas-opcionales";
import { COLUMNAS_DE_CHOFER, COLUMNAS_OPCIONALES_DE_CHOFER } from "@/lib/route-settings";
import type { DriverSettings } from "@/lib/types";

/**
 * Las filas ENTERAS de `driver_settings` (Ajustes → Rutas), para «Asignar a…» varios choferes desde el Gestor (D-NEXT):
 * de ahí salen la base, la capacidad, el turno, si vuelve a base, si rutea, lo que tiene el camión y sus zonas — lo MISMO
 * que lee «Armar rutas» en el servidor (`route-plan/entrada`, `COLUMNAS_DE_CHOFER` y las opcionales), para que el reparto
 * entre los elegidos use exactamente los mismos choferes y las mismas reglas.
 *
 * Se lee con una consulta directa, como las bases, las zonas y los requisitos (`usa-bases.ts`, `usa-zonas.ts`,
 * `usa-requisitos.ts`): el `DataProvider` no carga `driver_settings`. Si la lectura falla, o en el demo, no hay filas: cada
 * chofer entra con la tienda de su perfil como base y los valores de partida (`choferParaElMotor`).
 */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export function useAjustesDeChofer(): readonly DriverSettings[] {
  const [filas, setFilas] = useState<DriverSettings[]>([]);
  useEffect(() => {
    if (LOCAL_MODE) return;
    let vivo = true;
    void (async () => {
      const r = await leeConOpcionales((columnas) => createClient().from("driver_settings").select(columnas), COLUMNAS_DE_CHOFER, COLUMNAS_OPCIONALES_DE_CHOFER);
      if (vivo) setFilas(r.error ? [] : ((r.data ?? []) as unknown as DriverSettings[]));
    })();
    return () => { vivo = false; };
  }, []);
  return filas;
}
