import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Pruebas de forma (sin red ni base) de los cambios de rendimiento del servidor: que cada ruta conserve lo que debe
// (autenticación, verificación, orden de los resultados) y haya dejado de hacer lo que se quitó.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");

describe("mosaicos del mapa: sin limitador en BD, con caché en el redirect a OSM", () => {
  const ruta = leer("src/app/api/map-tiles/[z]/[x]/[y]/route.ts");

  it("sigue exigiendo sesión y ya no escribe en el limitador por cada tile", () => {
    expect(ruta).toContain("await requireUser()");
    expect(ruta).not.toContain("limita(");
    expect(ruta).not.toContain("respuesta429");
    expect(ruta).not.toContain("@/lib/rate-limit");
  });

  it("el 302 a OSM lleva Cache-Control public, s-maxage=86400", () => {
    expect(ruta).toMatch(/function osmTile[\s\S]*?res\.headers\.set\("Cache-Control", "public, s-maxage=86400"\);/);
  });
});

describe("avisos de la noche antes: envío con cinco a la vez y maxDuration de 60 s", () => {
  it("el envío pasa por enParalelo con el límite exportado, y el orden de resultados se mantiene", () => {
    const src = leer("src/lib/avisos-cliente-envio.ts");
    expect(src).toContain("export const LIMITE_DE_ENVIO_PARALELO = 5;");
    expect(src).toContain("await enParalelo(ordenes, LIMITE_DE_ENVIO_PARALELO,");
    expect(src).not.toMatch(/for \(const o of ordenes\)\s*\{\s*resultados\.push/);
  });

  it("la ruta del cron declara maxDuration = 60", () => {
    expect(leer("src/app/api/cron/avisos-noche-antes/[franja]/route.ts")).toContain("export const maxDuration = 60;");
  });
});

describe("plan real vs. estimado: auth por chofer y updates de paradas de diez en diez", () => {
  const ruta = leer("src/app/api/route-plan/actuals/route.ts");

  it("las consultas de auth y los updates pasan por enParalelo con diez", () => {
    expect(ruta).toContain("const LIMITE_PARALELO = 10;");
    expect(ruta).toContain("await enParalelo(choferes, LIMITE_PARALELO,");
    expect(ruta).toContain("await enParalelo(actualesParaGuardar(reales), LIMITE_PARALELO,");
    expect(ruta).not.toMatch(/for \(const id of choferes\)/);
  });

  it("sigue usando la sesión de quien pide, y la llave de servicio solo para el último acceso", () => {
    expect(ruta).toContain("await requireUser()");
    expect(ruta).toContain("admin.auth.admin.getUserById(id)");
  });
});

describe("roll-schedules: una consulta por tipo para todos y lotes de inserción", () => {
  const ruta = leer("src/app/timetracker/clock-in/api/roll-schedules/route.ts");

  it("los turnos existentes y las cancelaciones se piden para todos con employee_id=in.(…)", () => {
    expect(ruta).toContain("scheduled_shifts?select=employee_id,shift_date,start_time&${filtro}");
    expect(ruta).toContain("shift_cancellations?select=employee_id,shift_date,start_time&${filtro}");
    expect(ruta).toContain("employee_id=in.(${ids.join(\",\")})");
    expect(ruta).not.toContain("employee_id=eq.${emp.id}");
  });

  it("los inserts van en lotes de 200 y no se inserta nada si no se pudieron leer los existentes", () => {
    expect(ruta).toContain("const TAMANO_LOTE = 200;");
    expect(ruta).toContain("body: JSON.stringify(lote)");
    expect(ruta).toMatch(/if \(!Array\.isArray\(existing\)\) \{[\s\S]*?status: 502/);
  });

  it("sigue cancelando la inserción de los turnos que un manager borró (shift_cancellations)", () => {
    expect(ruta).toContain("cancelled.has(clave(emp.id, r.shift_date, r.start_time))");
  });
});
