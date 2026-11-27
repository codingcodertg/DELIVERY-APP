import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ultimoOk, motivoDeAviso, huella, HORAS_SIN_RESPALDO } from "../../scripts/respaldo/aviso.mjs";

// D-1205 · Lote 1 de la auditoría del 27 nov: aviso del respaldo, sin horarios duplicados en GitHub, y las migraciones
// 353 (purga de cachés), 354 (borrar adjuntos solo oficina) y 355 (quitar el job 1).

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const MARK = "-- @ledger-below";
const checksum = (t: string) => createHash("sha256").update(t.split(MARK)[0], "utf8").digest("hex");

describe("respaldo: avisa si falla o si lleva más de 26 h sin un respaldo bueno", () => {
  const registro = [
    "2026-11-25T10:00:03.000Z OK base 120.4 MB · archivos 3 nuevos de 900 · 0 respaldos viejos borrados · 300 s",
    "2026-11-26T10:00:03.000Z ERROR pg_dump.exe salió con 1: timeout",
  ].join("\n");

  it("toma el último OK, no el último renglón", () => {
    expect(ultimoOk(registro)?.toISOString()).toBe("2026-11-25T10:00:03.000Z");
    expect(ultimoOk("")).toBeNull();
  });

  it("avisa pasadas 26 h; calla antes", () => {
    expect(HORAS_SIN_RESPALDO).toBe(26);
    expect(motivoDeAviso(registro, new Date("2026-11-26T11:00:00Z"))).toBeNull();
    expect(motivoDeAviso(registro, new Date("2026-11-27T13:00:00Z"))).toMatch(/hace 50 horas/);
    expect(motivoDeAviso("", new Date())).toMatch(/ningún respaldo bueno/);
  });

  it("huella de 16 hex, la que acepta registrar_falla", () => {
    expect(huella("x")).toMatch(/^[0-9a-f]{16}$/);
    expect(huella("x")).toBe(huella("x"));
  });

  it("el script avisa en los dos caminos de falla y tiene el modo --revisa", () => {
    const s = leer("scripts/respaldo/respaldo.mjs");
    expect(s).toContain('process.argv.includes("--revisa")');
    expect(s).toContain("await avisa(`El respaldo FALLÓ: ${e.message}`);");
    expect(s).toMatch(/if \(a\.fallas\) \{ process\.exitCode = 2; await avisa\(/);
    expect(leer("scripts/respaldo/respaldo.cmd")).toContain("respaldo.mjs %*");
  });
});

describe("crons de GitHub: solo a mano (los corre pg_cron)", () => {
  for (const f of ["tt-cron", "rc-comms", "rc-choferes", "outlook-indeed"]) {
    it(f, () => {
      const y = leer(`.github/workflows/${f}.yml`);
      expect(y).not.toMatch(/^\s*schedule:/m);
      expect(y).toMatch(/^on:\n {2}workflow_dispatch: \{\}/m);
    });
  }
});

describe("migraciones 353–355", () => {
  const m = {
    353: leer("supabase/migrations/353_purga_de_caches.sql"),
    354: leer("supabase/migrations/354_borrar_adjuntos_solo_oficina.sql"),
    355: leer("supabase/migrations/355_quitar_cron_de_capturas.sql"),
  };

  it("cada registro declara el checksum de su cuerpo y ninguna trae begin/commit propio", () => {
    for (const [n, t] of Object.entries(m)) {
      const declarado = t.match(/values \('\d{3}_[a-z_]+\.sql', '([0-9a-f]{64})'\)/);
      expect(declarado?.[1], n).toBe(checksum(t));
      expect(t.split(MARK)[0], n).not.toMatch(/^\s*(begin|commit);/im);
    }
  });

  it("353 purga lo vencido y NO toca los tiempos sin tráfico (los usa el reporte de choferes)", () => {
    const c = m[353];
    expect(c).toContain("select cron.schedule('purga-caches-de-google', '40 9 * * *'");
    expect(c).toContain("delete from public.route_opt_cache   where created_at < now() - interval '1 day';");
    expect(c).toContain("delete from public.distance_cache    where created_at < now() - interval '14 days';");
    expect(c).toContain("delete from public.places_cache      where created_at < now() - interval '14 days';");
    expect(c).toContain("delete from public.travel_time_cache where traffic and fetched_at < now() - interval '28 days';");
    expect(c).not.toMatch(/geocode_cache\s+where/);
  });

  it("354: borra quien lo subió, admin u oficina; en la tabla y en el cubo", () => {
    const c = m[354].split(MARK)[0];
    expect(c).toContain('create policy "delivery files delete" on public.delivery_files for delete to authenticated');
    expect(c).toContain("created_by = (select auth.uid())");
    expect(c).toContain('create policy "delivery files bucket delete" on storage.objects for delete to authenticated');
    expect(c).toContain("owner_id = (select auth.uid())::text");
    expect(c.match(/\(select public\.current_user_role\(\)\) in \('manager', 'logistics', 'accounting'\)/g)).toHaveLength(2);
    expect(c.match(/or \(select public\.is_admin\(\)\)/g)).toHaveLength(2);
  });

  it("355 quita el job por nombre, no por número", () => {
    expect(m[355]).toContain("perform cron.unschedule('purge_old_timetracker_screenshots');");
    expect(m[355]).not.toMatch(/unschedule\(1\)/);
  });
});
