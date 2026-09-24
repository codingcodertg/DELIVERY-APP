import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { esDecisorDePromos, grupoDeLaTienda, type DecisionDeGrupo, type ProductoDeCatalogo } from "@/lib/promos/tabla";
import { tiendasSinGrupoDePromos } from "@/lib/promos/entrada";
import type { NamedLocation } from "@/lib/types";
import { RONDAS_DEMO } from "@/lib/promos/demo";
import { RondaDemo } from "./RondaDemo";
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

  // Modo demo: los datos son inventados (`lib/promos/demo`) y el ROL lo pone «Ver como», que vive
  // en `localStorage` — una pagina de servidor no lo puede leer, asi que lo hace `RondaDemo`.
  if (SIN_BASE) {
    const demo = RONDAS_DEMO.find((r) => r.id === id) ?? RONDAS_DEMO[0];
    return (
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 16px" }}>
        <RondaDemo ronda={{ id: demo.id, label: demo.label, closed_at: demo.closed_at }} />
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

  // Todas las rondas, para el selector que sustituye a la lista que se quitó (D-375). Son dos
  // campos y como mucho cincuenta filas: cuesta menos que la página que se ahorra.
  const { data: todasLasRondas } = await supabase
    .from("promo_rounds")
    .select("id, label, uploaded_at, closed_at")
    .order("uploaded_at", { ascending: false })
    .limit(50);

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
        rondas={(todasLasRondas ?? []) as { id: string; label: string; uploaded_at: string; closed_at: string | null }[]}
        tiendasSinGrupo={tiendasSinGrupoDePromos(tiendas)}
      />
    </div>
  );
}
