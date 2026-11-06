import { notFound, redirect } from "next/navigation";
import { Operaciones } from "../Operaciones";
import { esTipo } from "@/lib/almacen-ops/tipos";
import { leerNivelEscrito } from "@/lib/almacen-ops/nivel";
import { vistaPermitida, type Vista } from "@/lib/almacen-ops/puerta";
import { createClient } from "@/lib/supabase/server";
import { estadoDeLectura } from "@/lib/profile-read";

export const dynamic = "force-dynamic";
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * Operaciones de almacén (D-883, migración 247). Una sola página para cuatro rutas:
 *   /operaciones                  el inicio (las tarjetas que su nivel abre y «Mis reportes»)
 *   /operaciones/nuevo/<tipo>     el asistente de un reporte
 *   /operaciones/mis-reportes     lo que llenó quien mira
 *   /operaciones/reportes         la vista de gerentes (todo lo que la RLS deja ver, y la merma)
 *
 * D-NEXT (265): la ruta se comprueba AQUÍ, en el servidor, contra el nivel de quien entra. Quien solo tiene merma y
 * escribe a mano /operaciones/nuevo/incident (o /operaciones/reportes) vuelve al inicio sin que se pinte el formulario.
 */
export default async function Page({ params }: { params: Promise<{ ruta?: string[] }> }) {
  const ruta = (await params).ruta ?? [];
  let vista: Vista;
  if (ruta.length === 0) vista = { v: "inicio" };
  else if (ruta[0] === "nuevo" && ruta.length === 2 && esTipo(ruta[1])) vista = { v: "nuevo", tipo: ruta[1] };
  else if (ruta[0] === "mis-reportes" && ruta.length === 1) vista = { v: "mios" };
  else if (ruta[0] === "reportes" && ruta.length === 1) vista = { v: "reportes" };
  else notFound();

  if (!SIN_BASE && vista.v !== "inicio") {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login?next=/operaciones");
    const { data: perfil, error: errorPerfil } = await supabase
      .from("profiles")
      .select("role, store, visible_stores, permissions, module_access, recruiting_role")
      .eq("id", user.id)
      .maybeSingle();
    // Una lectura que falló no manda a nadie a otro sitio: el layout ya enseña el error de lectura en vez de esto.
    const legible = estadoDeLectura({ data: perfil, error: errorPerfil }) === "fallo" ? null : perfil;
    const nivel = legible ? await leerNivelEscrito(supabase, user.id) : null;
    if (legible && !vistaPermitida({ id: user.id, ...legible, role: legible.role ?? "sales", warehouse_ops_role: nivel }, vista)) {
      redirect("/operaciones");
    }
  }
  return <Operaciones vista={vista} demo={SIN_BASE} />;
}
