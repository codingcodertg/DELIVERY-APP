import type { NamedLocation, Profile } from "@/lib/types";
import { esAdmin } from "@/lib/impersonation";

/**
 * La lista de «Switch usuario», agrupada por tienda (D-NEXT).
 *
 * El dueño lo pidió así —*«la lista sorted por tienda»*— y el orden importa más de lo que
 * parece: quien busca a alguien para reproducir un fallo no piensa «Patricia Hernández», piensa
 * «la de McAllen». Agrupar por tienda convierte una lista de treinta nombres en cuatro listas
 * cortas.
 *
 * Lógica pura, sin React: el orden es una decisión y se prueba como tal.
 */

export type FilaSwitch = {
  user: Profile;
  /** Un admin sale en la lista, pero sin botón: nunca se entra como otro admin (D-243). */
  puedeEntrar: boolean;
};

export type GrupoTienda = {
  /** El nombre de la tienda, o `null` para el grupo de los que no tienen ninguna. */
  tienda: string | null;
  filas: FilaSwitch[];
};

/**
 * Agrupa y ordena.
 *
 *  · Las tiendas **en el orden de Ajustes**, no alfabético: ese orden lo puso alguien y suele
 *    ser el que tiene en la cabeza quien mira.
 *  · Dentro de cada tienda, por nombre.
 *  · Los que no tienen tienda, **al final**, en su propio grupo. No se reparten ni se esconden:
 *    un usuario sin tienda sigue siendo alguien a quien se puede necesitar entrar.
 *  · Una tienda sin gente **no sale**. Un grupo vacío es ruido en una lista que existe para
 *    encontrar rápido.
 *
 * El filtro por nombre se aplica **antes** de agrupar, así que una tienda cuyos miembros no
 * casan desaparece en vez de quedarse como cabecera huérfana.
 */
export function agruparPorTienda(
  users: Profile[],
  tiendas: NamedLocation[],
  filtro = "",
): GrupoTienda[] {
  const aguja = filtro.trim().toLowerCase();
  const casan = aguja
    ? users.filter((u) => (u.full_name || "").toLowerCase().includes(aguja)
        || (u.username || "").toLowerCase().includes(aguja))
    : users;

  const porNombre = (a: Profile, b: Profile) =>
    (a.full_name || "").localeCompare(b.full_name || "", undefined, { sensitivity: "base" });

  const fila = (u: Profile): FilaSwitch => ({ user: u, puedeEntrar: !esAdmin(u.role) });

  const grupos: GrupoTienda[] = [];
  const yaPuestos = new Set<string>();

  for (const t of tiendas) {
    const suyos = casan.filter((u) => (u.store || "").trim() === t.name.trim() && t.name.trim() !== "");
    if (!suyos.length) continue;
    suyos.forEach((u) => yaPuestos.add(u.id));
    grupos.push({ tienda: t.name, filas: suyos.sort(porNombre).map(fila) });
  }

  // Todo lo que no cayó en una tienda conocida: sin tienda, o con una que ya no está en Ajustes.
  // Lo segundo importa — si una tienda se borra, su gente no puede desaparecer de la lista.
  const sueltos = casan.filter((u) => !yaPuestos.has(u.id));
  if (sueltos.length) grupos.push({ tienda: null, filas: sueltos.sort(porNombre).map(fila) });

  return grupos;
}

/** Cuánta gente hay en total, para decirlo cuando el filtro no encuentra a nadie. */
export function totalFilas(grupos: GrupoTienda[]): number {
  return grupos.reduce((n, g) => n + g.filas.length, 0);
}
