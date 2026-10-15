import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DELIVERIES_CARD, HUB_TOOLS, MODULES, ROLE_ORDER, roleHome } from "@/lib/constants";
import type { UserRole } from "@/lib/types";
import {
  CASILLAS, COLUMNAS, FLECHAS, alcanceDe, casilla, celdaDe, colocacion, estadoDeCasilla, otrasApps, secuenciaMovil,
  trazoDe, type Casilla, type Flecha,
} from "./mapa-de-apps";

// El mapa de apps del hub (D-NEXT). Lo que decide vive en mapa-de-apps.ts y estas pruebas lo IMPORTAN.

/** Las rutas que existen en este repo: cada page.tsx de src/app, sin los grupos «(x)». */
function rutasDelRepo(): Set<string> {
  const out = new Set<string>();
  const recorrer = (dir: string, partes: string[]) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) recorrer(p, /^\(.*\)$/.test(f) ? partes : [...partes, f]);
      else if (f === "page.tsx") out.add("/" + partes.join("/"));
    }
  };
  recorrer(join(process.cwd(), "src/app"), []);
  return out;
}

/** Todos los href a los que puede llevar una casilla de color, sea quien sea quien la abra. */
function hrefsPosibles(c: Casilla): string[] {
  const d = c.destino!;
  if (d.tipo === "modulo") {
    if (d.clave === DELIVERIES_CARD.key) return [...new Set(ROLE_ORDER.map((r) => roleHome(r)))];
    const m = MODULES.find((x) => x.key === d.clave);
    return [d.ruta ?? m!.href];
  }
  return d.claves.map((k) => HUB_TOOLS.find((t) => t.key === k)!.href);
}

const COLOR = ["deliveries", "erp-inventory", "leads", "quote-builder", "users", "hr", "time-tracker", "surveys", "help-requests", "tutorials", "phone-book"];
const GRIS = ["purchase-orders", "receive-inventory", "enter-bills", "pay-bills", "sales-order", "refunds-credits", "create-invoice", "receive-payments", "record-deposits"];

const TODO = ["deliveries", "recruiting", "timetracker", "erp", "promos", "estimator", "surveys", "leads"];

describe("las casillas del diagrama del jefe", () => {
  it("once de color (existen) y nueve grises (aún no), como las dibujó", () => {
    expect(CASILLAS.filter((c) => c.existe).map((c) => c.key).sort()).toEqual([...COLOR].sort());
    expect(CASILLAS.filter((c) => !c.existe).map((c) => c.key).sort()).toEqual([...GRIS].sort());
  });

  it("una casilla gris no tiene destino, y una de color siempre lo tiene", () => {
    for (const c of CASILLAS) expect([c.key, c.destino === undefined]).toEqual([c.key, !c.existe]);
  });

  it("cada destino de color es una ruta real de este repo (su page.tsx existe)", () => {
    const rutas = rutasDelRepo();
    expect(rutas.has("/home/users")).toBe(true); // control: el recorrido encuentra rutas
    for (const c of CASILLAS.filter((x) => x.existe)) {
      for (const h of hrefsPosibles(c)) expect([c.key, h, rutas.has(h)]).toEqual([c.key, h, true]);
    }
  });

  it("cada destino apunta a un módulo o herramienta que existe", () => {
    for (const c of CASILLAS.filter((x) => x.existe)) {
      const d = c.destino!;
      if (d.tipo === "modulo") expect([c.key, [DELIVERIES_CARD, ...MODULES].some((m) => m.key === d.clave)]).toEqual([c.key, true]);
      else for (const k of d.claves) expect([c.key, k, HUB_TOOLS.some((t) => t.key === k)]).toEqual([c.key, k, true]);
    }
  });

  it("Purchase Orders, Sales Order y Quote Builder comparten columna (por eso la flecha cruza de panel)", () => {
    expect(casilla("purchase-orders").columna).toBe(casilla("sales-order").columna);
    expect(casilla("sales-order").columna).toBe(casilla("quote-builder").columna);
  });

  it("ninguna casilla de Proveedores o Clientes se sale de la rejilla, y no hay dos en la misma celda", () => {
    const vistas = new Set<string>();
    for (const c of CASILLAS.filter((x) => x.panel !== "employees")) {
      expect(c.columna).toBeGreaterThanOrEqual(1);
      expect(c.columna).toBeLessThanOrEqual(COLUMNAS);
      const k = `${c.panel}:${c.fila}:${c.columna}`;
      expect(vistas.has(k)).toBe(false);
      vistas.add(k);
    }
  });
});

describe("las flechas no mienten", () => {
  it("son las diez del diagrama, con su sentido", () => {
    expect(FLECHAS.map((f) => `${f.de}>${f.a}`).sort()).toEqual([
      "create-invoice>receive-payments", "deliveries>receive-inventory", "enter-bills>pay-bills", "leads>quote-builder",
      "purchase-orders>deliveries", "quote-builder>create-invoice", "quote-builder>sales-order", "receive-inventory>enter-bills",
      "receive-payments>record-deposits", "sales-order>purchase-orders",
    ]);
  });

  it("hoy ninguna está conectada (medido en el código el 2026-10-14), y cada una dice por qué", () => {
    expect(FLECHAS.filter((f) => f.conectada)).toEqual([]);
    for (const f of FLECHAS) expect([f.de, f.a, /^no existe \(2026-10-14\)/.test(f.evidencia)]).toEqual([f.de, f.a, true]);
  });

  it("Leads → Quote Builder: las dos existen y aun así está por conectar", () => {
    const f = FLECHAS.find((x) => x.de === "leads" && x.a === "quote-builder")!;
    expect(casilla("leads").existe && casilla("quote-builder").existe).toBe(true);
    expect(trazoDe(f)).toBe("por-conectar");
  });

  it("trazoDe: continua solo si está conectada Y sus dos casillas existen", () => {
    const con = (de: string, a: string): Flecha => ({ de, a, conectada: true, evidencia: "x" });
    expect(trazoDe(con("leads", "quote-builder"))).toBe("conectada");
    expect(trazoDe(con("quote-builder", "create-invoice"))).toBe("por-conectar");
    expect(trazoDe(con("purchase-orders", "deliveries"))).toBe("por-conectar");
    expect(trazoDe({ ...con("leads", "quote-builder"), conectada: false })).toBe("por-conectar");
  });

  it("cada flecha se coloca entre sus dos casillas, y ninguna comparte celda", () => {
    const usadas = new Set<string>();
    for (const f of FLECHAS) {
      const p = colocacion(f);
      const k = `${p.panel}:${p.gridRow}:${p.gridColumn}`;
      expect(usadas.has(k)).toBe(false);
      usadas.add(k);
    }
    expect(colocacion(FLECHAS.find((f) => f.de === "purchase-orders")!)).toEqual({ panel: "vendors", gridRow: "1", gridColumn: "4", direccion: "derecha" });
    expect(colocacion(FLECHAS.find((f) => f.de === "quote-builder" && f.a === "sales-order")!)).toEqual({ panel: "customers", gridRow: "2", gridColumn: "3", direccion: "arriba" });
  });

  it("la que cruza (Sales Order → Purchase Orders) va en Proveedores, debajo de Purchase Orders y apuntando arriba", () => {
    const p = colocacion(FLECHAS.find((f) => f.de === "sales-order")!);
    expect(p.panel).toBe("vendors");
    expect(p.direccion).toBe("arriba");
    expect(p.gridColumn).toBe(celdaDe(casilla("purchase-orders")).gridColumn);
  });

  it("dos casillas no contiguas sin «cruce» no se pueden colocar", () => {
    expect(() => colocacion({ de: "leads", a: "create-invoice", conectada: false, evidencia: "x" })).toThrow();
    expect(() => colocacion({ de: "leads", a: "users", conectada: false, evidencia: "x" })).toThrow();
  });
});

describe("el acceso es el del hub de antes", () => {
  const al = (role: UserRole, module_access: string[] | null, suplantando = false) => alcanceDe({ role, module_access, suplantando });
  const estado = (key: string, a: ReturnType<typeof al>) => estadoDeCasilla(casilla(key), a);

  it("una casilla gris nunca se abre, ni para el admin con todo", () => {
    const admin = al("admin", TODO);
    for (const k of GRIS) expect([k, estado(k, admin)]).toEqual([k, { estado: "proximamente" }]);
  });

  it("Entregas lleva a la pantalla de cada rol", () => {
    expect(estado("deliveries", al("sales", ["deliveries", "leads"]))).toMatchObject({ estado: "abierta", href: "/" });
    expect(estado("deliveries", al("warehouse", ["deliveries", "leads"]))).toMatchObject({ estado: "abierta", href: "/warehouse" });
    expect(estado("deliveries", al("logistics", ["deliveries", "leads"]))).toMatchObject({ estado: "abierta", href: "/routes" });
  });

  it("un módulo que no tiene sale con candado, no se abre", () => {
    const ventas = al("sales", ["deliveries", "leads"]);
    expect(estado("leads", ventas)).toMatchObject({ estado: "abierta", href: "/leads" });
    expect(estado("quote-builder", ventas)).toEqual({ estado: "sin-acceso" });
    expect(estado("hr", ventas)).toEqual({ estado: "sin-acceso" });
    expect(estado("erp-inventory", ventas)).toEqual({ estado: "sin-acceso" });
  });

  it("Inventario ERP abre /erp/inventory con el módulo, y sin él no (ni al admin, igual que la rejilla de antes)", () => {
    expect(estado("erp-inventory", al("manager", ["erp"]))).toMatchObject({ estado: "abierta", href: "/erp/inventory" });
    expect(estado("erp-inventory", al("admin", ["deliveries"]))).toEqual({ estado: "sin-acceso" });
  });

  it("Usuarios solo para el admin; el directorio y los tutoriales para todos", () => {
    expect(estado("users", al("manager", ["deliveries"]))).toEqual({ estado: "sin-acceso" });
    expect(estado("users", al("admin", ["deliveries"]))).toMatchObject({ estado: "abierta", href: "/home/users" });
    expect(estado("phone-book", al("sales", ["deliveries"]))).toMatchObject({ estado: "abierta", href: "/home/directory" });
    expect(estado("tutorials", al("sales", ["deliveries"]))).toMatchObject({ estado: "abierta", href: "/home/tutorials" });
  });

  it("Help Requests: la bandeja de todos para el admin, las suyas para el resto", () => {
    expect(estado("help-requests", al("admin", ["deliveries"]))).toMatchObject({ href: "/home/solicitudes-de-ayuda", herramienta: "help-requests" });
    expect(estado("help-requests", al("sales", ["deliveries"]))).toMatchObject({ href: "/home/ayuda", herramienta: "my-help" });
  });

  it("nada se pierde y nada se añade: lo que se abre en el mapa más «Otras apps» es justo lo que pintaba el hub", () => {
    const accesos: (string[] | null)[] = [null, [], ["deliveries"], ["promos"], ["deliveries", "leads"], ["clockin"], TODO, ["erp", "surveys", "estimator"]];
    for (const role of ROLE_ORDER) for (const ma of accesos) for (const sup of [false, true]) {
      const a = al(role, ma, sup);
      const antes = [...a.modulos.map((m) => `modulo:${m.key}`), ...a.herramientas.map((t) => `herramienta:${t.key}`)].sort();
      const abiertas = CASILLAS.map((c) => estadoDeCasilla(c, a)).flatMap((e) => (e.estado === "abierta" ? [e.llave] : []));
      const ahora = [...abiertas, ...otrasApps(a).map((o) => o.llave)].sort();
      expect([role, ma, sup, ahora]).toEqual([role, ma, sup, antes]);
    }
  });

  it("«Otras apps»: RTG PROMOS, y las herramientas del admin real que el mapa no dibuja", () => {
    expect(otrasApps(al("sales", ["deliveries", "promos"])).map((o) => o.key)).toEqual(["promos"]);
    expect(otrasApps(al("admin", ["deliveries"])).map((o) => o.key)).toEqual(["my-help", "vista-movil", "switch-user"]);
    expect(otrasApps(al("admin", ["deliveries"], true)).map((o) => o.key)).toEqual(["my-help"]);
    expect(otrasApps(al("sales", ["deliveries"]))).toEqual([]);
  });
});

describe("en el teléfono", () => {
  it("cada flecha sale una sola vez: de chevrón o en la línea de su casilla", () => {
    const vistas: string[] = [];
    for (const panel of ["vendors", "customers", "employees"] as const) {
      for (const paso of secuenciaMovil(panel)) {
        if (paso.siguiente) vistas.push(`${paso.siguiente.de}>${paso.siguiente.a}`);
        for (const f of paso.otras) vistas.push(`${f.de}>${f.a}`);
      }
    }
    expect(vistas.sort()).toEqual(FLECHAS.map((f) => `${f.de}>${f.a}`).sort());
  });

  it("primero la fila principal, de izquierda a derecha", () => {
    expect(secuenciaMovil("vendors").map((p) => p.casilla.key)).toEqual(["purchase-orders", "deliveries", "receive-inventory", "enter-bills", "pay-bills", "erp-inventory"]);
    expect(secuenciaMovil("customers").map((p) => p.casilla.key)).toEqual(["leads", "quote-builder", "create-invoice", "receive-payments", "record-deposits", "sales-order", "refunds-credits"]);
  });

  it("un chevrón solo une dos pasos que tienen flecha", () => {
    const v = secuenciaMovil("vendors");
    expect(v.find((p) => p.casilla.key === "pay-bills")!.siguiente).toBeNull();
    expect(secuenciaMovil("customers").find((p) => p.casilla.key === "quote-builder")!.otras.map((f) => f.a)).toEqual(["sales-order"]);
  });
});

describe("el hub pinta el mapa con las listas de siempre", () => {
  const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  it("HomeSelector pasa a MapaDeApps los mismos `available` y `tools` que pintaba la rejilla", () => {
    const hub = leer("src/components/HomeSelector.tsx");
    expect(hub).toContain("<MapaDeApps alcance={{ role: me.role, modulos: available, herramientas: tools }}");
    expect(hub).not.toContain("module-pick-grid");
  });
  it("el trazo de la flecha lo decide trazoDe, no el campo `conectada` a pelo", () => {
    const mapa = leer("src/components/MapaDeApps.tsx");
    expect(mapa).toContain("is-${trazoDe(f)}");
    expect(mapa).not.toMatch(/\.conectada\b/);
    expect(existsSync(join(process.cwd(), "src/lib/mapa-de-apps.ts"))).toBe(true);
  });
});
