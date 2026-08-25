// Which stops share a truck — capacity-constrained geographic clustering. Ported from the deliveries
// app (ADR 0010). Framework-free (ADR 0006), and already dependency-free in the source, so this is a
// near-verbatim port; the value was in differential-testing it, not rewriting it.
//
// WHICH STOPS SHARE A TRUCK.
//
// This is the decision the old splitter got wrong. It walked the stop list in
// whatever order it happened to be in and cut a new truckload every time the
// pallet count hit capacity — geography never entered into it. Two deliveries
// on the same street would land on different loads purely because the capacity
// boundary fell between them, and no amount of route optimizing afterwards can
// undo that: the router only reorders stops WITHIN a load it was handed.
//
// So the work splits cleanly in two:
//   here   — which stops share a truck (capacity-constrained clustering)
//   Google — the driving order inside each truck, with real traffic
//
// The clustering is Clarke–Wright savings, the standard heuristic for exactly
// this problem (capacitated vehicle routing from one depot), followed by an
// or-opt pass that relocates single stops between loads while that keeps
// helping. Distances here are straight-line: this stage only needs to know
// which stops are NEAR each other, and paying Google for a full distance
// matrix to answer that would cost a call per pair.
// ============================================================

export interface LatLng { lat: number; lng: number }

export interface BatchStop {
  id: string;
  lat: number | null | undefined;
  lng: number | null | undefined;
  /** Pallets this stop takes off the truck. */
  pallets: number;
}

const EARTH_MI = 3958.8;

/** Straight-line miles between two points. */
export function haversineMi(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(s)));
}

function located(s: BatchStop): s is BatchStop & { lat: number; lng: number } {
  return typeof s.lat === "number" && typeof s.lng === "number" && Number.isFinite(s.lat) && Number.isFinite(s.lng);
}

/**
 * Rough cost of running one load: out from the depot, round the stops, back.
 *
 * Nearest-neighbour then 2-opt. It isn't the true driving distance — Google
 * gives that later — but it ranks two candidate groupings against each other
 * consistently, which is all the improvement pass needs.
 */
export function loadCostMi(depot: LatLng, stops: (LatLng & { id: string })[]): number {
  if (stops.length === 0) return 0;
  if (stops.length === 1) return 2 * haversineMi(depot, stops[0]);

  // Nearest neighbour from the depot.
  const remaining = [...stops];
  const tour: (LatLng & { id: string })[] = [];
  let at: LatLng = depot;
  while (remaining.length) {
    let best = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (haversineMi(at, remaining[i]) < haversineMi(at, remaining[best])) best = i;
    }
    at = remaining[best];
    tour.push(remaining.splice(best, 1)[0]);
  }

  const legs = (t: (LatLng & { id: string })[]) => {
    let sum = haversineMi(depot, t[0]);
    for (let i = 1; i < t.length; i++) sum += haversineMi(t[i - 1], t[i]);
    return sum + haversineMi(t[t.length - 1], depot);
  };

  // 2-opt: keep reversing segments while that shortens the loop. Bounded so a
  // pathological set of stops can't spin the dispatcher's browser.
  let cost = legs(tour);
  for (let pass = 0; pass < 40; pass++) {
    let improved = false;
    for (let i = 0; i < tour.length - 1 && !improved; i++) {
      for (let j = i + 1; j < tour.length; j++) {
        const cand = [...tour.slice(0, i), ...tour.slice(i, j + 1).reverse(), ...tour.slice(j + 1)];
        const c = legs(cand);
        if (c < cost - 1e-9) {
          tour.splice(0, tour.length, ...cand);
          cost = c;
          improved = true;
          break;
        }
      }
    }
    if (!improved) break;
  }
  return cost;
}

/** Total straight-line cost of a whole grouping — the number the passes minimize. */
export function planCostMi(depot: LatLng, loads: BatchStop[][]): number {
  return loads.reduce((sum, load) => sum + loadCostMi(depot, load.filter(located)), 0);
}

function demand(load: BatchStop[]): number {
  return load.reduce((n, s) => n + (s.pallets || 0), 0);
}

/**
 * Group stops into truckloads by geography and capacity.
 *
 * Returns loads as arrays of stops. The order WITHIN a load is not meaningful —
 * the router decides that. The order OF the loads is by how far out they run,
 * so the long haul goes out first and the short one can be squeezed in later.
 *
 * Falls back to plain capacity filling when there's nothing to cluster on: no
 * depot to measure from, no capacity limit, or fewer than two located stops.
 */
export function buildGeoLoads(stops: BatchStop[], depot: LatLng | null, capacity: number): BatchStop[][] {
  const pins = stops.filter(located);
  if (!depot || capacity <= 0 || pins.length < 2) return fillByCapacity(stops, capacity);

  // --- Clarke–Wright savings ------------------------------------------------
  // s(i,j) = what you save by serving i and j on one trip instead of two:
  // the two separate round trips, minus the hop between them. Big savings mean
  // "these two belong together", which is exactly the judgement that was
  // missing before.
  const routes = new Map<string, BatchStop[]>();       // route key -> stops
  const routeOf = new Map<string, string>();           // stop id -> route key
  for (const s of pins) { routes.set(s.id, [s]); routeOf.set(s.id, s.id); }

  interface Saving { a: string; b: string; value: number }
  const savings: Saving[] = [];
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      const a = pins[i], b = pins[j];
      savings.push({
        a: a.id,
        b: b.id,
        value: haversineMi(depot, a) + haversineMi(depot, b) - haversineMi(a, b),
      });
    }
  }
  // Ties broken by id so the same board always produces the same loads —
  // a dispatcher re-running optimize should not get a different answer.
  savings.sort((x, y) => y.value - x.value || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));

  const isEndpoint = (route: BatchStop[], id: string) =>
    route.length === 1 || route[0].id === id || route[route.length - 1].id === id;

  for (const { a, b } of savings) {
    const ka = routeOf.get(a)!, kb = routeOf.get(b)!;
    if (ka === kb) continue;                                   // already together
    const ra = routes.get(ka)!, rb = routes.get(kb)!;
    // Only ends may be joined — merging through the middle of a route would
    // break the chain the savings were computed on.
    if (!isEndpoint(ra, a) || !isEndpoint(rb, b)) continue;
    if (demand(ra) + demand(rb) > capacity) continue;          // won't fit on one truck

    const aFirst = ra[0].id === a;
    const bLast = rb[rb.length - 1].id === b;
    const left = aFirst ? [...ra].reverse() : ra;
    const right = bLast ? [...rb].reverse() : rb;
    const merged = [...left, ...right];

    routes.set(ka, merged);
    routes.delete(kb);
    for (const s of rb) routeOf.set(s.id, ka);
  }

  let loads = [...routes.values()];

  // --- Or-opt: move a single stop to a better load --------------------------
  // Savings merges pairs greedily and can strand a stop on the wrong truck.
  // Relocating one stop at a time, keeping only moves that shorten the whole
  // plan and still fit, cleans that up.
  for (let pass = 0; pass < 12; pass++) {
    let improved = false;
    for (let from = 0; from < loads.length && !improved; from++) {
      for (let si = 0; si < loads[from].length && !improved; si++) {
        const stop = loads[from][si];
        if (!located(stop)) continue;
        for (let to = 0; to < loads.length; to++) {
          if (to === from) continue;
          if (demand(loads[to]) + (stop.pallets || 0) > capacity) continue;
          const before = loadCostMi(depot, loads[from].filter(located)) + loadCostMi(depot, loads[to].filter(located));
          const shrunk = loads[from].filter((_, k) => k !== si);
          const grown = [...loads[to], stop];
          const after = loadCostMi(depot, shrunk.filter(located)) + loadCostMi(depot, grown.filter(located));
          if (after < before - 1e-6) {
            loads[from] = shrunk;
            loads[to] = grown;
            improved = true;
            break;
          }
        }
      }
    }
    loads = loads.filter((l) => l.length > 0);
    if (!improved) break;
  }

  // --- Stops with no pin ----------------------------------------------------
  // They can't be clustered, but they still have to go out. Drop them where
  // there's room rather than inventing a load for each.
  const unpinned = stops.filter((s) => !located(s));
  for (const s of unpinned) {
    const room = loads.find((l) => demand(l) + (s.pallets || 0) <= capacity);
    if (room) room.push(s);
    else loads.push([s]);
  }

  // Furthest-reaching load first: the long run wants the morning.
  return loads
    .map((load) => ({ load, reach: Math.max(0, ...load.filter(located).map((s) => haversineMi(depot, s))) }))
    .sort((x, y) => y.reach - x.reach)
    .map((x) => x.load);
}

/**
 * The old behaviour: fill a truck in list order until it's full, then start
 * another. Kept as the fallback for when there's nothing to cluster on.
 */
export function fillByCapacity(stops: BatchStop[], capacity: number): BatchStop[][] {
  const loads: BatchStop[][] = [];
  let current: BatchStop[] = [];
  let load = 0;
  for (const s of stops) {
    const p = s.pallets || 0;
    if (current.length && capacity > 0 && load + p > capacity) {
      loads.push(current);
      current = [];
      load = 0;
    }
    current.push(s);
    load += p;
  }
  if (current.length) loads.push(current);
  return loads;
}
