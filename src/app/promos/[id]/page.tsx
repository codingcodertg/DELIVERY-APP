import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { esDecisorDePromos, grupoDeLaTienda, type DecisionDeGrupo, type ProductoDeCatalogo } from "@/lib/promos/tabla";
import type { NamedLocation } from "@/lib/types";
import { DECISIONES_DEMO, GRUPOS_DEMO_LISTA, PRODUCTOS_DEMO, RONDAS_DEMO } from "@/lib/promos/demo";
import { TablaDeRonda } from "./TablaDeRonda";

export const dynamic = "force-dynamic";
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * Una ronda: su catálogo y las decisiones del grupo de quien mira.
 *
 * **Se lee `promo_catalog`, nunca `promo_products`.** Las cinco columnas privadas están revocadas en
 * la tabla, así que una consulta a la tabla que las nombrara fallaría **para todo el mundo, manager
 * incluido**; la vista las sirve por la función `promo_private`, que devuelve `null` a quien no
 * puede verlas. Y de ahí sale otra cosa buena: **si alguien puede ver el costo se deduce del DATO**
 * —`private` llegó o no llegó— en vez de volver a calcular aquí la regla que ya está en la base. Un
 * dato medido no puede discrepar; una regla copiada, sí.
 *
 * Las decisiones se leen TODAS las de la ronda (la RLS deja leerlas a cualquiera con el módulo,
 * porque un vendedor necesita el estado por tienda para filtrar) y la tabla casa las del grupo que
 * se esté mirando.
 */
export default async function RondaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Modo demo: los datos son inventados (`lib/promos/demo`) y quien mira es un admin, para que se
  // vea la pantalla entera — el selector de grupo, el cierre de ronda y las cinco privadas.
  if (SIN_BASE) {
    const demo = RONDAS_DEMO.find((r) => r.id === id) ?? RONDAS_DEMO[0];
    return (
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 16px" }}>
        <p style={{ margin: "0 0 8px" }}><Link href="/promos">← RTG PROMOS</Link></p>
        <TablaDeRonda
          ronda={{ id: demo.id, label: demo.label, closed_at: demo.closed_at }}
          productos={demo.id === "demo-ronda-1" ? PRODUCTOS_DEMO : []}
          decisiones={demo.id === "demo-ronda-1" ? DECISIONES_DEMO : []}
          rol="admin"
          userId={null}
          grupo={GRUPOS_DEMO_LISTA[0]}
          esDecisor
          esAdmin
          gruposDelLibro={GRUPOS_DEMO_LISTA}
        />
      </div>
    );
  }

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase.from("profiles").select("role, store").eq("id", user.id).maybeSingle()
    : { data: null };

  const { data: ronda } = await supabase
    .from("promo_rounds")
    .select("id, label, source_name, uploaded_at, closed_at")
    .eq("id", id)
    .maybeSingle();
  if (!ronda) notFound();

  const { data: ajustes } = await supabase.from("settings").select("stores").eq("id", 1).maybeSingle();
  const tiendas = (ajustes?.stores ?? []) as NamedLocation[];

  const { data: productos } = await supabase
    .from("promo_catalog")
    .select("round_id, code, supplier, size, description, qoh, qoh_by_store, price, source_sheet, row_no, private")
    .eq("round_id", id)
    .order("row_no", { ascending: true })
    .limit(5000);

  const { data: decisiones } = await supabase
    .from("promo_decisions")
    .select("round_id, code, group_code, status, note")
    .eq("round_id", id)
    .limit(20000);

  const rol = me?.role ?? null;
  const grupo = grupoDeLaTienda(tiendas, me?.store ?? null);
  const gruposDelLibro = Array.from(
    new Set(tiendas.map((t) => (t.promo_group ?? "").trim()).filter((g) => g !== "")),
  );

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 16px" }}>
      <p style={{ margin: "0 0 8px" }}><Link href="/promos">← RTG PROMOS</Link></p>
      <TablaDeRonda
        ronda={{
          id: ronda.id as string,
          label: ronda.label as string,
          closed_at: (ronda.closed_at as string | null) ?? null,
        }}
        productos={(productos ?? []) as unknown as ProductoDeCatalogo[]}
        decisiones={(decisiones ?? []) as unknown as DecisionDeGrupo[]}
        rol={rol}
        userId={user?.id ?? null}
        grupo={grupo}
        esDecisor={esDecisorDePromos({ rol, grupo })}
        esAdmin={rol === "admin"}
        gruposDelLibro={gruposDelLibro}
      />
    </div>
  );
}
