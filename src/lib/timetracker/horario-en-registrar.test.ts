import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MANAGER_TABS, TABS } from "@/lib/timetracker/constants";

// owner, 2026-11-24: «The Schedule tab is retired; from now on it lives in Track Time; and My week is removed».
// Estas pruebas miran el FUENTE (el repo no dibuja pantallas en pruebas): que la barra ya no tiene las dos
// pestañas, que Registrar tiempo muestra las dos secciones sin tocar el cronómetro, y que las rutas viejas
// llevan a su sitio nuevo.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
/** El código sin las líneas de comentario (un comentario que nombra algo no cuenta como usarlo). */
const codigoDe = (r: string) =>
  leer(r).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const PAGINA = "src/app/timetracker/(timetracker)/page.tsx";
const SECCIONES = "src/components/timetracker/SeccionesDeRegistrarTiempo.tsx";
const SEMANA_PAGINA = "src/app/timetracker/(timetracker)/week/page.tsx";
const ASIGNACIONES_PAGINA = "src/app/timetracker/(timetracker)/assignments/page.tsx";
const HORARIO_PAGINA = "src/app/timetracker/(timetracker)/schedule/page.tsx";

describe("la barra ya no tiene Schedule ni My week", () => {
  it("MANAGER_TABS no tiene «assignments» ni «week»", () => {
    const ids = MANAGER_TABS.map((t) => t.id);
    expect(ids).not.toContain("assignments");
    expect(ids).not.toContain("week");
  });

  it("TABS (el empleado) no tiene «week»", () => {
    expect(TABS.map((t) => t.id)).not.toContain("week");
  });
});

describe("Registrar tiempo muestra las dos secciones debajo del reloj", () => {
  it("la página monta SeccionesDeRegistrarTiempo y NO importa Cronometro", () => {
    const pagina = codigoDe(PAGINA);
    expect(pagina).toContain('import { SeccionesDeRegistrarTiempo } from "@/components/timetracker/SeccionesDeRegistrarTiempo";');
    expect(pagina).toContain("return <SeccionesDeRegistrarTiempo />;");
    expect(pagina).not.toContain("Cronometro");
  });

  it("el horario solo para admins (useData().me.role === \"admin\"), dentro de su elemento data-seccion-de-registrar=\"horario\"", () => {
    const s = codigoDe(SECCIONES);
    expect(s).toContain("const { me } = useData();");
    const puerta = s.indexOf('me.role === "admin" && (');
    expect(puerta).toBeGreaterThan(-1);
    const bloque = s.slice(puerta, s.indexOf("</SeccionDeRegistrar>", puerta));
    expect(bloque).toContain('seccion="horario"');
    expect(bloque).toContain("<ScheduleWeek />");
    // El atributo del contenedor lleva el valor de la sección.
    expect(s).toContain("data-seccion-de-registrar={seccion}");
  });

  it("«My week» para todos, dentro de su elemento data-seccion-de-registrar=\"semana\", sin puerta de rol", () => {
    const s = codigoDe(SECCIONES);
    const bloque = s.slice(s.indexOf('seccion="semana"'), s.indexOf("</SeccionDeRegistrar>", s.indexOf('seccion="semana"')));
    expect(bloque).toContain("<MiSemana />");
    expect(bloque).not.toContain("admin");
    // Y el contenido de la puerta de «Schedule» no se lleva a «My week».
    expect(s.indexOf('me.role === "admin" && (')).toBeLessThan(s.indexOf('seccion="semana"'));
  });

  it("los títulos son las claves de siempre: tab.assignments (Schedule) y tab.week (My week)", () => {
    const s = codigoDe(SECCIONES);
    expect(s).toContain('titulo={t("tab.assignments")}');
    expect(s).toContain('titulo={t("tab.week")}');
  });

  it("las secciones se abren por URL (?vista=horario / ?vista=semana) y se leen con useSearchParams dentro de Suspense", () => {
    const s = codigoDe(SECCIONES);
    expect(s).toContain("useSearchParams().get(\"vista\")");
    expect(s).toContain('porUrl={vista === "horario"}');
    expect(s).toContain('porUrl={vista === "semana"}');
    expect(s).toContain("<Suspense fallback={null}>");
  });

  it("se abren cerradas por defecto y el cuerpo no se monta mientras están cerradas", () => {
    const s = codigoDe(SECCIONES);
    expect(s).toContain("const abierta = elegida ?? (porUrl || recordada === true);");
    expect(s).toContain("{abierta && <div id={cuerpo} className=\"tt-seccion-cuerpo\">{children}</div>}");
  });

  it("la cabecera es un botón con aria-expanded y su data-seccion-de-registrar", () => {
    const s = codigoDe(SECCIONES);
    expect(s).toContain("<button");
    expect(s).toContain('aria-expanded={abierta}');
    expect(s).toContain("data-seccion-de-registrar={seccion}");
  });

  it("la elección se recuerda con sus dos claves, en localStorage vía los helpers de seccion-plegable", () => {
    const s = codigoDe(SECCIONES);
    expect(s).toContain('horario: "tt_registrar_horario_abierta"');
    expect(s).toContain('semana: "tt_registrar_semana_abierta"');
    expect(s).toContain("leerEleccion(almacenDelNavegador(), CLAVES_DE_ELECCION[seccion])");
    expect(s).toContain("guardarEleccion(almacenDelNavegador(), CLAVES_DE_ELECCION[seccion], nueva)");
  });

  it("la URL pide la sección: se lleva a la vista con scrollIntoView", () => {
    const s = codigoDe(SECCIONES);
    expect(s).toContain("ref.current?.scrollIntoView({ block: \"start\" });");
  });

  it("el componente no importa el cronómetro (el layout lo monta)", () => {
    expect(codigoDe(SECCIONES)).not.toContain("Cronometro");
  });
});

describe("las rutas viejas llevan a su sitio nuevo", () => {
  it("/timetracker/assignments redirige a ?vista=horario", () => {
    expect(codigoDe(ASIGNACIONES_PAGINA)).toContain('redirect("/timetracker?vista=horario")');
    expect(codigoDe(ASIGNACIONES_PAGINA)).not.toContain("createClient");
  });

  it("/timetracker/schedule redirige a ?vista=horario", () => {
    expect(codigoDe(HORARIO_PAGINA)).toContain('redirect("/timetracker?vista=horario")');
  });

  it("/timetracker/week redirige a ?vista=semana", () => {
    expect(codigoDe(SEMANA_PAGINA)).toContain('redirect("/timetracker?vista=semana")');
    expect(codigoDe(SEMANA_PAGINA)).not.toContain("createClient");
  });

  it("next.config.mjs: /clock-in/schedule y /timetracker/clock-in/schedule van a /timetracker?vista=horario", () => {
    const config = leer("next.config.mjs");
    expect(config).toContain('{ source: "/clock-in/schedule", destination: "/timetracker?vista=horario", permanent: false }');
    expect(config).toContain('{ source: "/timetracker/clock-in/schedule", destination: "/timetracker?vista=horario", permanent: false }');
    expect(config).not.toContain('destination: "/timetracker/assignments"');
  });

  it("y el componente de la pantalla de asignaciones antigua ya no existe", () => {
    expect(() => readFileSync(join(process.cwd(), "src/components/timetracker/AssignmentsTabs.tsx"))).toThrow();
  });
});
