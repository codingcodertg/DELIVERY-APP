// Independent version counters, one per app sharing this single Next.js
// deploy (D-087) — replaces the single global APP_VERSION as the source of
// truth for what the update banner compares against. package.json's
// "version" is now the repo/monorepo version (still bumped, per CLAUDE.md,
// alongside whichever app(s) actually changed) — it is no longer what any
// client compares.
//
// deliveries kept its running number: it's the original app, no reason to
// reset a live counter. recruiting and timetracker start at 0.1.0, not
// 1.0.0 — this repo has no independent version history for either module.
// D-050 (recruiting becomes a module) and D-064 (timetracker merge) are
// both recorded against the OLD shared global counter (v1.9.6 and v1.15.0
// respectively), not a number of their own, so 0.1.0 is the honest
// starting point, not manufactured continuity.
export const APP_VERSIONS = {
  deliveries: "1.51.1",
  recruiting: "0.11.0",
  timetracker: "0.49.0",
  clockin: "0.38.0",
  // El ERP no tenía contador propio: llegó en D-090 y nadie le puso uno, así que el
  // sello de versión no habría tenido qué enseñar en /erp. Empieza en 0.1.0 por la
  // misma razón que recruiting y timetracker — no hay historial independiente que
  // continuar, y un 1.0.0 sería continuidad inventada.
  erp: "0.3.3",
} as const;

export type AppKey = keyof typeof APP_VERSIONS;
