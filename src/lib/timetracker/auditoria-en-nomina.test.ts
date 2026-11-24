import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLAVE_AHORA_ABIERTA,
  CLAVES_SECCION_DE_NOMINA,
  guardarSeccionAbierta,
  leerSeccionAbierta,
  seccionAbierta,
  seccionEstaAbierta,
  seccionPorUrl,
} from "./trabajando-ahora-en-nomina";

// 2026-11-24 (ayuda de Roberto: «these could probably be consolidated into payroll app»): las vistas
// de fotos de fichaje, excepciones y capturas de escritorio salen de Auditoría y entran en Nómina,
// como secciones plegadas. Auditoría se queda con el registro.
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

// Un bloque de la fuente de PayrollTabs: desde la apertura de la sección hasta su cierre.
function bloqueDe(src: string, clave: string): string {
  const inicio = src.indexOf(`<SeccionDeNomina clave="${clave}"`);
  expect(inicio, `falta la sección ${clave}`).toBeGreaterThanOrEqual(0);
  const fin = src.indexOf("</SeccionDeNomina>", inicio);
  expect(fin, `la sección ${clave} no cierra`).toBeGreaterThan(inicio);
  return src.slice(inicio, fin);
}

describe("Auditoría ya no tiene vistas, solo el registro", () => {
  const src = leer("src/components/timetracker/AuditTabs.tsx");

  it("no monta DayPhotos, ExceptionHistory ni TeamDiary, ni los importa", () => {
    for (const nombre of ["DayPhotos", "ExceptionHistory", "TeamDiary"]) {
      expect(src, nombre).not.toContain(`<${nombre} />`);
      expect(src, nombre).not.toContain(`from "./${nombre}"`);
    }
  });

  it("no tiene selector de vistas", () => {
    expect(src).not.toContain("setView");
    expect(src).not.toContain('className="tabs"');
    expect(src).not.toContain("mgr.audit.viewPhotos");
    expect(src).not.toContain("mgr.audit.viewExceptions");
    expect(src).not.toContain("mgr.audit.viewDesktop");
  });

  it("sigue con el registro y sus filtros de persona y acción", () => {
    expect(src).toContain('t("mgr.audit.title")');
    expect(src).toContain('t("mgr.audit.allPeople")');
    expect(src).toContain('t("mgr.audit.allActions")');
  });
});

describe("Nómina aloja las tres vistas como secciones plegadas, en orden, solo admin", () => {
  const src = leer("src/components/timetracker/PayrollTabs.tsx");

  it("monta cada vista dentro de su sección con data-seccion-de-nomina", () => {
    const parejas: [string, string, string][] = [
      ["fotos", "<DayPhotos />", "mgr.audit.viewPhotos"],
      ["excepciones", "<ExceptionHistory />", "mgr.audit.viewExceptions"],
      ["capturas", "<TeamDiary />", "mgr.audit.viewDesktop"],
    ];
    for (const [clave, componente, titulo] of parejas) {
      const bloque = bloqueDe(src, clave);
      expect(bloque, clave).toContain(componente);
      expect(bloque, clave).toContain(`titulo={t("${titulo}")}`);
      expect(src, clave).toContain("data-seccion-de-nomina={clave}");
    }
  });

  it("van después de las dos mitades de la nómina, en el orden fotos, excepciones, capturas", () => {
    const remoto = src.indexOf('t("mgr.pay.remoteTitle")');
    const fotos = src.indexOf('clave="fotos"');
    const excepciones = src.indexOf('clave="excepciones"');
    const capturas = src.indexOf('clave="capturas"');
    expect(remoto).toBeLessThan(fotos);
    expect(fotos).toBeLessThan(excepciones);
    expect(excepciones).toBeLessThan(capturas);
  });

  it("las tres están detrás del guard de admin", () => {
    const guardaAdmin = src.lastIndexOf('me.role === "admin" && (');
    expect(guardaAdmin).toBeGreaterThan(src.indexOf('t("mgr.pay.remoteTitle")'));
    expect(src.indexOf('clave="fotos"')).toBeGreaterThan(guardaAdmin);
  });

  it("cada sección tiene su propia clave de localStorage", () => {
    expect(CLAVES_SECCION_DE_NOMINA).toEqual({
      ahora: "tt_nomina_ahora_abierta",
      fotos: "tt_nomina_fotos_abierta",
      excepciones: "tt_nomina_excepciones_abierta",
      capturas: "tt_nomina_capturas_abierta",
    });
  });

  it("la sección lleva aria-expanded, el cuerpo solo se monta abierto y se lleva a la vista una vez por URL", () => {
    expect(src).toContain("aria-expanded={abierta}");
    expect(src).toContain("{abierta && <div");
    expect(src).toContain('seccionRef.current?.scrollIntoView({ block: "start" })');
    expect(src).toContain("yaLlevada.current");
  });
});

describe("la URL: ?vista= abre la sección que nombra", () => {
  it("reconoce las cuatro y nada más", () => {
    expect(seccionPorUrl("ahora")).toBe("ahora");
    expect(seccionPorUrl("fotos")).toBe("fotos");
    expect(seccionPorUrl("excepciones")).toBe("excepciones");
    expect(seccionPorUrl("capturas")).toBe("capturas");
    expect(seccionPorUrl("otra")).toBeNull();
    expect(seccionPorUrl("")).toBeNull();
    expect(seccionPorUrl(undefined)).toBeNull();
    expect(seccionPorUrl(null)).toBeNull();
  });

  it("la página de Nómina valida ?vista= y lo pasa como vistaPorUrl en las dos ramas", () => {
    const src = leer("src/app/timetracker/(timetracker)/payroll/page.tsx");
    expect(src).toContain("const vistaPorUrl = seccionPorUrl(vista);");
    expect(src.split("vistaPorUrl={vistaPorUrl}").length - 1).toBe(2);
    expect(src).not.toContain("ahoraAbiertaPorUrl");
  });
});

describe("qué decide si una sección empieza abierta", () => {
  it("la URL manda sobre lo recordado", () => {
    expect(seccionEstaAbierta({ porUrl: true, recordado: false })).toBe(true);
    expect(seccionEstaAbierta({ porUrl: true, recordado: null })).toBe(true);
  });

  it("sin URL, manda lo recordado", () => {
    expect(seccionEstaAbierta({ porUrl: false, recordado: true })).toBe(true);
    expect(seccionEstaAbierta({ porUrl: false, recordado: false })).toBe(false);
  });

  it("sin nada, cerrada", () => {
    expect(seccionEstaAbierta({ porUrl: false, recordado: null })).toBe(false);
  });

  it("la elección de esta visita gana a la URL y a lo recordado", () => {
    // El caso que importa: la URL abre la sección, la persona la pliega, y se queda plegada.
    expect(seccionAbierta({ elegida: false, porUrl: true, recordado: true })).toBe(false);
    // Y al revés: la persona la despliega aunque la URL no la pida.
    expect(seccionAbierta({ elegida: true, porUrl: false, recordado: false })).toBe(true);
  });

  it("sin elección de esta visita, decide la URL o lo recordado", () => {
    expect(seccionAbierta({ elegida: null, porUrl: true, recordado: false })).toBe(true);
    expect(seccionAbierta({ elegida: null, porUrl: false, recordado: true })).toBe(true);
    expect(seccionAbierta({ elegida: null, porUrl: false, recordado: null })).toBe(false);
  });
});

describe("la elección guardada, por sección", () => {
  function almacenFalso(inicial: Record<string, string> = {}) {
    const datos = new Map(Object.entries(inicial));
    return {
      getItem: (k: string) => datos.get(k) ?? null,
      setItem: (k: string, v: string) => { datos.set(k, v); },
      datos,
    };
  }

  it("«Trabajando ahora» conserva su clave", () => {
    expect(CLAVE_AHORA_ABIERTA).toBe("tt_nomina_ahora_abierta");
  });

  it("cada sección guarda «1» / «0» en su propia clave", () => {
    const a = almacenFalso();
    guardarSeccionAbierta(a, "fotos", true);
    guardarSeccionAbierta(a, "capturas", false);
    expect(a.datos.get("tt_nomina_fotos_abierta")).toBe("1");
    expect(a.datos.get("tt_nomina_capturas_abierta")).toBe("0");
    expect(a.datos.has("tt_nomina_ahora_abierta")).toBe(false);
  });

  it("se lee la de cada sección, y lo raro cuenta como sin elección", () => {
    const a = almacenFalso({ tt_nomina_excepciones_abierta: "1", tt_nomina_fotos_abierta: "si" });
    expect(leerSeccionAbierta(a, "excepciones")).toBe(true);
    expect(leerSeccionAbierta(a, "fotos")).toBeNull();
    expect(leerSeccionAbierta(a, "capturas")).toBeNull();
    expect(leerSeccionAbierta(null, "fotos")).toBeNull();
  });

  it("un almacén que lanza no rompe nada", () => {
    const roto = {
      getItem: () => { throw new Error("bloqueado"); },
      setItem: () => { throw new Error("bloqueado"); },
    };
    expect(leerSeccionAbierta(roto, "fotos")).toBeNull();
    expect(() => guardarSeccionAbierta(roto, "fotos", true)).not.toThrow();
  });
});

describe("los enlaces viejos de Auditoría llevan a Nómina con la sección abierta", () => {
  // Se leen las reglas línea a línea: cada una tiene `source` y `destination` en la misma línea.
  const cfg = leer("next.config.mjs");
  const destinoDe = (origen: string) => {
    const linea = cfg.split(/\r?\n/).find((l) => l.includes(`source: "${origen}",`));
    expect(linea, origen).toBeDefined();
    return /destination: "([^"]+)"/.exec(linea!)?.[1];
  };

  it("/clock-in/photos → Nómina, sección fotos", () => {
    expect(destinoDe("/clock-in/photos")).toBe("/timetracker/payroll?vista=fotos");
  });

  it("/timetracker/clock-in/photos → Nómina, sección fotos", () => {
    expect(destinoDe("/timetracker/clock-in/photos")).toBe("/timetracker/payroll?vista=fotos");
  });

  it("/timetracker/team-diary → Nómina, sección capturas", () => {
    expect(destinoDe("/timetracker/team-diary")).toBe("/timetracker/payroll?vista=capturas");
  });

  it("ninguna regla de las tres apunta ya a /timetracker/audit", () => {
    for (const origen of ["/clock-in/photos", "/timetracker/clock-in/photos", "/timetracker/team-diary"]) {
      expect(destinoDe(origen), origen).not.toBe("/timetracker/audit");
    }
  });
});
