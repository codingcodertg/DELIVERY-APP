import { Encuestas } from "./Encuestas";
import { createClient } from "@/lib/supabase/server";
import { demoSettings } from "@/lib/demo-data";
import { nombresDeTiendas } from "@/lib/encuestas/qr";

export const dynamic = "force-dynamic";
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * «Encuestas» (migración 155): los resultados de la encuesta del sitio público de clientes.
 *
 * El servidor no lee nada: la pantalla lee `survey_responses` con la sesión de quien mira, para que la RLS de la
 * 155 sea la que decide y no una copia de ella aquí. La puerta (quién entra) está en `layout.tsx`.
 */
export default async function SurveysPage() {
  // Las tiendas de Ajustes, para un QR por tienda (D-724). Si no se pueden leer, la pantalla sale con el QR general solo.
  const tiendas = SIN_BASE ? nombresDeTiendas(demoSettings().stores) : await tiendasDeAjustes();
  return <Encuestas demo={SIN_BASE} tiendas={tiendas} />;
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
