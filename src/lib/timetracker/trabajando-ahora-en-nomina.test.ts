import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLAVE_AHORA_ABIERTA,
  ahoraEstaAbierta,
  guardarAhoraAbierta,
  leerAhoraAbierta,
} from "./trabajando-ahora-en-nomina";

// 2026-11-24: «Trabajando ahora» dejó de ser pestaña y vive plegada dentro de Nómina.
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

describe("«Trabajando ahora» ya no es pestaña", () => {
  it("MANAGER_TABS no tiene 'live'", async () => {
    const { MANAGER_TABS } = await import("./constants");
    expect(MANAGER_TABS.map((t) => t.id)).not.toContain("live");
  });

  it("la ruta vieja redirige a Nómina con la sección abierta", () => {
    const src = leer("src/app/timetracker/(timetracker)/live/page.tsx");
    expect(src).toContain('redirect("/timetracker/payroll?vista=ahora")');
    expect(src).not.toContain("TrabajandoAhora");
  });

  it("Nómina pasa ?vista=ahora a PayrollTabs en las dos ramas (demo y real)", () => {
    const src = leer("src/app/timetracker/(timetracker)/payroll/page.tsx");
    expect(src).toContain('vista?: string');
    expect(src.split("vistaPorUrl={vistaPorUrl}").length - 1).toBe(2);
    expect(src).not.toContain("ahoraAbiertaPorUrl");
  });
});

describe("la sección dentro de PayrollTabs", () => {
  const src = leer("src/components/timetracker/PayrollTabs.tsx");

  it("renderiza TrabajandoAhora dentro de una cabecera con aria-expanded y data-trabajando-ahora", () => {
    expect(src).toContain("<TrabajandoAhora soloUids={soloUids} />");
    expect(src).toContain("data-trabajando-ahora");
    expect(src).toContain("aria-expanded={abierta}");
  });

  it("solo la ve el admin, y va encima del resumen", () => {
    expect(src).toContain('me.role === "admin" && (');
    expect(src).toContain('<SeccionDeNomina clave="ahora"');
    // 2026-11-24: ya no hay resumen encima; «Trabajando ahora» va antes que los filtros y las secciones.
    expect(src.indexOf('clave="ahora"')).toBeLessThan(src.indexOf("<FiltrosDeNomina"));
  });

  it("el cuerpo no se monta cerrado (así el sondeo solo corre abierto)", () => {
    expect(src).toContain("{abierta && <div");
  });

  it("el título sale de la clave que ya tenía la pestaña", () => {
    expect(src).toContain('t("tab.live")');
  });
});

describe("TrabajandoAhora conserva su guardia de admin", () => {
  it("el componente se queda con el mismo control de rol", () => {
    const src = leer("src/components/timetracker/TrabajandoAhora.tsx");
    expect(src).toContain('if (me.role !== "admin")');
  });
});

describe("qué decide si la sección empieza abierta", () => {
  it("la URL manda sobre lo recordado", () => {
    expect(ahoraEstaAbierta({ porUrl: true, recordado: false })).toBe(true);
    expect(ahoraEstaAbierta({ porUrl: true, recordado: null })).toBe(true);
  });

  it("sin URL, manda lo recordado", () => {
    expect(ahoraEstaAbierta({ porUrl: false, recordado: true })).toBe(true);
    expect(ahoraEstaAbierta({ porUrl: false, recordado: false })).toBe(false);
  });

  it("sin nada, cerrada", () => {
    expect(ahoraEstaAbierta({ porUrl: false, recordado: null })).toBe(false);
  });
});

describe("la elección guardada", () => {
  function almacenFalso(inicial: Record<string, string> = {}) {
    const datos = new Map(Object.entries(inicial));
    return {
      getItem: (k: string) => datos.get(k) ?? null,
      setItem: (k: string, v: string) => { datos.set(k, v); },
      datos,
    };
  }

  it("usa la clave acordada y valores «1» / «0»", () => {
    expect(CLAVE_AHORA_ABIERTA).toBe("tt_nomina_ahora_abierta");
    const a = almacenFalso();
    guardarAhoraAbierta(a, true);
    expect(a.datos.get("tt_nomina_ahora_abierta")).toBe("1");
    guardarAhoraAbierta(a, false);
    expect(a.datos.get("tt_nomina_ahora_abierta")).toBe("0");
  });

  it("se lee lo guardado y lo raro cuenta como sin elección", () => {
    expect(leerAhoraAbierta(almacenFalso({ tt_nomina_ahora_abierta: "1" }))).toBe(true);
    expect(leerAhoraAbierta(almacenFalso({ tt_nomina_ahora_abierta: "0" }))).toBe(false);
    expect(leerAhoraAbierta(almacenFalso({ tt_nomina_ahora_abierta: "si" }))).toBeNull();
    expect(leerAhoraAbierta(almacenFalso())).toBeNull();
    expect(leerAhoraAbierta(null)).toBeNull();
  });

  it("un almacén que lanza no rompe nada", () => {
    const roto = {
      getItem: () => { throw new Error("bloqueado"); },
      setItem: () => { throw new Error("bloqueado"); },
    };
    expect(leerAhoraAbierta(roto)).toBeNull();
    expect(() => guardarAhoraAbierta(roto, true)).not.toThrow();
  });
});
