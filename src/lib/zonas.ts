/**
 * Zonas preferidas por chofer (D-NEXT, migración 152).
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
import { ciudadDeEntrega } from "@/lib/ciudad-de-entrega";
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

/** La zona de una orden: la ciudad de su dirección de entrega, como la columna del Gestor. «» = no se sabe. */
export function zonaDeLaOrden(d: Pick<Partial<Delivery>, "delivery_address"> | null | undefined): string {
  return ciudadDeEntrega(d?.delivery_address);
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
  for (const o of ordenes) suma(zonaDeLaOrden(o), 1);
  for (const t of tiendas) suma(ciudadDeEntrega(t.address), 0);
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

/** «📍 Mejor lugar» (solo sugerencia): ¿alguna de las órdenes marcadas es de la zona de este chofer? */
export function esDeSuZona(chofer: string, ordenes: readonly Pick<Partial<Delivery>, "delivery_address">[], zonas: ReadonlyMap<string, readonly string[]>): boolean {
  const suyas = new Set((zonas.get(claveDeZona(chofer)) ?? []).map(claveDeZona));
  if (!suyas.size) return false;
  return ordenes.some((o) => suyas.has(claveDeZona(zonaDeLaOrden(o))));
}
