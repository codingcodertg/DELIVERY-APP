import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

describe("Nómina ya no tiene secciones plegadas: ni «Trabajando ahora» ni las de fotos o capturas", () => {
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

  it("2026-11-25: «Trabajando ahora» salió de Nómina; no hay sección, ni clave, ni ?vista=", () => {
    expect(src).not.toContain("SeccionDeNomina");
    expect(src).not.toContain("TrabajandoAhora");
    expect(src).not.toContain("data-trabajando-ahora");
    expect(src).not.toContain("vistaPorUrl");
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
