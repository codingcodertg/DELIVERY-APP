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
//
// QUIEN toca estos numeros: el orquestador, AL FUSIONAR — nunca una rama.
// Cuando dos ramas suben la misma app a numeros DISTINTOS, git da conflicto y
// te enteras. El caso que pasa callado es el otro: las dos la suben al MISMO
// numero, git funde el cambio identico sin quejarse, y dos cambios acaban
// enviados bajo un solo bump — el cliente que ya tenia ese numero no vuelve a
// bajar nada (D-029/D-087) y se queda con codigo viejo sin que nadie lo note.
// Ver "Flujo de ramas" en CLAUDE.md y docs/WORKFLOW-PARALELO.md.
export const APP_VERSIONS = {
  deliveries: "1.56.0",
  recruiting: "0.13.1",
  timetracker: "0.49.9",
  clockin: "0.38.0",
  // El ERP no tenía contador propio: llegó en D-090 y nadie le puso uno, así que el
  // sello de versión no habría tenido qué enseñar en /erp. Empieza en 0.1.0 por la
  // misma razón que recruiting y timetracker — no hay historial independiente que
  // continuar, y un 1.0.0 sería continuidad inventada.
  erp: "0.3.13",
} as const;

export type AppKey = keyof typeof APP_VERSIONS;
