import { notFound } from "next/navigation";
import { Operaciones, type Vista } from "../Operaciones";
import { esTipo } from "@/lib/almacen-ops/tipos";

export const dynamic = "force-dynamic";
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * Operaciones de almacén (D-883, migración 247). Una sola página para cuatro rutas:
 *   /operaciones                  el inicio (las siete tarjetas y «Mis reportes»)
 *   /operaciones/nuevo/<tipo>     el asistente de un reporte
 *   /operaciones/mis-reportes     lo que llenó quien mira
 *   /operaciones/reportes         la vista de gerentes (todo lo que la RLS deja ver, y la merma)
 */
export default async function Page({ params }: { params: Promise<{ ruta?: string[] }> }) {
  const ruta = (await params).ruta ?? [];
  let vista: Vista;
  if (ruta.length === 0) vista = { v: "inicio" };
  else if (ruta[0] === "nuevo" && ruta.length === 2 && esTipo(ruta[1])) vista = { v: "nuevo", tipo: ruta[1] };
  else if (ruta[0] === "mis-reportes" && ruta.length === 1) vista = { v: "mios" };
  else if (ruta[0] === "reportes" && ruta.length === 1) vista = { v: "reportes" };
  else notFound();
  return <Operaciones vista={vista} demo={SIN_BASE} />;
}
