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
  deliveries: "1.24.0",
  recruiting: "0.3.1",
  timetracker: "0.3.1",
} as const;

export type AppKey = keyof typeof APP_VERSIONS;
