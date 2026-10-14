import type { Delivery, NamedLocation, Profile, UserRole } from "@/lib/types";
import { normalizaLugar } from "@/lib/order-endpoints";
import { orderTypeRule, type OrderTypeRules } from "@/lib/required";
import { tiendasDeAlmacen } from "@/lib/almacen";

/**
 * Qué choferes ve cada tienda en «🌐 Ruta de hoy» (D-NEXT).
 *
 * El dueño, 2026-10-13 (literal): «brownville people can only see max routes create that rule except for the manager, the
 * manager can see all drivers» · «all th eothers stores can see all drivers but not maximo, an exception for the managers and
 * admin» · «and unless is an interitenda going to their store».
 *
 * **La regla vive en los DATOS, no aquí.** Cada tienda de Ajustes (`settings.stores[*]`) puede llevar
 * `choferes_dedicados`: los nombres de los choferes que trabajan SOLO para ella. Eso dice dos cosas a la vez:
 *   1. la gente de esa tienda ve SOLO a esos choferes;
 *   2. la gente de las demás tiendas NO los ve.
 * Sin ninguna tienda con choferes dedicados —el caso de partida— nadie pierde nada: todos ven a todos, como antes.
 * No hay un solo nombre de chofer ni de tienda escrito en el código: lo edita un admin en Datos → Tiendas.
 *
 * **Quién ve a todos:** admin, logística y el gerente (`manager`). El dueño exceptuó a «the manager» y a «admin»; logística
 * planifica las rutas en el Gestor (D-494), y esconderle choferes en la copia de solo lectura no tendría sentido. El sandbox
 * de enseñanza tampoco tiene cortes.
 *
 * **El grupo de tiendas (D-293) cuenta.** Las tiendas que «trabajan juntas» se prestan choferes, así que el chofer dedicado
 * de una tienda NO se le esconde a la gente de otra tienda de su mismo grupo. Y quien está en una tienda con dedicados ve
 * solo los dedicados de su tienda (no los del grupo entero): es lo que dijo, «brownville people can only see max».
 *
 * **La excepción, por orden:** una Intertienda cuyo DESTINO (`delivery_name`, la regla de `almacen.ts`) es la tienda de quien
 * mira, o una de su grupo, se le enseña aunque vaya en un chofer que no ve. Se enseña ESA orden (y con ella la ruta del
 * chofer, solo con esas paradas); el resto de lo que lleva ese chofer sigue escondido. Para saber si es Intertienda y a
 * dónde va hace falta la orden entera: una parada de `rutas_del_dia` que esta persona no lee (sin tipo ni destino) no puede
 * entrar por la excepción, y se queda escondida — lo que no se sabe no se concede.
 *
 * **Es de PANTALLA.** La RLS de `deliveries` y la función `rutas_del_dia` (160) no cambian: la base sigue mandando esas
 * filas; «Ruta de hoy» no las pinta.
 */

/** Quien ve a TODOS los choferes en «Ruta de hoy», haya choferes dedicados o no. */
export const ROLES_VEN_TODOS_LOS_CHOFERES: readonly UserRole[] = ["admin", "logistics", "manager"];

const nombre = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export type AlcanceDeChoferes =
  | { tipo: "todos" }
  /** Su tienda tiene choferes dedicados: ve solo esos (normalizados). */
  | { tipo: "solo"; choferes: ReadonlySet<string> }
  /** Ve a todos menos a estos (los dedicados de tiendas que no son la suya ni de su grupo), normalizados. */
  | { tipo: "menos"; choferes: ReadonlySet<string> };

/** Los choferes dedicados de una tienda, normalizados. Vacío = la tienda no tiene. */
export function dedicadosDeLaTienda(tienda: Pick<NamedLocation, "choferes_dedicados"> | undefined): Set<string> {
  const lista = Array.isArray(tienda?.choferes_dedicados) ? tienda!.choferes_dedicados : [];
  return new Set(lista.map(nombre).filter(Boolean));
}

/**
 * ¿Qué choferes ve esta persona en «Ruta de hoy»?
 *
 * - admin, logística, gerente, o el sandbox: todos;
 * - su tienda tiene choferes dedicados: solo esos;
 * - si no: todos menos los dedicados de las tiendas que no son la suya ni de su grupo. Sin tienda asignada, todos menos
 *   TODOS los dedicados (un campo vacío no amplía, D-237).
 */
export function alcanceDeChoferes(
  me: Pick<Profile, "role" | "store"> | null | undefined,
  tiendas: readonly NamedLocation[],
  opts: { teaching?: boolean } = {},
): AlcanceDeChoferes {
  if (opts.teaching) return { tipo: "todos" };
  if (me && ROLES_VEN_TODOS_LOS_CHOFERES.includes(me.role)) return { tipo: "todos" };
  const mia = normalizaLugar(me?.store);
  const suya = mia ? tiendas.find((s) => normalizaLugar(s.name) === mia) : undefined;
  const propios = dedicadosDeLaTienda(suya);
  if (propios.size > 0) return { tipo: "solo", choferes: propios };
  const misTiendas = tiendasDeAlmacen(me?.store, tiendas as NamedLocation[]);
  const ajenos = new Set<string>();
  for (const s of tiendas) for (const c of dedicadosDeLaTienda(s)) ajenos.add(c);
  // Los dedicados de una tienda de MI grupo no se me esconden (aunque además los haya puesto otra tienda).
  for (const s of tiendas) {
    if (!misTiendas.includes(normalizaLugar(s.name))) continue;
    for (const c of dedicadosDeLaTienda(s)) ajenos.delete(c);
  }
  return ajenos.size > 0 ? { tipo: "menos", choferes: ajenos } : { tipo: "todos" };
}

/** ¿Ve a este chofer (por su nombre)? Lo que no va en ningún chofer no es de esta regla: se ve. */
export function veAlChofer(alcance: AlcanceDeChoferes, chofer: string | null | undefined): boolean {
  const n = nombre(chofer);
  if (!n || alcance.tipo === "todos") return true;
  if (alcance.tipo === "solo") return alcance.choferes.has(n);
  return !alcance.choferes.has(n);
}

/** La excepción: una Intertienda que ENTRA a mi tienda o a una de mi grupo (`delivery_name`). Sin tienda, ninguna. */
export function intertiendaHaciaMiTienda(
  d: Pick<Partial<Delivery>, "order_type" | "delivery_name">,
  me: Pick<Profile, "store"> | null | undefined,
  tiendas: readonly NamedLocation[],
  reglas: OrderTypeRules | undefined,
): boolean {
  if (orderTypeRule(d.order_type ?? "", reglas).storeToStore !== true) return false;
  const destino = normalizaLugar(d.delivery_name);
  if (!destino) return false;
  return tiendasDeAlmacen(me?.store, tiendas as NamedLocation[]).includes(destino);
}

/** ¿Pinta «Ruta de hoy» esta orden? La de un chofer que ve, la sin chofer, o la Intertienda que entra a su tienda. */
export function ordenVisiblePorChofer(
  d: Pick<Partial<Delivery>, "assigned_driver" | "order_type" | "delivery_name">,
  alcance: AlcanceDeChoferes,
  ctx: { me: Pick<Profile, "store"> | null | undefined; tiendas: readonly NamedLocation[]; reglas: OrderTypeRules | undefined },
): boolean {
  if (veAlChofer(alcance, d.assigned_driver)) return true;
  return intertiendaHaciaMiTienda(d, ctx.me, ctx.tiendas, ctx.reglas);
}

/** Las órdenes que «Ruta de hoy» pinta para esta persona. Todo lo demás de la pantalla cuelga de aquí. */
export function ordenesPorChofer<T extends Pick<Partial<Delivery>, "assigned_driver" | "order_type" | "delivery_name">>(
  ordenes: readonly T[],
  alcance: AlcanceDeChoferes,
  ctx: { me: Pick<Profile, "store"> | null | undefined; tiendas: readonly NamedLocation[]; reglas: OrderTypeRules | undefined },
): T[] {
  if (alcance.tipo === "todos") return ordenes as T[];
  return ordenes.filter((d) => ordenVisiblePorChofer(d, alcance, ctx));
}

/**
 * Lo rotulado con un chofer —su carril, su camión en vivo, el aviso de que su teléfono calla—: sale si ve a ese chofer, o si
 * ese chofer lleva alguna orden que sí se pinta (la excepción de la Intertienda). Una ruta temporal (`isBucket`) no es un
 * chofer: se queda.
 */
export function choferSeVe(
  chofer: string | null | undefined,
  alcance: AlcanceDeChoferes,
  conOrdenVisible: ReadonlySet<string>,
): boolean {
  return veAlChofer(alcance, chofer) || conOrdenVisible.has(nombre(chofer));
}

/** Los choferes (normalizados) que llevan alguna de estas órdenes. */
export function choferesConOrden(ordenes: readonly Pick<Partial<Delivery>, "assigned_driver">[]): Set<string> {
  return new Set(ordenes.map((d) => nombre(d.assigned_driver)).filter(Boolean));
}

/** Lo que escribe Datos → Tiendas: texto separado por comas o renglones → lista limpia, sin repetidos. */
export function leeDedicados(texto: string): string[] {
  const out: string[] = [];
  const vistos = new Set<string>();
  for (const trozo of texto.split(/[,\n;]/)) {
    const limpio = trozo.trim().replace(/\s+/g, " ");
    if (!limpio || vistos.has(nombre(limpio))) continue;
    vistos.add(nombre(limpio));
    out.push(limpio);
  }
  return out;
}
