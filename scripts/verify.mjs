#!/usr/bin/env node
/**
 * Las tres verificaciones del flujo de CLAUDE.md, en un comando:
 *
 *   node scripts/verify.mjs
 *
 *   1. npx tsc --noEmit
 *   2. npx vitest run     -> reporta PASADOS | SALTADOS, nunca un solo numero
 *   3. npx next build
 *
 * Existe por el flujo de ramas (docs/WORKFLOW-PARALELO.md). Un worker trabaja en
 * un worktree bajo .claude/worktrees/, y ahi NO hay .env.local: ese fichero
 * queda deliberadamente fuera de .worktreeinclude porque lleva SUPABASE_DB_URL
 * (Postgres directo a produccion). Sin variables, `next build` puede tronar al
 * prerenderizar. Este script inyecta los MISMOS placeholders que usa el CI
 * (.github/workflows/ci.yml), asi que "verde en mi worktree" y "verde en el PR"
 * significan lo mismo.
 *
 * Los placeholders no apuntan a ningun proyecto real y no se hace ninguna
 * peticion de red: es la regla permanente de CLAUDE.md (las pruebas no disparan
 * efectos en terceros) aplicada tambien aqui.
 *
 * Si ya existe una variable en el entorno (por ejemplo porque corres esto en el
 * checkout principal, que si tiene .env.local), se RESPETA la tuya: el script
 * solo rellena lo que falta.
 *
 * Salidas: 0 si los tres pasos pasan; 1 en el primer paso que falle.
 */

import { spawnSync } from "node:child_process";

const PLACEHOLDERS = {
  NEXT_PUBLIC_SUPABASE_URL: "https://placeholder-ci.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ci-placeholder-not-a-real-key.ci-placeholder-signature",
  NEXT_TELEMETRY_DISABLED: "1",
};

const env = { ...process.env };
const injected = [];
for (const [k, v] of Object.entries(PLACEHOLDERS)) {
  if (!env[k]) {
    env[k] = v;
    injected.push(k);
  }
}

// No se usa `npx`. En Windows `npx` es un .cmd que spawnSync solo puede lanzar a
// traves del shell, y por ese camino `next build` moria a media compilacion
// (medido: build directo ok, build por cmd.exe fallaba). Se invocan los
// entrypoints de JavaScript con el mismo node que corre este script: sin shell,
// sin .cmd, sin DEP0190, e identico en Windows y en el ubuntu del CI.
const BIN = {
  tsc: "node_modules/typescript/bin/tsc",
  vitest: "node_modules/vitest/vitest.mjs",
  next: "node_modules/next/dist/bin/next",
};

/** Corre un paso. Devuelve { ok, out } y va escupiendo la salida en vivo. */
function step(title, [bin, ...args], { capture = false } = {}) {
  console.log(`\n─── ${title} ───`);
  const res = spawnSync(process.execPath, [BIN[bin], ...args], {
    env,
    encoding: "utf8",
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
  });
  if (res.error) console.error(String(res.error));
  let out = "";
  if (capture) {
    out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    process.stdout.write(out);
  }
  return { ok: res.status === 0, out };
}

if (injected.length > 0) {
  console.log(
    `Variables rellenadas con placeholders (no reales): ${injected.join(", ")}`,
  );
} else {
  console.log("Todas las variables ya estaban en el entorno; no se inyecto nada.");
}

// 1/3 --------------------------------------------------------------------
if (!step("1/3 · tipos (tsc --noEmit)", ["tsc", "--noEmit"]).ok) {
  console.error("\nFALLO en tsc. No sigo.");
  process.exit(1);
}

// 2/3 --------------------------------------------------------------------
const tests = step("2/3 · pruebas (vitest run)", ["vitest", "run"], {
  capture: true,
});
// La linea que importa: "Tests  704 passed | 3 skipped (707)". La repetimos al
// final para que el conteo no quede enterrado bajo la salida del build.
const testsLine =
  tests.out.split(/\r?\n/).filter((l) => /^\s*Tests\s+/.test(l)).pop() ?? null;
if (!tests.ok) {
  console.error("\nFALLO en vitest. No sigo.");
  if (testsLine) console.error(testsLine.trim());
  process.exit(1);
}

// 3/3 --------------------------------------------------------------------
if (!step("3/3 · build (next build)", ["next", "build"]).ok) {
  console.error("\nFALLO en next build.");
  process.exit(1);
}

// ------------------------------------------------------------------------
console.log("\n═══ Las tres verificaciones pasaron ═══");
console.log(
  testsLine
    ? testsLine.trim().replace(/passed/g, "pasados").replace(/skipped/g, "saltados")
    : "vitest: no se pudo leer el conteo (revisa la salida de arriba)",
);
console.log(
  "Los saltados no son fallos: hoy son los 3 de pdf.test.ts, cuyas fixtures viven fuera del repo.",
);
