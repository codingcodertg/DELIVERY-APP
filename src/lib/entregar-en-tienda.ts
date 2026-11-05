import type { NamedLocation, Settings } from "./types";

/** D-NEXT: «Entregué en otra dirección» con lista de tiendas/bodegas. Ernesto (chofer): «I also want dropdowns so I
 *  can just select the store». Las opciones son las tiendas de Datos (`settings.stores`, bodegas incluidas) y los puntos
 *  de recogida guardados (`pickup_locations`), sin repetir nombre y solo los que tienen dirección: elegir una llena el
 *  mismo texto libre de siempre (`delivered_address`), así informes e historial no cambian. */
export interface LugarDeEntrega {
  name: string;
  address: string;
  bodega: boolean;
  lat: number | null;
  lng: number | null;
}

export function lugaresParaEntregarEn(settings: Pick<Settings, "stores" | "pickup_locations">): LugarDeEntrega[] {
  const vistos = new Set<string>();
  const out: LugarDeEntrega[] = [];
  const add = (l: NamedLocation, bodega: boolean) => {
    const name = (l.name || "").trim();
    const address = (l.address || "").trim();
    const key = name.toLowerCase();
    if (!name || !address || vistos.has(key)) return;
    vistos.add(key);
    const conPunto = typeof l.lat === "number" && typeof l.lng === "number";
    out.push({ name, address, bodega, lat: conPunto ? l.lat! : null, lng: conPunto ? l.lng! : null });
  };
  for (const s of settings.stores ?? []) add(s, !!s.bodega);
  for (const p of settings.pickup_locations ?? []) add(p, true);
  // Tiendas primero, luego bodegas; cada grupo por nombre.
  return out.sort((a, b) => Number(a.bodega) - Number(b.bodega) || a.name.localeCompare(b.name));
}

/** El lugar cuya dirección es la que está escrita (para que la lista muestre el elegido y vuelva a «—» si el chofer
 *  edita el texto a mano). Compara sin mayúsculas ni espacios de más. */
export function lugarDeLaDireccion(lugares: LugarDeEntrega[], direccion: string): LugarDeEntrega | null {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const d = norm(direccion);
  if (!d) return null;
  return lugares.find((l) => norm(l.address) === d) ?? null;
}
