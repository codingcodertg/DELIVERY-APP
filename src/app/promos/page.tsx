import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RONDAS_DEMO } from "@/lib/promos/demo";

const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export const dynamic = "force-dynamic";

/**
 * La raíz del módulo de promociones.
 *
 * La lista de rondas, y nada más. **Subir ya no se hace desde aquí**: el dueño lo quitó —«eso de
 * cargar files no, quita eso: yo te doy la información y tú la subes y punto»— así que las rondas
 * las carga quien administra el sistema con el script de `scripts/promos/`, y esta pantalla solo
 * las enseña. De paso, el módulo se quedó sin ninguna superficie con llave de servicio.
 *
 * Lee `promo_rounds` con el cliente de quien mira, así que la RLS de la 140 decide: sin el módulo
 * no hay filas. Y no toca `promo_products` — **nunca `select("*")` sobre esa tabla**, ni siquiera
 * para un manager: sus cinco columnas privadas están revocadas y la consulta entera fallaría.
 */
export default async function PromosIndex() {
  if (SIN_BASE) return <Pantalla rondas={RONDAS_DEMO} esAdmin />;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
    : { data: null };
  const esAdmin = me?.role === "admin";

  const { data: rondas } = await supabase
    .from("promo_rounds")
    .select("id, label, source_name, uploaded_at, closed_at")
    .order("uploaded_at", { ascending: false })
    .limit(50);

  return <Pantalla rondas={rondas ?? []} esAdmin={esAdmin} />;
}

type RondaDeLista = { id: string; label: string; source_name: string | null; uploaded_at: string; closed_at: string | null };

/** Lo que se pinta, aparte de dónde salen las rondas: así el modo demo usa la MISMA pantalla. */
function Pantalla({ rondas, esAdmin }: { rondas: readonly RondaDeLista[]; esAdmin: boolean }) {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 16px" }}>
      <h1 style={{ marginTop: 0 }}>🏷️ RTG PROMOS</h1>

      <div className="card">
        <div className="section-label">Rondas / Rounds</div>
        {!rondas.length ? (
          <p className="hint" style={{ marginBottom: 0 }}>
            Todavía no hay ninguna ronda. Una ronda es un Excel de promociones subido por un
            administrador.
            <br />
            No promo round yet. A round is a promo workbook uploaded by an admin.
          </p>
        ) : (
          <table style={{ marginTop: 6 }}>
            <thead>
              <tr><th>Ronda / Round</th><th>Fichero / File</th><th>Subida / Uploaded</th><th>Estado / State</th></tr>
            </thead>
            <tbody>
              {rondas.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/promos/${r.id}`}><b>{r.label}</b></Link></td>
                  <td className="hint">{r.source_name ?? "—"}</td>
                  <td className="hint">{new Date(r.uploaded_at as string).toLocaleString()}</td>
                  <td>{r.closed_at ? "Cerrada / Closed" : "Abierta / Open"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint" style={{ marginBottom: 0, marginTop: 10 }}>
          Toca una ronda para aprobar o rechazar sus productos. / Open a round to approve or reject
          its products.
        </p>
      </div>

      {esAdmin && (
        <p className="hint" style={{ marginTop: 12 }}>
          Antes de la primera ronda: el <b>grupo de promociones</b> de cada tienda, en{" "}
          <b>Datos → Tiendas</b>. Las tiendas que comparten grupo deciden juntas, y sin grupo nadie
          puede aprobar. / Before the first round: each store&apos;s <b>promo group</b>, in{" "}
          <b>Data → Stores</b>.
        </p>
      )}

      <p style={{ marginTop: 16 }}>
        <Link href="/home">← Volver / Back</Link>
      </p>
    </div>
  );
}
