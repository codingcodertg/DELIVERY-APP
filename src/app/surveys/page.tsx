import { QrCodesApp } from "./QrCodesApp";
import { tiposVisibles, tipoDesdeParam, type ClaveTipoQr } from "@/lib/qr-codes/tipos";
import { respuestasDemo } from "@/lib/encuestas/demo";
import { TARJETAS_DEMO } from "@/lib/tarjetas/demo";
import { createClient } from "@/lib/supabase/server";
import { demoSettings } from "@/lib/demo-data";
import { nombresDeTiendas } from "@/lib/encuestas/qr";

export const dynamic = "force-dynamic";
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * «QR Codes» (antes «Encuestas»; migración 155): los resultados de la encuesta del sitio público de clientes.
 *
 * El servidor no lee nada: la pantalla lee `survey_responses` con la sesión de quien mira, para que la RLS de la
 * 155 sea la que decide y no una copia de ella aquí. La puerta (quién entra) está en `layout.tsx`.
 */
export default async function SurveysPage({ searchParams }: { searchParams: Promise<{ tipo?: string | string[] }> }) {
  const { tipo: crudo } = await searchParams;
  const tipoParam = Array.isArray(crudo) ? crudo[0] : crudo;
  // Las tiendas de Ajustes, para un QR por tienda (D-724). Si no se pueden leer, la pantalla sale con el QR general solo.
  const tiendas = SIN_BASE ? nombresDeTiendas(demoSettings().stores) : await tiendasDeAjustes();
  const esAdmin = SIN_BASE || (await soyAdmin());
  const visibles = tiposVisibles(esAdmin);
  // Con un solo tipo (quien no es admin) no hay selector: se entra directo. Si no, lo que pida la URL, o el selector.
  const tipo = visibles.length === 1 ? visibles[0].clave : tipoDesdeParam(tipoParam, visibles);
  const conteos = await contarTipos(visibles.map((v) => v.clave));
  return <QrCodesApp demo={SIN_BASE} tiendas={tiendas} visibles={visibles} tipo={tipo} conteos={conteos} />;
}

/** La cuenta de cada tipo para el selector. Lo que no se pueda contar sale null (la tarjeta no enseña cifra). */
async function contarTipos(claves: readonly ClaveTipoQr[]): Promise<Partial<Record<ClaveTipoQr, number | null>>> {
  if (SIN_BASE) {
    return {
      encuestas: respuestasDemo().length,
      tarjetas: TARJETAS_DEMO.filter((f) => f.active).length,
    };
  }
  const salida: Partial<Record<ClaveTipoQr, number | null>> = {};
  const supabase = await createClient();
  for (const clave of claves) {
    try {
      if (clave === "encuestas") {
        const { count } = await supabase.from("survey_responses").select("id", { count: "exact", head: true });
        salida.encuestas = count ?? null;
      } else {
        const { count } = await supabase.from("business_cards").select("id", { count: "exact", head: true }).eq("active", true);
        salida.tarjetas = count ?? null;
      }
    } catch {
      salida[clave] = null;
    }
  }
  return salida;
}

/** ¿Es admin quien mira? Solo el admin ve la sección de tarjetas de presentación (la base lo repite con la RLS). */
async function soyAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    return data?.role === "admin";
  } catch {
    return false;
  }
}

async function tiendasDeAjustes(): Promise<string[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("settings").select("stores").eq("id", 1).maybeSingle();
    return nombresDeTiendas((data?.stores ?? []) as { name?: string | null }[]);
  } catch {
    return [];
  }
}
