import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// ============================================================
// 332 · paradas con foto (2026-11-19). La migración no se aplica desde aquí: esta prueba fija lo que tiene que decir el SQL
// (la constraint de galones y no la de recibo, la política de update de cualquier motivo, y que el trigger de 306 no se
// toca) y que termina en la marca del libro, sin la línea del libro (la pone el dueño).
// ============================================================

const leer = (r: string) => readFileSync(r, "utf8").split(/\r?\n/).join("\n");
const sql = leer("supabase/migrations/332_paradas_con_foto.sql");
const lineas = sql.split("\n");

describe("332 · paradas con foto: forma de la migración", () => {
  it("termina en la marca del libro, sin su línea de registro (la pone el dueño)", () => {
    const noVacias = lineas.filter((l) => l.trim() !== "");
    expect(noVacias.at(-1)).toBe("-- @ledger-below");
    expect(sql).not.toContain("insert into public.schema_migrations");
  });

  it("quita la constraint que prohibía recibo fuera de la gasolina, y pone la de galones", () => {
    expect(sql).toContain("alter table public.pausas_del_chofer drop constraint if exists pausas_recibo_solo_gasolina;");
    expect(sql).toContain("add constraint pausas_galones_solo_gasolina");
    expect(sql).toContain("check (motivo = 'gas' or (recibo_galones is null and not sin_recibo))");
  });

  it("la constraint nueva no toca la foto ni el monto: esos valen para cualquier motivo", () => {
    const nueva = sql.slice(sql.indexOf("add constraint pausas_galones_solo_gasolina"));
    expect(nueva.slice(0, 160)).not.toMatch(/recibo_foto|recibo_monto/);
  });

  it("la política de update deja tocar una cerrada de cualquier motivo sin foto ni «no tengo recibo»", () => {
    expect(sql).toMatch(/create policy "pausas update" on public\.pausas_del_chofer for update to authenticated\s+using \(driver_id = \(select auth\.uid\(\)\)\s+and \(termino_at is null or \(recibo_foto is null and sin_recibo = false\)\)\)/);
    expect(sql).not.toContain("motivo = 'gas' and recibo_foto is null");
  });

  it("no redefine el trigger de 306: lo verifica, y no lo cambia", () => {
    expect(sql).not.toMatch(/create or replace function public\.pausas_del_chofer_solo_recibo/);
    expect(sql).toContain("pausas_solo_recibo_al_cerrar");
    expect(sql).toContain("El trigger 306");
  });

  it("es idempotente y sin transacción propia, como las demás de pausas", () => {
    expect(sql).toContain("drop policy if exists \"pausas update\"");
    expect(sql).toContain("drop constraint if exists pausas_galones_solo_gasolina");
    expect(sql).not.toMatch(/^\s*(begin|commit)\s*;/im);
  });

  it("la comprobación final revienta si algo no cuadra", () => {
    expect(sql).toContain("raise exception '332: sigue la constraint pausas_recibo_solo_gasolina'");
    expect(sql).toContain("raise exception '332: la tabla debe tener exactamente 3 políticas'");
  });
});

describe("paradas con foto: el cableado en la app", () => {
  it("la pestaña «Paradas» solo para el chofer, con su ruta propia", () => {
    const constantes = leer("src/lib/constants.ts");
    expect(constantes).toMatch(/\{ id: "paradas",[^}]*href: "\/stops", roles: \["driver"\] \}/);
  });

  it("la página de Paradas usa la misma pieza de registro de «Mi ruta», con el estado compartido", () => {
    const page = leer("src/app/(app)/stops/page.tsx");
    expect(page).toContain("const store = usePausasDelChofer(driverId, dia, { practica: teaching });");
    expect(page).toContain("<PausaDelChoferVista store={store} dia={dia} mostrarPendientes={false} />");
  });

  it("el hook cierra la parada sin la foto cuando la base la rechaza, y lo dice", () => {
    const hook = leer("src/lib/usePausasDelChofer.ts");
    expect(hook).toContain("if (r.ok || p.motivo === \"gas\" || !traiaRecibo || !esRechazoDeFoto(r.error)) return r;");
    expect(hook).toContain("return cerrada.ok ? { ...cerrada, fotoNoGuardada: true } : cerrada;");
  });

  it("el admin ve la foto y el monto de cualquier parada en el Recorrido", () => {
    const admin = leer("src/components/PausasDelDia.tsx");
    expect(admin).toContain("{ key: \"recibo\", en: \"Photo & amount\", es: \"Foto y monto\"");
    expect(admin).toContain("onClick={() => setViendo(p.recibo_foto)}");
  });
});
