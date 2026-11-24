import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLAVE_AHORA_ABIERTA,
  CLAVES_SECCION_DE_NOMINA,
  SECCIONES_DE_NOMINA,
  guardarSeccionAbierta,
  leerSeccionAbierta,
  seccionAbierta,
  seccionEstaAbierta,
  seccionPorUrl,
} from "./trabajando-ahora-en-nomina";

// 2026-11-24 (ayuda de Roberto: «these could probably be consolidated into payroll app») las vistas de
// fotos de fichaje, excepciones y capturas de escritorio pasaron de Auditoría a Nómina. Ese mismo día el
// dueño las retiró de Nómina: las capturas se ven ahora con el 🖥 de cada día o sesión remota, y las fotos
// y excepciones de un turno siguen en su bitácora «Full day». Auditoría se queda con el registro.
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

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

describe("Nómina ya no aloja las tres vistas retiradas; solo «Trabajando ahora» es sección plegada", () => {
  const src = leer("src/components/timetracker/PayrollTabs.tsx");

  it("no monta ni importa DayPhotos, ExceptionHistory ni TeamDiary", () => {
    for (const nombre of ["DayPhotos", "ExceptionHistory", "TeamDiary"]) {
      expect(src, nombre).not.toContain(`<${nombre} />`);
      expect(src, nombre).not.toContain(`from "./${nombre}"`);
    }
  });

  it("no quedan secciones de fotos, excepciones ni capturas", () => {
    expect(src).not.toContain('clave="fotos"');
    expect(src).not.toContain('clave="excepciones"');
    expect(src).not.toContain('clave="capturas"');
    expect(src).not.toContain("mgr.audit.viewPhotos");
    expect(src).not.toContain("mgr.audit.viewExceptions");
    expect(src).not.toContain("mgr.audit.viewDesktop");
  });

  it("«Trabajando ahora» sigue igual: atributo, clave y guard de admin", () => {
    expect(src).toContain('<SeccionDeNomina clave="ahora"');
    expect(src).toContain("data-trabajando-ahora={clave === \"ahora\" ? true : undefined}");
    expect(src).toContain("aria-expanded={abierta}");
    expect(CLAVES_SECCION_DE_NOMINA).toEqual({ ahora: "tt_nomina_ahora_abierta" });
    expect(SECCIONES_DE_NOMINA).toEqual(["ahora"]);
  });

  it("la sección lleva aria-expanded, el cuerpo solo se monta abierto y se lleva a la vista una vez por URL", () => {
    expect(src).toContain("aria-expanded={abierta}");
    expect(src).toContain("{abierta && <div");
    expect(src).toContain('seccionRef.current?.scrollIntoView({ block: "start" })');
    expect(src).toContain("yaLlevada.current");
  });
});

describe("la URL: ?vista= abre la sección que nombra", () => {
  it("reconoce «ahora» y nada más; las retiradas ya no abren nada", () => {
    expect(seccionPorUrl("ahora")).toBe("ahora");
    expect(seccionPorUrl("fotos")).toBeNull();
    expect(seccionPorUrl("excepciones")).toBeNull();
    expect(seccionPorUrl("capturas")).toBeNull();
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

describe("la elección guardada de «Trabajando ahora»", () => {
  function almacenFalso(inicial: Record<string, string> = {}) {
    const datos = new Map(Object.entries(inicial));
    return {
      getItem: (k: string) => datos.get(k) ?? null,
      setItem: (k: string, v: string) => { datos.set(k, v); },
      datos,
    };
  }

  it("conserva su clave", () => {
    expect(CLAVE_AHORA_ABIERTA).toBe("tt_nomina_ahora_abierta");
  });

  it("guarda «1» / «0» en su clave", () => {
    const a = almacenFalso();
    guardarSeccionAbierta(a, "ahora", true);
    expect(a.datos.get("tt_nomina_ahora_abierta")).toBe("1");
    guardarSeccionAbierta(a, "ahora", false);
    expect(a.datos.get("tt_nomina_ahora_abierta")).toBe("0");
  });

  it("lo raro cuenta como sin elección", () => {
    expect(leerSeccionAbierta(almacenFalso({ tt_nomina_ahora_abierta: "si" }), "ahora")).toBeNull();
    expect(leerSeccionAbierta(null, "ahora")).toBeNull();
  });

  it("un almacén que lanza no rompe nada", () => {
    const roto = {
      getItem: () => { throw new Error("bloqueado"); },
      setItem: () => { throw new Error("bloqueado"); },
    };
    expect(leerSeccionAbierta(roto, "ahora")).toBeNull();
    expect(() => guardarSeccionAbierta(roto, "ahora", true)).not.toThrow();
  });
});

describe("los enlaces viejos de fotos y capturas llevan a Nómina, sin sección", () => {
  // Se leen las reglas línea a línea: cada una tiene `source` y `destination` en la misma línea.
  const cfg = leer("next.config.mjs");
  const destinoDe = (origen: string) => {
    const linea = cfg.split(/\r?\n/).find((l) => l.includes(`source: "${origen}",`));
    expect(linea, origen).toBeDefined();
    return /destination: "([^"]+)"/.exec(linea!)?.[1];
  };

  it("/clock-in/photos → /timetracker/payroll, sin ?vista=", () => {
    expect(destinoDe("/clock-in/photos")).toBe("/timetracker/payroll");
  });

  it("/timetracker/clock-in/photos → /timetracker/payroll, sin ?vista=", () => {
    expect(destinoDe("/timetracker/clock-in/photos")).toBe("/timetracker/payroll");
  });

  it("/timetracker/team-diary → /timetracker/payroll, sin ?vista=", () => {
    expect(destinoDe("/timetracker/team-diary")).toBe("/timetracker/payroll");
  });

  it("ninguna de las tres apunta ya a /timetracker/audit ni lleva ?vista=", () => {
    for (const origen of ["/clock-in/photos", "/timetracker/clock-in/photos", "/timetracker/team-diary"]) {
      expect(destinoDe(origen), origen).not.toBe("/timetracker/audit");
      expect(destinoDe(origen), origen).not.toContain("?vista=");
    }
  });
});
