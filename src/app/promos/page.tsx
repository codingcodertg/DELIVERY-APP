import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RONDAS_DEMO } from "@/lib/promos/demo";
import { rondaDeEntrada } from "@/lib/promos/entrada";

const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export const dynamic = "force-dynamic";

/**
 * La raíz del módulo de promociones: **no es una pantalla, es una puerta** (D-375).
 *
 * Aquí había la lista de rondas. El dueño la vio y dijo *«esto elimínalo, que entre directo a la
 * tabla»*, y tenía razón: casi siempre había una sola ronda abierta, así que la lista era un clic
 * obligatorio entre una opción. Ahora se resuelve a cuál se entra —`rondaDeEntrada`, que es donde
 * vive la regla— y se redirige. **Llegar a una ronda vieja no se pierde**: el selector está dentro
 * de la tabla.
 *
 * **Lo único que se pinta aquí es el caso sin rondas**, y hay que pintarlo en vez de redirigir a
 * ningún sitio: sin filas no hay adónde ir, y un redirect en el camino del error es como se hace un
 * bucle. Ese caso NO es solo «todavía no se ha subido nada» — a quien no tiene el módulo la RLS de
 * la 140 le devuelve cero filas, y ve exactamente esto. Por eso el texto no promete que subiendo un
 * Excel se arregle: dice las dos cosas.
 *
 * Se sigue leyendo `promo_rounds` con el cliente de quien mira, y **nunca** `promo_products`.
 */
export default async function PromosIndex() {
  if (SIN_BASE) {
    const destino = rondaDeEntrada(RONDAS_DEMO);
    if (destino) redirect(`/promos/${destino.id}`);
    return <SinRondas />;
  }

  const supabase = await createClient();
  const { data: rondas } = await supabase
    .from("promo_rounds")
    .select("id, uploaded_at, closed_at")
    .order("uploaded_at", { ascending: false })
    .limit(50);

  const destino = rondaDeEntrada((rondas ?? []) as { id: string; uploaded_at: string; closed_at: string | null }[]);
  if (destino) redirect(`/promos/${destino.id}`);
  return <SinRondas />;
}

function SinRondas() {
  // Servidor sin idioma de la persona: las dos lenguas, como siempre, pero el inglés delante y con título propio.
  return (
    <div className="promos-sin-rondas">
      <div className="promos-sin-rondas-icono" aria-hidden="true">🏷️</div>
      <h1>No rounds to show</h1>
      <h2 lang="es">No hay ninguna ronda que puedas ver</h2>
      <p>
        Either none has been uploaded yet — an admin loads them with the script
        in <code>scripts/promos/</code> — or you don&apos;t have the promos module enabled.
      </p>
      <p lang="es">
        O todavía no se ha subido ninguna —las carga un
        administrador con el script de <code>scripts/promos/</code>— o no tienes el módulo de
        promociones habilitado.
      </p>
    </div>
  );
}
