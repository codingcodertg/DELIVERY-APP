import type { Settings } from "@/lib/types";
import { cityFromAddress, todayISO } from "@/lib/utils";
import { puntoEnZonaLocal } from "@/lib/delivery-zone";

// ============================================================
// Delivery fee = a function of driving miles (the office's real formulas).
// Two prices per order: a standard "list" fee and a lower "discount" fee a
// rep may offer. Both round to the nearest $10. The fee depends on whether
// the delivery city is LOCAL:
//
//   LOCAL
//     list:      < 11 mi → $100 · > 50 mi → round10(350 + mi) · else round10(120 + mi·0.8)
//     discount:  < 11 mi →  $80 · > 50 mi → round10(200 + mi) · else round10(100 + mi·0.8)
//   NOT LOCAL (also flagged for manager approval)
//     list:      round10(500 + mi)
//     discount:  round10(400 + mi)
// ============================================================

/** Cities inside the LOCAL delivery zone (the red outline on the RGV map). */
export const LOCAL_CITIES_DEFAULT = [
  "La Joya", "Alton", "Edinburg", "Elsa", "Palmview",
  "Mission", "McAllen", "Pharr", "San Juan", "Alamo", "Donna",
  "Weslaco", "Mercedes", "La Feria", "Harlingen", "San Benito",
  "Rio Hondo", "Ranch Viejo", "Brownsville", "Port Isabel", "South Padre",
];

export function localCities(s?: Partial<Settings> | null): string[] {
  const c = s?.local_cities;
  return c && c.length ? c : LOCAL_CITIES_DEFAULT;
}

/** True when `city` is one of the configured local-zone cities (case-insensitive). */
export function isLocalCity(city: string, s?: Partial<Settings> | null): boolean {
  const needle = (city || "").trim().toLowerCase();
  if (!needle) return false;
  return localCities(s).some((c) => c.trim().toLowerCase() === needle);
}

/** Round to the nearest $10 (Excel ROUND(x, -1) for non-negative amounts). */
const round10 = (x: number) => Math.round(x / 10) * 10;

/** Standard "list" delivery fee for a mile figure. Not-local deliveries use a
 * higher base (500 + miles); local deliveries use the tiered local formula. */
export function listFee(miles: number, local = true): number {
  if (!local) return round10(500 + miles);
  if (miles < 11) return 100;
  if (miles > 50) return round10(350 + miles);
  return round10(120 + miles * 0.8);
}

/** Discounted delivery fee a rep may offer. Not-local: 400 + miles. */
export function discountFee(miles: number, local = true): number {
  if (!local) return round10(400 + miles);
  if (miles < 11) return 80;
  if (miles > 50) return round10(200 + miles);
  return round10(100 + miles * 0.8);
}

export type DeliveryZone = "local" | "nonlocal" | "unknown";

export interface FeeSuggestion {
  zone: DeliveryZone;
  /** Detected delivery city (best effort), for display. */
  city: string;
  /** Suggested standard price (incl. same-day surcharge), or null until miles are known. */
  list: number | null;
  /** Suggested discounted price a rep may offer (incl. same-day surcharge). */
  discount: number | null;
  /** NOT-LOCAL deliveries need manager approval before the price is committed. */
  needsApproval: boolean;
  /** The order is for same-day delivery and a surcharge applies. */
  sameDay: boolean;
  /** The same-day surcharge amount folded into list/discount ($), 0 if none. */
  sameDaySurcharge: number;
}

/** Suggest the delivery fee for an order from its driving miles (the formulas
 * above) plus a same-day surcharge when the delivery date is today. The
 * delivery city only sets the zone badge + approval flag. */
export function suggestDeliveryFee(
  d: {
    delivery_address?: string | null; route_miles?: number | null; delivery_date?: string | null;
    delivery_lat?: number | null; delivery_lng?: number | null;
  },
  s?: Partial<Settings> | null,
): FeeSuggestion {
  const hasAddr = !!(d.delivery_address || "").trim();
  const city = cityFromAddress(d.delivery_address, localCities(s));
  // Same-day surcharge: when the delivery is today and an admin has set an
  // amount in Settings (default 0 = off).
  const surcharge = Math.max(0, Number(s?.same_day_surcharge ?? 0));
  const sameDay = !!d.delivery_date && d.delivery_date === todayISO() && surcharge > 0;
  const add = sameDay ? surcharge : 0;
  if (!hasAddr) return { zone: "unknown", city: "", list: null, discount: null, needsApproval: false, sameDay, sameDaySurcharge: add };

  // La zona sale del PUNTO cuando lo hay (D-219): el nombre de la ciudad se saca de texto
  // libre y falla justo donde más duele. Sin punto se cae al método de siempre, sin cambiarlo.
  const porPunto = puntoEnZonaLocal(d.delivery_lat, d.delivery_lng);
  const local = porPunto ?? isLocalCity(city, s);
  const miles = d.route_miles;
  return {
    zone: local ? "local" : "nonlocal",
    city,
    list: miles != null ? listFee(miles, local) + add : null,
    discount: miles != null ? discountFee(miles, local) + add : null,
    needsApproval: !local,
    sameDay,
    sameDaySurcharge: add,
  };
}
