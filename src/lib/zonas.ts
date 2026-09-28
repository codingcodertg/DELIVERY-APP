/**
 * Zonas preferidas por chofer (D-421, migración 152).
 *
 * El dueño, 2026-09-27, literal: *«ernesto is mcallen mission and julio is phar thats their preferences as well as maximo
 * is brownsville only if possible»*. Preguntado si es regla o preferencia: *«Preferencia, no regla»* — el motor le da
 * primero a cada chofer las entregas de su zona; si su zona no llena el día, u otra zona se queda sin chofer, sí lleva de
 * otra.
 *
 * Aquí vive lo que decide, sin pantalla y sin base:
 *   · **Una zona es una CIUDAD de entrega**, la misma que enseña la columna «Ciudad de entrega» del Gestor (D-408):
 *     `ciudadDeEntrega(delivery_address)`. La orden no tiene campo de ciudad; no se inventa otra derivación.
 *   · **La lista de ciudades que se ofrecen sale de los datos**: las ciudades de las direcciones de las órdenes y de las
 *     tiendas de Ajustes, no una lista escrita en el código. Una zona ya guardada se sigue ofreciendo aunque hoy no salga.
 *   · **Se compara sin mayúsculas ni espacios de más** (`claveDeZona`, la del motor): «Mcallen» y «McAllen» son la misma.
 *   · **Sin zonas, nada cambia**: el motor planifica exactamente como antes.
 */
import { claveDeZona } from "@/lib/route-engine";
import { ciudadDeEntrega, ciudadesConocidas } from "@/lib/ciudad-de-entrega";
import type { Delivery, DriverSettings, NamedLocation, Profile } from "./types";

export { claveDeZona };

/** Cuántas zonas admite un chofer y cuánto mide cada nombre. Lo mismo que el `check` de la 152. */
export const MAX_ZONAS = 20;
export const MAX_LARGO_DE_ZONA = 60;

/** Una lista de zonas, limpia: sin vacíos, sin repetidos (sin mayúsculas), con la primera grafía, y dentro de los topes. */
export function limpiaZonas(lista: unknown): string[] {
  if (!Array.isArray(lista)) return [];
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const x of lista) {
    if (typeof x !== "string") continue;
    const nombre = x.trim().replace(/\s+/g, " ");
    const clave = nombre.toLowerCase();
    if (!nombre || nombre.length > MAX_LARGO_DE_ZONA || vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push(nombre);
  }
  return salida.slice(0, MAX_ZONAS);
}

/** Las zonas de un chofer, de su fila de `driver_settings`. Sin la columna (una base sin la 152), ninguna. */
export function zonasDelChofer(f: Pick<Partial<DriverSettings>, "preferred_zones"> | null | undefined): string[] {
  return limpiaZonas(f?.preferred_zones);
}

/** La zona de una orden: la ciudad de su dirección de entrega, como la columna del Gestor. «» = no se sabe. `conocidas`: las
 *  ciudades que pueden cerrar una dirección escrita sin comas (D-423; `ciudadDeEntrega`). */
export function zonaDeLaOrden(d: Pick<Partial<Delivery>, "delivery_address"> | null | undefined, conocidas: Iterable<string> = []): string {
  return ciudadDeEntrega(d?.delivery_address, conocidas);
}

/**
 * La zona de la RECOGIDA de una orden (D-427): la ciudad de la dirección de su tienda, leída como la de una entrega. La
 * tienda es la misma que usa «Planificar el día» como origen (`entradaDelDia`): la de `pickup_name` y, si no está o no
 * tiene punto, la de `store`. «» = no se sabe. El dueño, 2026-09-27: «no tiene sentido mandar a julio hasta brownsville si
 * ya te dije que ahi esta maximo» — recoger en la tienda de la zona de otro chofer también es entrar en su zona.
 */
export function zonaDeLaRecogida(
  d: Pick<Partial<Delivery>, "pickup_name" | "store"> | null | undefined,
  tiendas: readonly Pick<NamedLocation, "name" | "address" | "lat" | "lng">[],
  conocidas: Iterable<string> = [],
): string {
  const conPunto = (nombre: string | null | undefined) => {
    const n = String(nombre ?? "").trim().toLowerCase();
    return tiendas.find((t) => t.name.trim().toLowerCase() === n && t.lat != null && t.lng != null);
  };
  const t = conPunto(d?.pickup_name) ?? conPunto(d?.store);
  return t ? ciudadDeEntrega(t.address, conocidas) : "";
}

/**
 * Las ciudades que Ajustes ofrece como zona: las de las direcciones de entrega de las órdenes y las de las tiendas, más
 * las que ya tenga guardadas algún chofer. Agrupadas sin mayúsculas, con la grafía que más se repite, y de la más
 * frecuente a la menos (a igual cuenta, por nombre). `n` = cuántas órdenes van a esa ciudad.
 */
export function ciudadesElegibles(
  ordenes: readonly Pick<Partial<Delivery>, "delivery_address">[],
  tiendas: readonly Pick<NamedLocation, "address">[] = [],
  yaGuardadas: readonly string[] = [],
): { nombre: string; n: number }[] {
  const grupos = new Map<string, { n: number; grafias: Map<string, number> }>();
  const suma = (ciudad: string, cuenta: number) => {
    const nombre = ciudad.trim().replace(/\s+/g, " ");
    const clave = claveDeZona(nombre);
    if (!clave || nombre.length > MAX_LARGO_DE_ZONA) return;
    const g = grupos.get(clave) ?? { n: 0, grafias: new Map<string, number>() };
    g.n += cuenta;
    g.grafias.set(nombre, (g.grafias.get(nombre) ?? 0) + 1);
    grupos.set(clave, g);
  };
  // Las direcciones escritas sin comas (D-423) se leen con las ciudades que salen limpias de las demás y las ya guardadas.
  const conocidas = [...ciudadesConocidas([...ordenes.map((o) => o.delivery_address), ...tiendas.map((t) => t.address)]), ...yaGuardadas];
  for (const o of ordenes) suma(zonaDeLaOrden(o, conocidas), 1);
  for (const t of tiendas) suma(ciudadDeEntrega(t.address, conocidas), 0);
  for (const z of yaGuardadas) suma(z, 0);
  return [...grupos.values()]
    .map((g) => ({ nombre: [...g.grafias].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0], n: g.n }))
    .sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre));
}

/** Marcar o desmarcar una zona en la lista de un chofer. Compara sin mayúsculas; lo nuevo va al final. */
export function alternaZona(lista: unknown, zona: string): string[] {
  const actual = limpiaZonas(lista);
  const clave = claveDeZona(zona);
  if (!clave) return actual;
  return actual.some((z) => claveDeZona(z) === clave) ? actual.filter((z) => claveDeZona(z) !== clave) : limpiaZonas([...actual, zona]);
}

/** De las filas de `driver_settings` a «qué zonas prefiere cada chofer», por NOMBRE (como se asigna en el Gestor). */
export function zonasPorNombre(
  filas: readonly Pick<DriverSettings, "profile_id" | "preferred_zones">[],
  usuarios: readonly Pick<Profile, "id" | "full_name">[],
): Map<string, string[]> {
  const nombreDe = new Map(usuarios.map((u) => [u.id, (u.full_name ?? "").trim()]));
  const m = new Map<string, string[]>();
  for (const f of filas) {
    const nombre = nombreDe.get(f.profile_id);
    const zonas = zonasDelChofer(f);
    if (nombre && zonas.length) m.set(claveDeZona(nombre), zonas);
  }
  return m;
}

/** «📍 Mejor lugar» (solo sugerencia): ¿alguna de las órdenes marcadas es de la zona de este chofer? Por su entrega o, con
 *  las tiendas de Ajustes (D-427), por la tienda donde se recoge: la que sale de su tienda también es de su zona, salvo
 *  que vaya a una ciudad que no es zona de nadie. */
export function esDeSuZona(
  chofer: string, ordenes: readonly Pick<Partial<Delivery>, "delivery_address" | "pickup_name" | "store">[], zonas: ReadonlyMap<string, readonly string[]>,
  tiendas: readonly Pick<NamedLocation, "name" | "address" | "lat" | "lng">[] = [],
): boolean {
  const suyas = new Set((zonas.get(claveDeZona(chofer)) ?? []).map(claveDeZona));
  if (!suyas.size) return false;
  // Con las zonas de todos como conocidas (D-423): la misma lectura que hace «Planificar el día».
  const todas = [...zonas.values()].flat();
  // La tienda solo cuenta si la entrega es de la zona de alguien, como en el motor: a una ciudad sin dueño, por eficiencia.
  const reclamadas = new Set(todas.map(claveDeZona));
  return ordenes.some((o) => {
    const entrega = claveDeZona(zonaDeLaOrden(o, todas));
    return suyas.has(entrega) || (reclamadas.has(entrega) && suyas.has(claveDeZona(zonaDeLaRecogida(o, tiendas, todas))));
  });
}
