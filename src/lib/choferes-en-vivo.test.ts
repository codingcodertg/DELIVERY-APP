import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { choferesEnVivo, etiquetaEnVivo, MINUTOS_EN_VIVO } from "./choferes-en-vivo";
import type { DriverLocation } from "./types";

// «Por dónde va el camión» para Almacén (D-NEXT, migración 121). Nombres inventados.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const AHORA = new Date("2026-09-18T15:00:00Z").getTime();

const fijo = (extra: Partial<DriverLocation> = {}): DriverLocation => ({
  id: Math.random().toString(36).slice(2),
  driver_id: "u-ana",
  lat: 26.2,
  lng: -98.2,
  accuracy_m: 5,
  speed_mps: null,
  heading: null,
  battery_pct: null,
  recorded_at: new Date(AHORA - 60_000).toISOString(),
  created_at: new Date(AHORA).toISOString(),
  ...extra,
} as DriverLocation);

const nombres = new Map([["u-ana", "Ana"], ["u-beto", "Beto"]]);
const color = (n: string) => `color-de-${n}`;

describe("choferesEnVivo: quién está reportando ahora", () => {
  it("resuelve el nombre, el color y la antigüedad", () => {
    const [c] = choferesEnVivo([fijo()], nombres, color, AHORA);
    expect(c.driver).toBe("Ana");
    expect(c.color).toBe("color-de-Ana");
    expect(c.ageMin).toBeCloseTo(1, 5);
    expect([c.lat, c.lng, c.accuracy_m]).toEqual([26.2, -98.2, 5]);
  });

  it("un fijo de quien no está en la lista de gente no se pinta", () => {
    // Sin nombre no se puede decir de quién es el camión, y un punto anónimo en el mapa no ayuda.
    expect(choferesEnVivo([fijo({ driver_id: "u-fantasma" })], nombres, color, AHORA)).toEqual([]);
  });

  it("lo de hace más de una hora deja de ser «en vivo»", () => {
    // El límite es UNA HORA, escrito aquí con su número: si la prueba solo usara la constante, se
    // movería con ella y un límite de diez horas pasaría igual. Medido con un mutante.
    expect(MINUTOS_EN_VIVO).toBe(60);
    const haceNoventa = fijo({ recorded_at: new Date(AHORA - 90 * 60_000).toISOString() });
    const haceMedia = fijo({ recorded_at: new Date(AHORA - 30 * 60_000).toISOString() });
    expect(choferesEnVivo([haceNoventa], nombres, color, AHORA)).toHaveLength(0);
    expect(choferesEnVivo([haceMedia], nombres, color, AHORA)).toHaveLength(1);

    // Y el borde exacto, con la constante: justo en el límite todavía cuenta; un minuto más, no.
    const justo = fijo({ recorded_at: new Date(AHORA - MINUTOS_EN_VIVO * 60_000).toISOString() });
    const pasado = fijo({ recorded_at: new Date(AHORA - (MINUTOS_EN_VIVO + 1) * 60_000).toISOString() });
    expect(choferesEnVivo([justo], nombres, color, AHORA)).toHaveLength(1);
    expect(choferesEnVivo([pasado], nombres, color, AHORA)).toHaveLength(0);
  });

  it("sin precisión, null y no un cero inventado", () => {
    expect(choferesEnVivo([fijo({ accuracy_m: null })], nombres, color, AHORA)[0].accuracy_m).toBeNull();
  });

  it("varios choferes salen todos, cada uno con su color", () => {
    const salida = choferesEnVivo([fijo(), fijo({ driver_id: "u-beto" })], nombres, color, AHORA);
    expect(salida.map((c) => [c.driver, c.color])).toEqual([["Ana", "color-de-Ana"], ["Beto", "color-de-Beto"]]);
  });

  it("la etiqueta la escribe quien pinta, en su idioma", () => {
    const en = (a: string) => a;
    const es = (_a: string, b: string) => b;
    const reciente = choferesEnVivo([fijo({ recorded_at: new Date(AHORA - 20_000).toISOString() })], nombres, color, AHORA)[0];
    expect(etiquetaEnVivo(reciente, en)).toBe("🚚 Ana · now");
    expect(etiquetaEnVivo(reciente, es)).toBe("🚚 Ana · ahora");
    const viejo = choferesEnVivo([fijo({ recorded_at: new Date(AHORA - 3 * 60_000).toISOString() })], nombres, color, AHORA)[0];
    expect(etiquetaEnVivo(viejo, en)).toBe("🚚 Ana · 3 min ago");
    expect(etiquetaEnVivo(viejo, es)).toBe("🚚 Ana · hace 3 min");
  });
});

describe("la regla vive en un solo sitio", () => {
  const pantallas = ["src/app/(app)/map/page.tsx", "src/app/(app)/routes/page.tsx", "src/app/(app)/warehouse/page.tsx"];

  it("las tres pantallas la importan, y ninguna se escribe la suya", () => {
    for (const p of pantallas) {
      const src = plano(leer(p));
      expect(src, p).toContain("choferesEnVivo(driverLocations");
      // El corte de la hora escrito a mano era lo que había dos veces.
      expect(src, p).not.toContain("ageMin > 60");
    }
  });
});

describe("121: almacén puede leer las posiciones", () => {
  const dir = "supabase/migrations";
  const conPolitica = readdirSync(join(process.cwd(), dir))
    .filter((f) => f.endsWith(".sql") && leer(`${dir}/${f}`).includes('"read fleet locations"'))
    .sort();
  const sql = leer(`${dir}/121_warehouse_lee_posiciones.sql`);
  const ejecutable = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

  it("la 121 es la última que toca esa política (control)", () => {
    expect(conPolitica.length).toBeGreaterThanOrEqual(3); // 043, 080 y la nueva
    expect(conPolitica.at(-1)).toBe("121_warehouse_lee_posiciones.sql");
  });

  it("los cuatro roles que leen la flota, con almacén dentro", () => {
    const roles = [...plano(ejecutable).matchAll(/'(admin|logistics|manager|warehouse|sales|driver|accounting)'/g)].map((m) => m[1]);
    expect([...new Set(roles)].sort()).toEqual(["admin", "logistics", "manager", "warehouse"]);
  });

  it("y el chofer sigue viendo el suyo", () => {
    expect(plano(ejecutable)).toContain("driver_id = (select auth.uid())");
  });

  it("cambia la política en sitio: ni drop, ni create, ni tocar la de escritura", () => {
    expect(plano(ejecutable)).toContain('alter policy "read fleet locations" on public.driver_locations');
    expect(ejecutable).not.toMatch(/drop\s+policy|create\s+policy/i);
    expect(ejecutable).not.toContain("driver writes own location");
  });

  it("no escribe datos ni toca la poda", () => {
    expect(ejecutable).not.toMatch(/\binsert\s+into\s+public\.driver_locations|\bupdate\s+public\.|\bdelete\s+from\s+public\./i);
    expect(ejecutable).not.toContain("prune_driver_locations");
  });

  it("el ensayo recorre los ocho casos de la matriz, y dice qué se espera antes y después", () => {
    for (const quien of ["almacen", "logistica", "gerente", "admin", "vendedor", "office", "el propio chofer", "otro chofer"]) {
      expect(sql, quien).toContain(`'${quien}'`);
    }
    expect(sql).toContain("ANTES: 0 · DESPUES: 1");
    expect(sql).toContain("--   rollback;");
    // Y que almacén siga sin poder escribir, que es la otra mitad del permiso.
    expect(sql).toContain("BLOQUEADO en los dos casos");
  });

  it("se auto-registra y no lleva el marcador sin numerar", () => {
    const [, despues] = sql.split("-- @ledger-below");
    expect(despues).toContain("121_warehouse_lee_posiciones.sql");
    expect(sql).not.toContain("D-" + "NEXT");
  });
});

describe("el mapa de Almacén es para mirar", () => {
  const pagina = plano(leer("src/app/(app)/warehouse/page.tsx"));

  it("pinta las paradas y los camiones, con la altura fijada", () => {
    expect(pagina).toContain("<MapView points={puntos} liveDrivers={enVivo} height={320} />");
  });

  it("dice cuándo no hay nadie reportando, en vez de enseñar un mapa mudo", () => {
    expect(pagina).toContain('t("No truck is reporting its position right now.", "Ningún camión está reportando su posición ahora mismo.")');
  });

  it("no asigna, no reordena y no toca la orden", () => {
    const vista = pagina.slice(pagina.indexOf("<MapView"), pagina.indexOf("</tbody>"));
    expect(vista).not.toMatch(/updateDelivery|reorderStops|setStage|onPick|pickable/);
  });

  it("una parada sin punto no se inventa", () => {
    expect(pagina).toContain("d.delivery_lat == null || d.delivery_lng == null ? [] :");
  });
});
