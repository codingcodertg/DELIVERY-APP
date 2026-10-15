import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DELIVERIES_CARD, HUB_TOOLS, MODULES, ROLE_ORDER, roleHome } from "@/lib/constants";
import type { UserRole } from "@/lib/types";
import {
  CASILLAS, COLUMNAS, FLECHAS, alcanceDe, casilla, celdaDe, colocacion, estadoDeCasilla, otrasApps, secuenciaMovil,
  trazoDe, veComprasDe, type Casilla, type Flecha,
  RUTA_MAPA_DE_LA_EMPRESA,
} from "./mapa-de-apps";

// El mapa de apps del hub (D-554). Lo que decide vive en mapa-de-apps.ts y estas pruebas lo IMPORTAN.

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

// Nota D-558: Purchase Orders y Receive Inventory pasan de gris a color (abren las del ERP); antes, once y nueve.
const COLOR = ["purchase-orders", "receive-inventory", "deliveries", "erp-inventory", "leads", "quote-builder", "users", "hr", "time-tracker", "surveys", "help-requests", "tutorials", "phone-book"];
const GRIS = ["enter-bills", "pay-bills", "sales-order", "refunds-credits", "create-invoice", "receive-payments", "record-deposits"];

const TODO = ["deliveries", "recruiting", "timetracker", "erp", "promos", "estimator", "surveys", "leads"];

describe("las casillas del diagrama del jefe", () => {
  it("trece de color (existen) y siete grises (aún no): las del jefe más las dos del ERP (D-558)", () => {
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

  // Nota D-558: antes «hoy ninguna está conectada (medido el 2026-10-14)». Ahora una, Leads → Quote Builder, y la
  // leyenda dice «1 de 10». Las demás siguen diciendo por qué no (las dos del ERP re-medidas el 2026-10-15).
  it("hoy solo Leads → Quote Builder está conectada, y cada una dice por qué sí o por qué no", () => {
    expect(FLECHAS.filter((f) => f.conectada).map((f) => `${f.de}>${f.a}`)).toEqual(["leads>quote-builder"]);
    expect(FLECHAS.filter((f) => trazoDe(f) === "conectada")).toHaveLength(1);
    for (const f of FLECHAS) {
      const patron = f.conectada ? /^conectada \(2026-10-15\)/ : /^no existe \(2026-10-1[45]\)/;
      expect([f.de, f.a, patron.test(f.evidencia)]).toEqual([f.de, f.a, true]);
    }
  });

  it("Leads → Quote Builder: continua, y dice lo que le falta fuera del código (la migración 175)", () => {
    const f = FLECHAS.find((x) => x.de === "leads" && x.a === "quote-builder")!;
    expect(trazoDe(f)).toBe("conectada");
    expect(f.pendiente).toMatch(/migración 175/);
    // Solo la que está conectada lleva `pendiente`: a una por conectar no le falta «una migración», le falta todo.
    expect(FLECHAS.filter((x) => x.pendiente).map((x) => x.a)).toEqual(["quote-builder"]);
  });

  it("la evidencia de la conectada apunta a líneas reales: cada `fichero:línea «texto»` contiene ese texto", () => {
    const f = FLECHAS.find((x) => x.de === "leads" && x.a === "quote-builder")!;
    const citas = [...f.evidencia.matchAll(/(\S+\.(?:tsx?|sql)):(\d+) «([^»]+)»/g)];
    expect(citas.length).toBeGreaterThanOrEqual(6);
    for (const [, fichero, linea, texto] of citas) {
      const l = readFileSync(join(process.cwd(), fichero), "utf8").split(/\r?\n/)[Number(linea) - 1] ?? "";
      expect([fichero, linea, l.includes(texto)]).toEqual([fichero, linea, true]);
    }
  });

  it("Purchase Orders → Deliveries y Deliveries → Receive Inventory: las casillas ya abren, la flecha no existe", () => {
    for (const [de, a] of [["purchase-orders", "deliveries"], ["deliveries", "receive-inventory"]]) {
      const f = FLECHAS.find((x) => x.de === de && x.a === a)!;
      expect([de, casilla(de).existe && casilla(a).existe, trazoDe(f)]).toEqual([de, true, "por-conectar"]);
    }
  });

  it("trazoDe: continua solo si está conectada Y sus dos casillas existen", () => {
    const con = (de: string, a: string): Flecha => ({ de, a, conectada: true, evidencia: "x" });
    expect(trazoDe(con("leads", "quote-builder"))).toBe("conectada");
    expect(trazoDe(con("quote-builder", "create-invoice"))).toBe("por-conectar");
    // Nota D-558: aquí iba purchase-orders → deliveries, que ya no tiene casilla gris; se usa otra con una gris.
    expect(trazoDe(con("receive-inventory", "enter-bills"))).toBe("por-conectar");
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

  it("Purchase Orders y Receive Inventory (D-558): abren las pantallas del ERP con el módulo erp Y el nivel de compras", () => {
    const conNivel = { ...al("manager", ["erp"]), veCompras: true };
    expect(estado("purchase-orders", conNivel)).toMatchObject({ estado: "abierta", href: "/erp/purchasing/orders", llave: "modulo:erp" });
    expect(estado("receive-inventory", conNivel)).toMatchObject({ estado: "abierta", href: "/erp/purchasing/receiving", llave: "modulo:erp" });
  });

  it("con el módulo erp pero sin el nivel de compras, candado (la página lo mandaría al catálogo); Inventario ERP sí abre", () => {
    const sinNivel = { ...al("manager", ["erp"]), veCompras: false };
    expect(estado("purchase-orders", sinNivel)).toEqual({ estado: "sin-acceso", motivo: "nivel-erp" });
    expect(estado("receive-inventory", sinNivel)).toEqual({ estado: "sin-acceso", motivo: "nivel-erp" });
    expect(estado("erp-inventory", sinNivel)).toMatchObject({ estado: "abierta" });
    // Sin el dato, falla cerrado.
    const { veCompras: _, ...sinDato } = sinNivel;
    void _;
    expect(estado("purchase-orders", sinDato)).toEqual({ estado: "sin-acceso", motivo: "nivel-erp" });
  });

  it("sin el módulo erp, candado de módulo aunque tenga el nivel", () => {
    expect(estado("purchase-orders", { ...al("admin", ["deliveries"]), veCompras: true })).toEqual({ estado: "sin-acceso" });
  });

  it("veComprasDe: el nivel del ERP (erp_role), no el rol del hub; manager y admin sí, lo demás no", () => {
    expect(veComprasDe({ erp_role: "manager" })).toBe(true);
    expect(veComprasDe({ erp_role: "admin" })).toBe(true);
    for (const r of ["staff", null, undefined, "", "sales", "ADMIN"]) expect([r, veComprasDe({ erp_role: r })]).toEqual([r, false]);
    expect(alcanceDe({ role: "admin", module_access: ["erp"] }).veCompras).toBe(false);
    expect(alcanceDe({ role: "sales", module_access: ["erp"], erp_role: "manager" }).veCompras).toBe(true);
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
    // Nota D-558: también con y sin el nivel de compras del ERP; las dos casillas nuevas usan la llave `modulo:erp`.
    for (const role of ROLE_ORDER) for (const ma of accesos) for (const sup of [false, true]) for (const erp_role of [null, "manager"]) {
      const a = alcanceDe({ role, module_access: ma, suplantando: sup, erp_role });
      const antes = [...a.modulos.map((m) => `modulo:${m.key}`), ...a.herramientas.map((t) => `herramienta:${t.key}`)].sort();
      const abiertas = CASILLAS.map((c) => estadoDeCasilla(c, a)).flatMap((e) => (e.estado === "abierta" ? [e.llave] : []));
      // Nota D-558: tres casillas abren ya el módulo erp (Inventario, Órdenes de compra, Recepción): se compara el
      // CONJUNTO de entradas, no cuántas casillas lleva cada una.
      const ahora = [...new Set([...abiertas, ...otrasApps(a).map((o) => o.llave)])].sort();
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
  // Nota D-556: el mapa sale del inicio y va a su propia página (`/home/mapa`); el inicio vuelve a las tarjetas de
  // antes con una tarjeta «🗺️ Mapa de la empresa». El dueño, 2026-10-15: «el schema que hicimos de la app pon lo dentro
  // de una app no asi coomo lo dejaste y trae le diseno al rtb hub denuevo».
  it("el mapa vive en su página y recibe los mismos `available` y `tools` que el inicio", () => {
    const pagina = leer("src/components/MapaDeLaEmpresa.tsx");
    expect(pagina).toContain("const available = accessibleModules(me.module_access);");
    expect(pagina).toContain("const tools = HUB_TOOLS.filter((tool) => tool.visible({ ...me, suplantando }));");
    // Nota D-558: más `veCompras`, del `erp_role` que la página lee, para las dos casillas de compras del ERP.
    expect(pagina).toContain("<MapaDeApps alcance={{ role: me.role, modulos: available, herramientas: tools, veCompras: veComprasDe(me) }}");
    expect(leer("src/app/home/mapa/page.tsx")).toContain('.select("id, full_name, role, module_access, erp_role")');
    expect(existsSync(join(process.cwd(), "src/app/home/mapa/page.tsx"))).toBe(true);
    expect(RUTA_MAPA_DE_LA_EMPRESA).toBe("/home/mapa");
  });
  it("el inicio vuelve a sus tarjetas, con la del mapa, y ya no pinta el mapa", () => {
    const hub = leer("src/components/HomeSelector.tsx");
    expect(hub).toContain('<div className="module-pick-grid">');
    expect(hub).toContain("<Link href={RUTA_MAPA_DE_LA_EMPRESA} className=\"module-pick-card\" data-hub-mapa>");
    expect(hub).not.toContain("<MapaDeApps");
  });
  it("la página del mapa tiene las mismas puertas que el inicio", () => {
    const p = leer("src/app/home/mapa/page.tsx");
    expect(p).toContain("if (!canReachHub(me)) redirect(landingRoute(me));");
    expect(p).toContain("if (!user) redirect(");
  });
  it("el trazo de la flecha lo decide trazoDe, no el campo `conectada` a pelo", () => {
    const mapa = leer("src/components/MapaDeApps.tsx");
    expect(mapa).toContain("is-${trazoDe(f)}");
    expect(mapa).not.toMatch(/\.conectada\b/);
    expect(existsSync(join(process.cwd(), "src/lib/mapa-de-apps.ts"))).toBe(true);
  });
});
