// Delivery fee formulas, ported from the deliveries app (ADR 0010). Framework-free (ADR 0006).
//
// These are the office's real pricing rules — money, not presentation — so they are ported verbatim
// rather than tidied. Two prices per order: a standard "list" fee and a lower "discount" fee a rep may
// offer. Both round to the nearest $10. Which formula applies depends on whether the delivery city is
// inside the LOCAL zone:
//
//   LOCAL
//     list:      < 11 mi → $100 · > 50 mi → round10(350 + mi) · else round10(120 + mi × 0.8)
//     discount:  < 11 mi →  $80 · > 50 mi → round10(200 + mi) · else round10(100 + mi × 0.8)
//   NOT LOCAL (also flagged for manager approval)
//     list:      round10(500 + mi)
//     discount:  round10(400 + mi)
//
// Note the boundaries are exclusive on both ends (`< 11`, `> 50`), so 11 and 50 both fall in the
// middle tier. That asymmetry is deliberate in the source and preserved here.

import { todayISO } from "./business-time";

/** Cities inside the LOCAL delivery zone (the red outline on the RGV map). */
export const LOCAL_CITIES_DEFAULT = [
  "La Joya", "Alton", "Edinburg", "Elsa", "Palmview",
  "Mission", "McAllen", "Pharr", "San Juan", "Alamo", "Donna",
  "Weslaco", "Mercedes", "La Feria", "Harlingen", "San Benito",
  "Rio Hondo", "Ranch Viejo", "Brownsville", "Port Isabel", "South Padre",
];

export interface PricingSettings {
  local_cities?: string[] | null;
  same_day_surcharge?: number | null;
}

export function localCities(s?: PricingSettings | null): string[] {
  const c = s?.local_cities;
  return c && c.length ? c : LOCAL_CITIES_DEFAULT;
}

/** True when `city` is one of the configured local-zone cities (case-insensitive). */
export function isLocalCity(city: string, s?: PricingSettings | null): boolean {
  const needle = (city || "").trim().toLowerCase();
  if (!needle) return false;
  return localCities(s).some((c) => c.trim().toLowerCase() === needle);
}

/** Round to the nearest $10 (Excel ROUND(x, -1) for non-negative amounts). */
const round10 = (x: number) => Math.round(x / 10) * 10;

/** Standard "list" delivery fee for a mile figure. */
export function listFee(miles: number, local = true): number {
  if (!local) return round10(500 + miles);
  if (miles < 11) return 100;
  if (miles > 50) return round10(350 + miles);
  return round10(120 + miles * 0.8);
}

/** Discounted delivery fee a rep may offer. */
export function discountFee(miles: number, local = true): number {
  if (!local) return round10(400 + miles);
  if (miles < 11) return 80;
  if (miles > 50) return round10(200 + miles);
  return round10(100 + miles * 0.8);
}

/**
 * Best-effort city name from a free-text address. Known city names are matched first (exact and
 * cheap), then the second-to-last comma segment — where the city lands in both a typed
 * "123 Main St, McAllen TX" address and a geocoded
 * "…, McAllen, Hidalgo County, Texas, 78501, …" one.
 */
export function cityFromAddress(address: string | null | undefined, knownCities: string[] = []): string {
  const a = (address || "").trim();
  if (!a) return "—";
  const lower = a.toLowerCase();
  for (const city of knownCities) {
    if (city && lower.includes(city.toLowerCase())) return city;
  }
  const parts = a.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || a;
}

export type DeliveryZone = "local" | "nonlocal" | "unknown";

export interface FeeSuggestion {
  zone: DeliveryZone;
  city: string;
  /** Suggested standard price (incl. same-day surcharge), or null until miles are known. */
  list: number | null;
  /** Suggested discounted price a rep may offer (incl. same-day surcharge). */
  discount: number | null;
  /** NOT-LOCAL deliveries need manager approval before the price is committed. */
  needsApproval: boolean;
  sameDay: boolean;
  /** The same-day surcharge folded into list/discount ($), 0 if none. */
  sameDaySurcharge: number;
}

/**
 * Suggest the delivery fee from driving miles, plus a same-day surcharge when the delivery is today.
 *
 * The fee is a function of MILES; the city only sets the zone badge and the approval flag. So an
 * order with an address but no route yet returns nulls rather than a guess — quoting a price the
 * mileage hasn't been computed for is worse than showing nothing.
 */
export function suggestDeliveryFee(
  d: { delivery_address?: string | null; route_miles?: number | null; delivery_date?: string | null },
  s?: PricingSettings | null,
  now: Date = new Date()
): FeeSuggestion {
  const hasAddr = !!(d.delivery_address || "").trim();
  const city = cityFromAddress(d.delivery_address, localCities(s));
  const surcharge = Math.max(0, Number(s?.same_day_surcharge ?? 0));
  const sameDay = !!d.delivery_date && d.delivery_date === todayISO(now) && surcharge > 0;
  const add = sameDay ? surcharge : 0;

  if (!hasAddr) {
    return { zone: "unknown", city: "", list: null, discount: null, needsApproval: false, sameDay, sameDaySurcharge: add };
  }

  const local = isLocalCity(city, s);
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
