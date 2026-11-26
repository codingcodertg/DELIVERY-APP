import { BotonCasa } from "@/components/BotonCasa";
import { createClient } from "@/lib/supabase/server";
import { leerFallasDemo } from "@/lib/fallas/demo";
import type { FilaDeFalla } from "@/lib/fallas/agrupa";
import { PanelDeFallas } from "./PanelDeFallas";

export const dynamic = "force-dynamic";

/** El demo (`NEXT_PUBLIC_LOCAL_MODE`): las filas salen de la memoria del demo, no de la base. */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

const COLUMNAS = "id, created_at, origen, app, ruta, mensaje, pila, componente, user_id, rol, version, navegador, escritorio, huella, veces, ultima_vez, usuarios";

/**
 * «Fallas de la app» (2026-11-25): lo que la app registró al fallar, agrupado por lugar. Se lee con la sesión del admin;
 * sin la 352 aplicada la consulta falla y la pantalla lo dice en vez de romperse.
 */
export default async function FallasPage() {
  if (LOCAL_MODE) {
    return (
      <>
        <div className="card" style={{ marginBottom: 12 }}><BotonCasa /></div>
        <PanelDeFallas filas={leerFallasDemo()} aviso={null} demo />
      </>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_errors")
    .select(COLUMNAS)
    .order("ultima_vez", { ascending: false })
    .limit(2000);

  // 42P01 (tabla) o PGRST205 (tabla que el API no conoce): la 352 no está aplicada.
  const sinLaMigracion = !!error && (error.code === "42P01" || error.code === "PGRST205");
  const aviso = error ? (sinLaMigracion ? "sin-migracion" : "error") : null;

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}><BotonCasa /></div>
      <PanelDeFallas filas={(data ?? []) as unknown as FilaDeFalla[]} aviso={aviso} />
    </>
  );
}
