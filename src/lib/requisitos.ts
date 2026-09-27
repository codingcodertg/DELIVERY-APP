/**
 * Requisitos del camión (D-NEXT, migración 151), como las `skills` / `vehicleFeatures` de OptimoRoute.
 *
 * El dueño, 2026-09-27, tras explicarle OptimoRoute: *«solos haz 1 3 y 4»*. El 4 incluía esto: una orden puede pedir
 * algo del camión (liftgate, montacargas, camión grande, dos personas) y cada chofer declara lo que tiene. Lo automático
 * —«Planificar el día» y «Mejor lugar»— **no le da una orden a un chofer que no lo tiene**, y dice por qué. Auto-asignar
 * no, en esta rama: el orquestador lo sacó del alcance (2026-09-27) porque otra rama lo reescribe sobre el motor.
 *
 * Aquí vive todo lo que decide, sin pantalla y sin base:
 *   · **El catálogo** es de Ajustes (`settings.delivery_requirements`), no del código: los nombres los pone el admin.
 *   · **Se compara sin mayúsculas ni espacios de más**: «Liftgate» y « liftgate» son lo mismo.
 *   · **Solo cuenta lo que está en el catálogo.** Quitar un requisito del catálogo lo apaga en todas las órdenes y
 *     choferes a la vez; no se queda ninguna orden atada a algo que ya nadie puede declarar.
 *   · **Sin requisitos, nada cambia**: una orden que no pide nada va con cualquiera, como hasta hoy.
 */
import type { Delivery, DriverSettings, Profile, Settings } from "./types";

/** Cuántos requisitos admite el catálogo y cuánto mide cada nombre. Lo mismo que el `check` de la 151. */
export const MAX_REQUISITOS = 30;
export const MAX_LARGO_DE_REQUISITO = 40;

export const claveDeRequisito = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Una lista de textos, limpia: sin vacíos, sin repetidos (sin mayúsculas), con la primera grafía que aparece. */
function limpia(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const x of lista) {
    if (typeof x !== "string") continue;
    const nombre = x.trim().replace(/\s+/g, " ");
    const clave = nombre.toLowerCase();
    if (!nombre || vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push(nombre);
  }
  return salida;
}

/** El catálogo de Ajustes, limpio. Sin la columna (una base sin la 151), vacío: no hay requisitos. */
export function catalogoDeRequisitos(settings: Pick<Settings, "delivery_requirements"> | null | undefined): string[] {
  return limpia(settings?.delivery_requirements).slice(0, MAX_REQUISITOS);
}

/** ¿La base ya tiene el catálogo? `settings` se lee con `select("*")`: si trae la clave, la columna existe. */
export function laBaseTieneRequisitos(settings: object | null | undefined): boolean {
  return !!settings && "delivery_requirements" in settings;
}

/** Lo que de una lista está en el catálogo, con la grafía del catálogo y en su orden. */
export function delCatalogo(lista: unknown, catalogo: readonly string[]): string[] {
  const pedidas = new Set(limpia(lista).map(claveDeRequisito));
  return catalogo.filter((c) => pedidas.has(claveDeRequisito(c)));
}

/** Lo que pide una orden, en lo que cuenta: lo del catálogo. */
export function requisitosDeLaOrden(d: Pick<Partial<Delivery>, "requirements"> | null | undefined, catalogo: readonly string[]): string[] {
  return delCatalogo(d?.requirements, catalogo);
}

/** Lo que tiene un chofer, en lo que cuenta: lo del catálogo. */
export function habilidadesDelChofer(f: Pick<Partial<DriverSettings>, "features"> | null | undefined, catalogo: readonly string[]): string[] {
  return delCatalogo(f?.features, catalogo);
}

/** Lo que pide la orden y el chofer no tiene. Vacío = puede llevarla. Compara sin mayúsculas. */
export function faltan(requisitos: readonly string[], habilidades: readonly string[] | null | undefined): string[] {
  if (!requisitos.length) return [];
  const tiene = new Set((habilidades ?? []).map(claveDeRequisito));
  return requisitos.filter((r) => !tiene.has(claveDeRequisito(r)));
}

/** «falta Liftgate» / «faltan Liftgate y Montacargas». La frase del motivo, en los dos idiomas. */
export function fraseDeFaltan(lista: readonly string[], lang: "en" | "es"): string {
  if (!lista.length) return "";
  const y = lang === "es" ? " y " : " and ";
  const unidas = lista.length === 1 ? lista[0] : `${lista.slice(0, -1).join(", ")}${y}${lista[lista.length - 1]}`;
  if (lang === "es") return `${lista.length === 1 ? "falta" : "faltan"} ${unidas}`;
  return `missing ${unidas}`;
}

/**
 * De las filas de `driver_settings` a «qué tiene cada chofer», por NOMBRE: es como se asigna en el Gestor
 * (`deliveries.assigned_driver`). Un chofer sin fila no tiene nada.
 */
export function habilidadesPorNombre(
  filas: readonly Pick<DriverSettings, "profile_id" | "features">[],
  usuarios: readonly Pick<Profile, "id" | "full_name">[],
  catalogo: readonly string[],
): Map<string, string[]> {
  const nombreDe = new Map(usuarios.map((u) => [u.id, (u.full_name ?? "").trim()]));
  const m = new Map<string, string[]>();
  for (const f of filas) {
    const nombre = nombreDe.get(f.profile_id);
    if (nombre) m.set(claveDeRequisito(nombre), habilidadesDelChofer(f, catalogo));
  }
  return m;
}

/**
 * La pregunta que hace «Mejor lugar»: ¿qué le falta a este chofer para llevar esta orden? Vacío = nada.
 * `habilidades` es lo de `habilidadesPorNombre`. Una ruta temporal (un «route bucket», no un chofer) no se filtra: es un
 * carril manual que arma una persona, no un camión que declare nada.
 */
export function faltanAlChofer(
  orden: Pick<Partial<Delivery>, "requirements">,
  chofer: string,
  catalogo: readonly string[],
  habilidades: ReadonlyMap<string, readonly string[]>,
  carriles: readonly string[] = [],
): string[] {
  const pide = requisitosDeLaOrden(orden, catalogo);
  if (!pide.length) return [];
  if (carriles.some((c) => claveDeRequisito(c) === claveDeRequisito(chofer))) return [];
  return faltan(pide, habilidades.get(claveDeRequisito(chofer)) ?? []);
}

/** Lo que se manda al guardar una orden: la clave solo si la base tiene la columna. Sin ella, mandarla haría fallar el
 *  guardado de la orden ENTERA (PostgREST no la conoce), como con la prioridad (D-412). */
export function laBaseTieneRequisitosEnOrdenes(ordenes: readonly object[]): boolean {
  return ordenes.some((o) => "requirements" in o);
}

export function conRequisitosSiCabe<T extends { requirements?: string[] | null }>(payload: T, ordenes: readonly object[]): T {
  if (laBaseTieneRequisitosEnOrdenes(ordenes)) return payload;
  const { requirements: _fuera, ...resto } = payload;
  void _fuera;
  return resto as T;
}

/** Marcar o desmarcar un requisito en una lista (la de una orden o la de un chofer). Devuelve la lista en el orden del
 *  catálogo, y sin lo que ya no está en él. */
export function alternaRequisito(lista: unknown, requisito: string, catalogo: readonly string[]): string[] {
  const actual = delCatalogo(lista, catalogo);
  const clave = claveDeRequisito(requisito);
  const tiene = actual.some((r) => claveDeRequisito(r) === clave);
  const siguiente = tiene ? actual.filter((r) => claveDeRequisito(r) !== clave) : [...actual, requisito];
  return delCatalogo(siguiente, catalogo);
}

/** El catálogo al añadir un nombre: `null` si no vale (vacío, largo, repetido o lleno), con el porqué. */
export function anadeAlCatalogo(catalogo: readonly string[], nombre: string): { ok: true; catalogo: string[] } | { ok: false; motivo: "vacio" | "largo" | "repetido" | "lleno" } {
  const limpio = nombre.trim().replace(/\s+/g, " ");
  if (!limpio) return { ok: false, motivo: "vacio" };
  if (limpio.length > MAX_LARGO_DE_REQUISITO) return { ok: false, motivo: "largo" };
  if (catalogo.some((c) => claveDeRequisito(c) === claveDeRequisito(limpio))) return { ok: false, motivo: "repetido" };
  if (catalogo.length >= MAX_REQUISITOS) return { ok: false, motivo: "lleno" };
  return { ok: true, catalogo: [...catalogo, limpio] };
}
