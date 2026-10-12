import { pastillaDeMarca, type MarcaDeParada } from "@/lib/acciones-parada";

/** «Rechazada: razón», junto a la etapa (D-487). Órdenes, el Gestor (con su tabla) y la ficha. La razón también va en el
 *  `title`, por si no cabe. Colores del tema, no a pelo. «Saltada» se fue con el botón de saltar (D-520). */
export function PastillaDeMarca({ m, lang }: { m: MarcaDeParada | undefined; lang: "en" | "es" }) {
  const p = pastillaDeMarca(m, lang);
  if (!p) return null;
  return (
    <span className="sema" data-pastilla-marca={m?.marca} title={p.detalle || p.texto} style={{ background: p.fondo, color: p.tinta, marginLeft: 6 }}>
      {p.texto}{p.detalle ? `: ${p.detalle}` : ""}
    </span>
  );
}
