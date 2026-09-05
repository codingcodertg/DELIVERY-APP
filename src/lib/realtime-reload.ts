// ============================================================
// Which queries a realtime event has to re-run (G-15, D-201).
//
// The deliveries provider used to hook eight tables to ONE handler that re-ran
// all nine queries (`reloadAll`), so a driver tapping "delivered" — two rows,
// deliveries + order_events — made every open session download the whole app
// state again (deliveries included, whole, before G-16). This maps each table
// to the one query that actually changed. driver_locations is not here: its
// INSERTs are applied straight to the driver's dot (see the provider).
//
// Pure, so the before/after can be measured in a test instead of asserted.
// ============================================================

/** The nine queries `reloadAll` runs, in its order. */
export const ALL_QUERIES = [
  "settings", "profiles", "deliveries", "order_events", "notifications",
  "driver_availability", "driver_shifts", "driver_incidents", "driver_locations",
] as const;
export type QueryName = (typeof ALL_QUERIES)[number];

/** Realtime table → the query that has to be re-run. One each; that is the point. */
export const QUERY_OF_TABLE: Record<string, QueryName> = {
  settings: "settings",
  profiles: "profiles",
  deliveries: "deliveries",
  order_events: "order_events",
  notifications: "notifications",
  driver_availability: "driver_availability",
  driver_shifts: "driver_shifts",
  driver_incidents: "driver_incidents",
};

/**
 * The queries to run for a burst of realtime events (the tables that changed while the
 * debounce was open), in `ALL_QUERIES` order and without duplicates. A table nobody mapped
 * falls back to everything: a silent skip would leave stale state, which is worse than one
 * extra reload.
 */
export function queriesForTables(tables: Iterable<string>): QueryName[] {
  const wanted = new Set<QueryName>();
  for (const t of tables) {
    const q = QUERY_OF_TABLE[t];
    if (!q) return [...ALL_QUERIES];
    wanted.add(q);
  }
  return ALL_QUERIES.filter((q) => wanted.has(q));
}

/** What the old handler did: every event, every query. Kept so the test can state the "before". */
export function queriesBefore(tables: Iterable<string>): QueryName[] {
  let any = false;
  for (const _ of tables) { any = true; break; }
  return any ? [...ALL_QUERIES] : [];
}
