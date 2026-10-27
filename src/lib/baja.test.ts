// D-707 · Un dado de baja ya no sale en ninguna app.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estaDadoDeBaja, filtroActivos, soloActivos } from "./baja";

const HOY = "2026-10-26";

describe("estaDadoDeBaja", () => {
  it("sin fecha (null, vacía) sigue activo", () => {
    expect(estaDadoDeBaja(null, HOY)).toBe(false);
    expect(estaDadoDeBaja(undefined, HOY)).toBe(false);
    expect(estaDadoDeBaja("  ", HOY)).toBe(false);
  });
  it("la baja de hoy ya cuenta", () => {
    expect(estaDadoDeBaja(HOY, HOY)).toBe(true);
  });
  it("una baja pasada cuenta", () => {
    expect(estaDadoDeBaja("2026-10-25", HOY)).toBe(true);
    expect(estaDadoDeBaja("2025-01-01", HOY)).toBe(true);
  });
  it("una baja futura sigue activa hasta ese día", () => {
    expect(estaDadoDeBaja("2026-10-27", HOY)).toBe(false);
    expect(estaDadoDeBaja("2026-10-27", "2026-10-27")).toBe(true);
  });
  it("sin `hoy` toma un día real (el de Brownsville)", () => {
    expect(estaDadoDeBaja("9999-12-31")).toBe(false);
    expect(estaDadoDeBaja("2000-01-01")).toBe(true);
  });
});

describe("soloActivos y filtroActivos", () => {
  it("deja fuera solo a los de baja hasta hoy, en el orden en que vienen", () => {
    const filas = [
      { id: "c", left_at: "2026-10-27" },
      { id: "a", left_at: null },
      { id: "b", left_at: HOY },
      { id: "d" },
      { id: "e", left_at: "2026-01-01" },
    ];
    expect(soloActivos(filas, HOY).map((f) => f.id)).toEqual(["c", "a", "d"]);
  });
  it("el filtro de PostgREST dice lo mismo: nula, o posterior a hoy", () => {
    expect(filtroActivos(HOY)).toBe("left_at.is.null,left_at.gt.2026-10-26");
  });
});

// Si uno de estos selectores pierde el filtro, el de baja vuelve a salir.
describe("los selectores de gente actual siguen filtrando", () => {
  const SRC = join(__dirname, "..");
  const lee = (p: string) => readFileSync(join(SRC, p), "utf8");
  const casos: [string, RegExp][] = [
    ["lib/constants.ts", /\.filter\(\(u\) => u\.role === "driver" && !estaDadoDeBaja\(u\.left_at\)\)/],
    ["lib/sales-reps.ts", /const activos = soloActivos\(users\);\s+const deLaTienda = vendedoresDeLaTienda\(activos,/],
    ["lib/notifications.ts", /const withRole = \(role: Profile\["role"\]\) => soloActivos\(users\)\.filter/],
    ["lib/switch-user.ts", /\? activos\.filter\([\s\S]*?: activos;/],
    ["app/api/impersonate/candidates/route.ts", /select\("id, full_name, role, store"\)\.or\(filtroActivos\(\)\)/],
    ["app/api/impersonate/switch/candidates/route.ts", /select\("id, full_name, role, store"\)\.or\(filtroActivos\(\)\)/],
    ["app/api/route-plan/route.ts", /eq\("role", "driver"\)\.or\(filtroActivos\(fecha\)\)/],
    ["app/(app)/routes/page.tsx", /const drivers = useMemo\(\(\) => soloActivos\(todosLosChoferes\)/],
    ["components/ChatFlotante.tsx", /listaVisible\(soloActivos\(contactos\)/],
    ["lib/leads/almacen.ts", /select\("id, full_name, store, role, module_access"\)\.or\(filtroActivos\(\)\)/],
    ["lib/customers/almacen.ts", /const valor = soloActivos\(todos\)/],
    ["components/UsersManager.tsx", /for \(const u of activos\)/],
    ["app/timetracker/(timetracker)/people/page.tsx", /\{activos\.map\(\(u\) =>/],
    ["components/timetracker/AssignmentsPanel.tsx", /const presenciales = soloActivos\(users\)/],
    ["app/timetracker/clock-in/actions/clock.ts", /\.filter\(\(p\) => !deBaja\.has\(p\.id as string\)\)/],
  ];
  for (const [fichero, patron] of casos) {
    it(fichero, () => { expect(lee(fichero)).toMatch(patron); });
  }
  it("los proveedores traen left_at", () => {
    expect(lee("lib/data-provider.tsx")).toMatch(/title_color, left_at"\)\.order\("full_name"\)/);
    expect(lee("lib/timetracker-data-provider.tsx")).toMatch(/\.select\("id, full_name, timetracker_role, store, left_at"\)/);
  });
});
