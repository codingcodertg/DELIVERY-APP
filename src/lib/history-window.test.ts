import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_EXEMPT_ROLES, RETENTION_DAYS_BACK, retentionFloorISO, seesAllHistory, shiftDateISO, withinRecent, withinRetention } from "./utils";
import { ROLE_INFO } from "./constants";

// El dueño, literal: «in deliveries app the same rule that you can only see yesterday today
// and future applies to everyone except admin and logistic manager».
//
// La ventana ya existía (`withinRetention`); lo que no existía era **quién queda fuera**
// escrito en un sitio. Estaba en tres pantallas de tres formas distintas, y por eso
// `manager` y `accounting` veían el historial entero en el tablero: la condición era una
// lista de tres roles «cercanos», y no estaban en ella.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

const TABLERO = "src/app/(app)/page.tsx";
const CHOFER = "src/app/(app)/driver/page.tsx";
const ALMACEN = "src/app/(app)/warehouse/page.tsx";
const MAPA = "src/app/(app)/map/page.tsx";
const RECORRIDO = "src/app/(app)/track/page.tsx";

describe("quién ve el historial entero", () => {
  it("solo admin y logística", () => {
    expect(seesAllHistory("admin")).toBe(true);
    expect(seesAllHistory("logistics")).toBe(true);
  });

  it("y los otros CINCO entran en la ventana — esto revierte D-356, que se la había quitado a todos", () => {
    // D-356 (2026-09-21) le dio `history` de fábrica a los siete y la ventana dejó de existir. El
    // dueño lo cambió el 2026-09-23: *«ayer, hoy, futuro y atrasadas»*, que es esta misma ventana.
    //
    // Se recorre `ROLE_INFO` en vez de escribir la lista a mano: un rol nuevo aparece aquí solo, y
    // hay que decidir a propósito de qué lado cae en vez de heredarlo por descuido.
    const dentro = Object.keys(ROLE_INFO).filter((r) => !seesAllHistory(r)).sort();
    expect(dentro).toEqual(["accounting", "driver", "manager", "sales", "warehouse"]);
    // El chofer entra: lo preguntamos expresamente y el dueño lo confirmó. Fuera, solo dos.
    expect(seesAllHistory("driver")).toBe(false);
    // Y un rol que no existe en ROLE_CAPS sigue en la ventana: la regla no se abre por defecto.
    expect(seesAllHistory("rol_inventado")).toBe(false);
  });


  it("un rol desconocido o ausente NO queda exento", () => {
    expect(seesAllHistory(null)).toBe(false);
    expect(seesAllHistory(undefined)).toBe(false);
    expect(seesAllHistory("")).toBe(false);
    expect(seesAllHistory("Admin")).toBe(false); // sin normalizar: es un valor de la base, no texto libre
  });

  it("la lista de exentos es la que dice el dueño, y nada más", () => {
    expect([...HISTORY_EXEMPT_ROLES].sort()).toEqual(["admin", "logistics"]);
  });
});

describe("la ventana: el suelo no cambia, y ahora rescata lo atrasado y abierto", () => {
  const hoy = "2026-09-11";
  const ayer = shiftDateISO(hoy, -1);
  // La etapa ya NO da igual cuando la orden es vieja, así que cada caso dice la suya. Antes estas
  // pruebas pasaban `{ delivery_date }` a secas y por eso no vieron el fallo: medían una regla que
  // solo miraba la fecha, que es exactamente la que había que cambiar.
  const cerrada = (delivery_date: string | null) => ({ delivery_date, stage: "delivered" });
  const abierta = (delivery_date: string | null) => ({ delivery_date, stage: "ready" });

  it("ayer, hoy y el futuro entran; anteayer ya cerrada, no", () => {
    expect(withinRetention(cerrada(ayer), hoy)).toBe(true);
    expect(withinRetention(cerrada(hoy), hoy)).toBe(true);
    expect(withinRetention(cerrada(shiftDateISO(hoy, 30)), hoy)).toBe(true);
    expect(withinRetention(cerrada(shiftDateISO(hoy, -2)), hoy)).toBe(false);
  });

  it("y anteayer ABIERTA sí entra: es lo atrasado, que el dueño nombró aparte", () => {
    expect(withinRetention(abierta(shiftDateISO(hoy, -2)), hoy)).toBe(true);
    expect(withinRetention(abierta(shiftDateISO(hoy, -60)), hoy)).toBe(true);
  });

  it("un pedido sin fecha siempre se ve", () => {
    expect(withinRetention({ delivery_date: null }, hoy)).toBe(true);
  });

  it("el piso de los selectores es el mismo día que el de la lista", () => {
    // Dos formas de la misma regla: si se separan, el selector deja elegir un día que la
    // lista va a enseñar vacío. El piso se mide con una orden CERRADA, que es la que de verdad
    // se cae al cruzarlo.
    expect(retentionFloorISO(hoy)).toBe(shiftDateISO(hoy, -RETENTION_DAYS_BACK));
    expect(withinRetention(cerrada(retentionFloorISO(hoy)), hoy)).toBe(true);
    expect(withinRetention(cerrada(shiftDateISO(retentionFloorISO(hoy), -1)), hoy)).toBe(false);
  });
});

describe("las cinco pantallas preguntan lo mismo", () => {
  it("ninguna vuelve a escribir la condición a mano", () => {
    // El fallo original no fue una condición mal escrita: fueron TRES condiciones
    // distintas para la misma pregunta (`adminAllAccess`, `realRole !== "admin"`, una
    // lista `nearTerm`). Mientras la pregunta se escriba en un sitio, no puede volver.
    for (const f of [TABLERO, CHOFER, ALMACEN, MAPA, RECORRIDO]) {
      const src = sinComentarios(leer(f));
      expect(src, f).toContain("seesAllHistory(");
      expect(src, f).not.toMatch(/realRole\s*[!=]==\s*"admin"\s*&&\s*!withinRetention/);
      expect(src, f).not.toMatch(/nearTerm/);
    }
  });

  it("las tres listas filtran por la ventana con el rol REAL, no con el de «ver como»", () => {
    // Un admin previsualizando a un vendedor sigue viendo todo: era lo que ya hacía
    // almacén y ahora lo hacen las tres igual.
    // El tablero dejó de filtrar a mano (D-313): le pasa `veTodoElHistorial` a `ordenesVisibles`,
    // que es quien mira `withinRetention`. Lo que fija D-239 no cambia —la ventana se decide con el
    // rol REAL— solo que ahora se comprueba donde se decide.
    for (const f of [CHOFER, ALMACEN]) {
      const src = sinComentarios(leer(f));
      // Desde D-350 lleva también los permisos de la persona real (la capacidad `history`).
      expect(src, f).toMatch(/seesAllHistory\(realRole, me\?\.permissions\)|veTodoElHistorial/);
      expect(src, f).toContain("withinRetention(d)");
      expect(src, f).not.toMatch(/seesAllHistory\(me\?\.role\)/);
    }
    const tablero = sinComentarios(leer(TABLERO));
    expect(tablero).toContain("const veTodoElHistorial = seesAllHistory(realRole, me?.permissions);");
    expect(tablero).toContain("veTodoElHistorial,");
    expect(tablero).not.toMatch(/seesAllHistory\(me\?\.role\)/);
    expect(sinComentarios(leer("src/lib/ordenes-visibles.ts"))).toContain("withinRetention(d)");
  });

  it("el tablero ya no tiene una lista de roles «cercanos»", () => {
    const src = sinComentarios(leer(TABLERO));
    expect(src).not.toMatch(/me\?\.role === "sales" \|\| me\?\.role === "driver"/);
    // Y su bandera dice lo que hace: con logística dentro, «adminAllAccess» era falso.
    expect(src).not.toContain("adminAllAccess");
    expect(src).toContain("veTodoElHistorial");
  });

  it("los dos selectores de fecha se acotan además de la lista", () => {
    // Filtrar solo la lista dejaría un día vacío sin decir por qué; el `min` del campo
    // lo dice sin escribir un aviso.
    for (const f of [MAPA, RECORRIDO]) {
      const src = sinComentarios(leer(f));
      expect(src, f).toContain("retentionFloorISO()");
      expect(src, f).toMatch(/min=\{veTodoElHistorial \? undefined : pisoFecha\}/);
      expect(src, f).toMatch(/const fecha = veTodoElHistorial \|\| date >= pisoFecha \? date : pisoFecha;/);
      // Y el valor que se pinta es el acotado, no el del estado.
      expect(src, f).toMatch(/value=\{fecha\}/);
    }
  });

  it("el mapa y Recorrido consultan por la fecha acotada, no por la del estado", () => {
    // Si la lista se filtrara por `date` y el selector por `fecha`, un estado viejo
    // enseñaría datos de un día que el selector ya no deja elegir.
    expect(sinComentarios(leer(MAPA))).toMatch(/d\.delivery_date === fecha/);
    const track = sinComentarios(leer(RECORRIDO));
    expect(track).toMatch(/\$\{fecha\}T00:00/);
    expect(track).toMatch(/\.slice\(0, 10\) === fecha/);
  });
});

describe("las que NO llevan ventana, y por qué", () => {
  // La regla del encargo: una lista de pedidos que un no exento pueda abrir lleva la
  // ventana; un agregado o una pantalla de solo admin/logística, no. Esto fija la
  // decisión para que un cambio futuro sea deliberado.
  const SIN_VENTANA = [
    "src/app/(app)/accounts/page.tsx",
    "src/app/(app)/dashboard/page.tsx",
    "src/app/(app)/summary/page.tsx",
    "src/app/(app)/data/page.tsx",
    "src/app/(app)/audit/page.tsx",
    "src/app/(app)/routes/page.tsx",
    "src/app/(app)/my-route/page.tsx",
  ];

  for (const f of SIN_VENTANA) {
    it(`${f.replace("src/app/(app)/", "")} — sigue sin ventana, a propósito`, () => {
      expect(sinComentarios(leer(f))).not.toContain("withinRetention");
    });
  }
});

describe("ver todo el historial es también una capacidad por persona (D-350)", () => {
  it("la capacidad `history` abre el historial a cualquier rol; sin ella, solo los dos roles exentos", () => {
    expect(seesAllHistory("sales", ["history"])).toBe(true);
    expect(seesAllHistory("accounting", ["create", "history"])).toBe(true);
    expect(seesAllHistory("warehouse", ["fulfill", "history"])).toBe(true);
    expect(seesAllHistory("rol_inventado", ["create"])).toBe(false);
    expect(seesAllHistory("rol_inventado", null)).toBe(false);
    expect(seesAllHistory("rol_inventado", ["history"])).toBe(true);
    // **Esta línea es la que mide que revertir D-356 sirvió de algo.** Mientras ventas trajo
    // `history` de fábrica era `true` pasara lo que pasara, y la casilla de Usuarios no decidía nada
    // para ese rol: daba igual marcarla. Ahora un vendedor sin la casilla entra en la ventana, que es
    // justo lo que pidió el dueño, y marcársela vuelve a ser una decisión con efecto.
    expect(seesAllHistory("sales", null)).toBe(false);
    expect(seesAllHistory("logistics", [])).toBe(true);
  });
  it("admin y logística la traen de fábrica, así que nada cambia para ellos; y está en el catálogo que pinta Usuarios", async () => {
    const { CAPABILITIES, ROLE_CAPS } = await import("./constants");
    for (const r of HISTORY_EXEMPT_ROLES) expect(ROLE_CAPS[r], r).toContain("history");
    expect(CAPABILITIES.find((c) => c.key === "history")).toMatchObject({ es: "Ver todas las órdenes" });
  });
  it("«Reciente» es ayer, hoy y mañana; sin fecha entra; pasado mañana y anteayer, no", () => {
    const hoy = "2026-09-22";
    expect(withinRecent({ delivery_date: "2026-09-21" }, hoy)).toBe(true);
    expect(withinRecent({ delivery_date: "2026-09-22T10:00:00" }, hoy)).toBe(true);
    expect(withinRecent({ delivery_date: "2026-09-23" }, hoy)).toBe(true);
    expect(withinRecent({ delivery_date: null }, hoy)).toBe(true);
    expect(withinRecent({ delivery_date: "2026-09-20", stage: "delivered" }, hoy)).toBe(false);
    expect(withinRecent({ delivery_date: "2026-09-24" }, hoy)).toBe(false);
  });
  it("una VENCIDA que sigue abierta entra en «Reciente» aunque sea de hace una semana; entregada o anulada, no (D-351)", () => {
    const hoy = "2026-09-22";
    expect(withinRecent({ delivery_date: "2026-09-15", stage: "approved" }, hoy)).toBe(true);
    expect(withinRecent({ delivery_date: "2026-09-20", stage: "fulfilling" }, hoy)).toBe(true);
    expect(withinRecent({ delivery_date: "2026-09-15", stage: "delivered" }, hoy)).toBe(false);
    expect(withinRecent({ delivery_date: "2026-09-15", stage: "canceled" }, hoy)).toBe(false);
    // Mañana abierta entra por la ventana, no por vencida; pasado mañana abierta, no entra.
    expect(withinRecent({ delivery_date: "2026-09-24", stage: "approved" }, hoy)).toBe(false);
  });
  it("la pantalla de Órdenes nace en «Reciente», ofrece el chip entre «Todas» y «Hoy», y «Todas» con historial pide todo al proveedor", () => {
    const tablero = leer("src/app/(app)/page.tsx");
    expect(tablero).toContain('useState<Preset>("recent")');
    expect(tablero).toContain('{ id: "recent", en: "Recent", es: "Reciente" }');
    expect(tablero).toContain('if (preset === "recent" && !withinRecent(d)) return false;');
    expect(tablero).toContain('if (veTodoElHistorial && (q.trim() || preset === "all")) void ensureDeliveriesSince(null);');
  });
});

describe("los chips de etapa cuentan lo que el chip de fechas deja pasar (D-357)", () => {
  it("las cuentas y la lista usan el MISMO predicado del preset", () => {
    const tablero = leer("src/app/(app)/page.tsx");
    // D-384 sacó las cuentas y las filas a `filas-de-ordenes.ts`: allí se comprueba que usan el mismo
    // predicado, y aquí que la pantalla les pasa el SUYO a las dos.
    const filas = leer("src/lib/filas-de-ordenes.ts");
    expect(filas).toContain("const enElPreset = listas.visibles.filter(pasaElPreset);");
    expect(filas).toContain("const c: Record<string, number> = { [PASTILLA_TODAS]: enElPreset.length };");
    expect(filas).toContain("for (const d of enElPreset) c[d.stage] = (c[d.stage] ?? 0) + 1;");
    expect(filas).toContain("&& pasaElPreset(d));");
    expect(tablero).toContain("cuentasDeOrdenes(listas, filter, pasaElPreset,");
    expect(tablero).toContain("filasDeOrdenes(listas, view === \"board\" ? PASTILLA_TODAS : filter, pasaElPreset,");
    // El preset se escribe una vez: la lista ya no lo repite.
    expect(tablero.split('preset === "today" && !isToday(d.delivery_date)').length - 1).toBe(1);
  });
});
