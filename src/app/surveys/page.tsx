import { Encuestas } from "./Encuestas";

export const dynamic = "force-dynamic";
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * «Encuestas» (migración 155): los resultados de la encuesta del sitio público de clientes.
 *
 * El servidor no lee nada: la pantalla lee `survey_responses` con la sesión de quien mira, para que la RLS de la
 * 155 sea la que decide y no una copia de ella aquí. La puerta (quién entra) está en `layout.tsx`.
 */
export default function SurveysPage() {
  return <Encuestas demo={SIN_BASE} />;
}
