import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TABS } from "@/lib/recruiting/constants";
import { MANAGER_TABS } from "@/lib/timetracker/constants";

// tt/a-hr: «Employees» y «Pay rates» salen de la barra del Time Tracker y viven en RR. HH.
// Estas pruebas miran el FUENTE: el repo no dibuja pantallas en pruebas, así que la única red
// posible es comprobar que las piezas están donde deben y en el orden que importa.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");

describe("tt/a-hr: pantallas del Time Tracker dentro de RR. HH.", () => {
  it("el admin del Time Tracker ya no tiene «people» en su barra, ni «assignments» (horario, owner 2026-11-24)", () => {
    const ids = MANAGER_TABS.map((t) => t.id);
    expect(ids).not.toContain("people");
    // «assignments» (Schedule) vive ahora en Registrar tiempo: lo cubre horario-en-registrar.test.ts.
    expect(ids).not.toContain("assignments");
    // «live» salió de la barra en la misma salida (vive en Nómina): lo cubre trabajando-ahora-en-nomina.test.ts.
    expect(ids).not.toContain("live");
  });

  it("/timetracker/people redirige a /recruiting/tt-empleados", () => {
    const s = leer("src/app/timetracker/(timetracker)/people/page.tsx");
    expect(s).toContain('redirect("/recruiting/tt-empleados")');
  });

  it("el menú de RR. HH. tiene las dos entradas nuevas, solo para admin, en el grupo hr", () => {
    const empleados = TABS.find((t) => t.id === "tt-empleados");
    const tarifas = TABS.find((t) => t.id === "tt-tarifas");
    expect(empleados).toMatchObject({ href: "/recruiting/tt-empleados", roles: ["admin"], grupo: "hr" });
    expect(tarifas).toMatchObject({ href: "/recruiting/tt-tarifas", roles: ["admin"], grupo: "hr" });
    // Van justo después de «Company assets».
    const i = TABS.findIndex((t) => t.id === "assets");
    expect(TABS[i + 1]?.id).toBe("tt-empleados");
    expect(TABS[i + 2]?.id).toBe("tt-tarifas");
  });

  it("el horario de Registrar tiempo no monta el panel de tarifas (eso va en /recruiting/tt-tarifas)", () => {
    // AssignmentsTabs se retiró (owner, 2026-11-24): el horario es ahora la sección de SeccionesDeRegistrarTiempo.
    const s = leer("src/components/timetracker/SeccionesDeRegistrarTiempo.tsx");
    // Se mira la importación y la etiqueta de montaje, no la palabra: el comentario del fichero la nombra a propósito.
    expect(s).not.toContain('import { AssignmentsPanel }');
    expect(s).not.toContain("<AssignmentsPanel");
    expect(s).toContain("<ScheduleWeek />");
  });

  it("el marco comprueba timetracker_role === \"admin\" ANTES de montar el proveedor de datos", () => {
    const s = leer("src/components/timetracker/MarcoDelTtEnRrhh.tsx");
    const comprobacion = s.indexOf('perfil?.timetracker_role !== "admin"');
    const proveedor = s.indexOf("<DataProvider");
    expect(comprobacion).toBeGreaterThan(-1);
    expect(proveedor).toBeGreaterThan(-1);
    expect(comprobacion).toBeLessThan(proveedor);
    // Y sin sesión se manda al login, no se monta nada.
    expect(s).toContain('redirect("/login?next=/recruiting")');
  });

  it("las dos pantallas nuevas de RR. HH. pasan por el marco", () => {
    for (const f of ["tt-empleados", "tt-tarifas"]) {
      const s = leer(`src/app/recruiting/(recruiting)/${f}/page.tsx`);
      expect(s, f).toContain("<MarcoDelTtEnRrhh>");
      expect(s, f).toContain('from "@/components/timetracker/MarcoDelTtEnRrhh"');
    }
  });

  it("el CSS del módulo deja el bloque en flujo dentro de RR. HH.", () => {
    const s = leer("src/app/timetracker/timetracker.css");
    expect(s).toContain(".timetracker-module.tt-en-rrhh{min-height:0;background:transparent}");
  });
});
