import { pestanasVisibles } from "@/lib/recruiting/vista-del-gerente";

/**
 * D-NEXT: la barra de RR. HH. ya no es una fila de pestañas sino dos menús, «Recruiting» y «HR», más Ajustes suelto.
 * El dueño: «solo va a haber dos, así como dos divisiones para que ya se abramos y pase un drop down de esos menús».
 * El filtro por rol es el de siempre (`pestanasVisibles`, y «Crear usuarios» además pide admin del hub); un menú que se
 * queda sin opciones no se pinta.
 */
export type GrupoDeMenu = "recruiting" | "hr";
export type PestanaConGrupo = { id: string; href: string; adminOnly?: boolean; roles?: string[]; grupo: GrupoDeMenu | null };

export const NOMBRE_DEL_GRUPO: Record<GrupoDeMenu, { en: string; es: string }> = {
  recruiting: { en: "Recruiting", es: "Recruiting" },
  hr: { en: "HR", es: "RR. HH." },
};

export function menusDeRrhh<T extends PestanaConGrupo>(tabs: readonly T[], rolRrhh: string, rolDelHub: string) {
  const visibles = pestanasVisibles(tabs, rolRrhh).filter((t) => t.id !== "user-creation" || rolDelHub === "admin");
  const grupos = (["recruiting", "hr"] as const)
    .map((g) => ({ grupo: g, items: visibles.filter((t) => t.grupo === g) }))
    .filter((g) => g.items.length > 0);
  return { grupos, sueltas: visibles.filter((t) => t.grupo === null) };
}

/** "/recruiting" (Candidatos) va por igualdad: con startsWith se encendería en /recruiting/board y en todas. */
export function pestanaActiva(href: string, pathname: string): boolean {
  return href === "/recruiting" ? pathname === "/recruiting" : pathname.startsWith(href);
}
