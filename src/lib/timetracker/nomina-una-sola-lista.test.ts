import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Nómina (2026-11-25): UNA sola lista de personas (remotas y de sitio juntas). La pantalla ya no tiene las dos
// secciones plegables; cada acción que tenía una sección sigue alcanzable en su sitio. Se mira el fuente.
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

describe("PayrollTabs · sin secciones plegables: una sola lista", () => {
  const tabs = leer("src/components/timetracker/PayrollTabs.tsx");

  it("no hay <details>, ni <Seccion>, ni la función Seccion", () => {
    expect(tabs).not.toContain("<details");
    expect(tabs).not.toContain("<Seccion");
    expect(tabs).not.toContain("function Seccion(");
  });

  it("con una semana, el remoto entra en la lista (enLista); con varias, solo la de sitio", () => {
    expect(tabs).toContain("enLista={(r) => (");
    expect(tabs).toContain("remotos={r.bloques} barraRemota={r.barra}");
    expect(tabs).toContain("alCargarDatos={setDatos}");
  });

  it("la estatus de quién trabaja lo calcula la pantalla y lo pasa a las dos mitades", () => {
    expect(tabs).toContain("useQuienTrabaja(");
    expect(tabs).toContain("trabajando={trabajando}");
  });
});

describe("ManagerReports · sigue entero, y expone sus piezas", () => {
  const rep = leer("src/components/timetracker/ManagerReports.tsx");

  it("expone enLista con barra, bloques, modales, cargando y error", () => {
    expect(rep).toContain("enLista?: (partes: {");
    expect(rep).toContain("barra: React.ReactNode;");
    expect(rep).toContain("bloques: { id: string; nombre: string; nodo: React.ReactNode }[];");
    expect(rep).toContain("modales: React.ReactNode;");
    expect(rep).toContain("if (enLista) return <>{enLista(partes)}</>;");
  });

  it("conserva sus acciones de pago y de ajuste", () => {
    for (const f of ["markPaid", "toggleBatch", "reopen", "openReceipt", "printStub", "addAdjustment", "removeAdjustment", "exportCSV", "addManualEntry", "deleteEntry", "saveEditEntry", "abrirCapturas"]) {
      expect(rep, f).toContain("function " + f + "(");
    }
  });

  it("conserva los atributos del 🖥 por día y por sesión, y el nombre con su estado", () => {
    expect(rep).toContain("data-capturas-del-dia={d.dia}");
    expect(rep).toContain("data-capturas-de-sesion={s.id}");
    expect(rep).toContain('className="tt-nombre-de-trabajo" data-trabajando={estadoDeTrabajo(uid, trabajando)}');
  });
});

describe("PayrollTimesheets · la de sitio sigue entera, y mezcla las remotas", () => {
  const pt = leer("src/components/timetracker/PayrollTimesheets.tsx");

  it("conserva aprobar, corregir fichajes, cierre de periodo y exportaciones", () => {
    for (const f of ["approveTimesheet", "unapproveTimesheet", "addEntry", "editEntry", "deleteEntry", "ownerSignoff", "revokeSignoff"]) {
      expect(pt, f).toContain(f);
    }
    expect(pt).toContain("/timetracker/clock-in/api/reports/xlsx?week=");
    expect(pt).toContain("/timetracker/clock-in/api/reports/export?type=summary");
    expect(pt).toContain("/timetracker/clock-in/api/reports/export?type=detail");
    expect(pt).toContain('data-vista-de-horas="hoja"');
    expect(pt).toContain('data-vista-de-horas="tabla"');
  });

  it("recibe remotos y barraRemota, y mezcla con unionDeNomina", () => {
    expect(pt).toContain("remotos = []");
    expect(pt).toContain("barraRemota = null");
    expect(pt).toContain("unionDeNomina(");
    expect(pt).toContain("{remotosVisibles.length > 0 && barraRemota}");
    expect(pt).toContain("const remotosVisibles = remotos.filter(");
  });
});
