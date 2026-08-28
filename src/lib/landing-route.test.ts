import { describe, it, expect } from "vitest";
import { accessibleModules, HUB_TOOLS, landingRoute, MODULE_ACCESS } from "@/lib/constants";

// D-100 dio la vuelta a la premisa de estas pruebas: Entregas ya no es implícita, se
// otorga como los demás módulos. Lo que antes se afirmaba —"sin module_access aterrizas
// en el tablero"— ahora sería un fallo: la base le devolvería cero filas.
describe("landingRoute", () => {
  it("manda al chofer a su ruta, aunque tenga otro módulo", () => {
    expect(landingRoute({ role: "driver", module_access: ["deliveries"] })).toBe("/driver");
    expect(landingRoute({ role: "driver", module_access: ["deliveries", "recruiting"] })).toBe("/driver");
  });

  it("un chofer SIN Entregas no va al tablero de choferes", () => {
    // Su ruta vive dentro de Entregas. Sin acceso, mandarle ahí es una pantalla vacía.
    expect(landingRoute({ role: "driver", module_access: ["clockin"] })).toBe("/clock-in/dashboard");
  });

  it("con dos o más módulos, al selector", () => {
    expect(landingRoute({ role: "admin", module_access: ["deliveries", "recruiting"] })).toBe("/home");
    expect(landingRoute({ role: "sales", module_access: ["deliveries", "recruiting"] })).toBe("/home");
  });

  it("con Entregas y nada más, al sitio que le toca por rol", () => {
    expect(landingRoute({ role: "admin", module_access: ["deliveries"] })).toBe("/");
    expect(landingRoute({ role: "manager", module_access: ["deliveries"] })).toBe("/");
    expect(landingRoute({ role: "sales", module_access: ["deliveries"] })).toBe("/");
    expect(landingRoute({ role: "warehouse", module_access: ["deliveries"] })).toBe("/warehouse");
    expect(landingRoute({ role: "logistics", module_access: ["deliveries"] })).toBe("/routes");
  });

  it("con un solo módulo que NO es Entregas, entra directo a ese", () => {
    expect(landingRoute({ role: "sales", module_access: ["clockin"] })).toBe("/clock-in/dashboard");
    expect(landingRoute({ role: "sales", module_access: ["timetracker"] })).toBe("/timetracker");
  });

  it("sin ningún módulo, a la pantalla que lo explica — no a una vacía", () => {
    expect(landingRoute({ role: "sales", module_access: [] })).toBe("/no-access");
    expect(landingRoute({ role: "warehouse", module_access: null })).toBe("/no-access");
    expect(landingRoute({ role: "admin" })).toBe("/no-access");
  });
});

// D-054: the single source both HomeSelector and ModuleSwitcher read from.
describe("accessibleModules", () => {
  it("sin módulos no dibuja NADA — antes dibujaba Entregas (D-100)", () => {
    expect(accessibleModules(null)).toEqual([]);
    expect(accessibleModules(undefined)).toEqual([]);
    expect(accessibleModules([])).toEqual([]);
  });

  it("Entregas solo si se otorgó, y va primera", () => {
    expect(accessibleModules(["deliveries"]).map((m) => m.key)).toEqual(["deliveries"]);
    expect(accessibleModules(["deliveries", "recruiting"]).map((m) => m.key)).toEqual(["deliveries", "recruiting"]);
  });

  it("un módulo sin Entregas se dibuja solo, sin colarla", () => {
    expect(accessibleModules(["recruiting"]).map((m) => m.key)).toEqual(["recruiting"]);
    expect(accessibleModules(["timetracker"]).map((m) => m.key)).toEqual(["timetracker"]);
    expect(accessibleModules(["clockin"]).map((m) => m.key)).toEqual(["clockin"]);
  });

  it("varios, en el orden en que MODULES los declara", () => {
    expect(accessibleModules(["deliveries", "recruiting", "timetracker"]).map((m) => m.key))
      .toEqual(["deliveries", "recruiting", "timetracker"]);
  });

  it("un valor que no corresponde a ningún módulo se ignora", () => {
    expect(accessibleModules(["not-a-real-module"])).toEqual([]);
    expect(accessibleModules(["not-a-real-module", "deliveries"]).map((m) => m.key)).toEqual(["deliveries"]);
  });
});

// D-056: Users is the first hub tool — granted by ROLE, not module_access.
describe("HUB_TOOLS", () => {
  it("users is visible only to a deliveries admin", () => {
    const users = HUB_TOOLS.find((t) => t.key === "users")!;
    expect(users.visible({ role: "admin" })).toBe(true);
    for (const role of ["manager", "sales", "warehouse", "driver", "logistics", "accounting"] as const) {
      expect(users.visible({ role })).toBe(false);
    }
  });
});

// D-057: the structural defense against the D-052/D-053 class of bug — two
// modules writing to the same profiles column. If this ever fails, someone
// added a module whose role lives on a column another module already owns.
describe("MODULE_ACCESS", () => {
  it("no two modules write their role to the same column", () => {
    // Los que no tienen escalafón propio (erp, clockin desde 084) no cuentan: varios
    // `undefined` no son un choque, y contarlos como tal ocultaba el choque de verdad.
    const columns = MODULE_ACCESS.map((m) => m.roleColumn).filter(Boolean);
    expect(new Set(columns).size).toBe(columns.length);
  });

  it("ningún módulo se concede solo — Entregas tampoco, desde D-100", () => {
    // Si esto vuelve a fallar es que alguien marcó un módulo como alwaysOn, y con eso
    // su casilla se dibuja en gris: el admin deja de poder quitárselo a nadie.
    for (const m of MODULE_ACCESS) expect(m.alwaysOn).toBe(false);
  });

  it("only deliveries carries fine-grained capabilities", () => {
    const deliveries = MODULE_ACCESS.find((m) => m.key === "deliveries")!;
    const recruiting = MODULE_ACCESS.find((m) => m.key === "recruiting")!;
    const timetracker = MODULE_ACCESS.find((m) => m.key === "timetracker")!;
    expect(deliveries.capabilities?.length).toBeGreaterThan(0);
    expect(recruiting.capabilities).toBeUndefined();
    expect(timetracker.capabilities).toBeUndefined();
  });
});

// D-100: la casilla de cada módulo se dibuja desde `module_access`, no desde si hay rol.
// `profiles.role` nunca es nulo, así que leer el rol daba "otorgado" siempre para
// Entregas y su casilla no se podía desmarcar. Los cinco declaran accessColumn para que
// el diálogo tenga de dónde leerlo.
describe("MODULE_ACCESS · de dónde sale el estado de la casilla", () => {
  it("los cinco módulos dicen en qué columna vive su acceso", () => {
    for (const m of MODULE_ACCESS) expect(m.accessColumn).toBe("module_access");
  });
});

// Fase 1 de la fusión (084): el escalafón es el de Time Tracker y clock-in ya no tiene
// uno propio. Si alguien le devuelve un roleColumn, vuelven a existir dos controles
// escribiendo la misma decisión — y el que se toque de segundo gana en silencio.
describe("MODULE_ACCESS · un solo escalafón para fichaje", () => {
  it("clock-in no declara rol propio y explica por qué", () => {
    const clockin = MODULE_ACCESS.find((m) => m.key === "clockin")!;
    expect(clockin.roleColumn).toBeUndefined();
    expect(clockin.roleKeys).toEqual([]);
    expect(clockin.roleNote).toBeDefined();
  });

  it("todo módulo sin escalafón trae su propia nota, no la de otro", () => {
    // El diálogo enseñaba el texto del ERP en cualquier módulo sin rol; en fichaje
    // hablaba de costos y márgenes que ahí no existen.
    for (const m of MODULE_ACCESS) {
      if (!m.roleColumn) expect(m.roleNote, `${m.key} sin nota`).toBeDefined();
    }
  });
});
