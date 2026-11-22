import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/clockin/cronAuth";
import { boletoValido, type BaseDeBoletos } from "@/lib/cron-boleto";

/** La tabla `cron_tickets` con la llave de servicio (la única que puede tocarla). */
function baseDeBoletos(): BaseDeBoletos {
  return {
    gastaBoleto: async (token, ruta, desde) => {
      const { data, error } = await createAdminClient().from("cron_tickets").delete()
        .eq("token", token).eq("ruta", ruta).gte("created_at", desde).select("token");
      if (error) throw error;
      return (data ?? []).length;
    },
  };
}

/** Las dos puertas de un cron: el CRON_SECRET de siempre (Vercel, GitHub) o un boleto de la base para ESTA ruta (342). */
export async function cronAutorizadoORBoleto(req: Request, ruta: string): Promise<boolean> {
  if (cronAuthorized(req)) return true;
  return boletoValido(req, ruta, baseDeBoletos());
}
