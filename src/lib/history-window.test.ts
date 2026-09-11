import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_EXEMPT_ROLES, RETENTION_DAYS_BACK, retentionFloorISO, seesAllHistory, shiftDateISO, withinRetention } from "./utils";
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

  it("todos los demás roles del hub entran en la ventana", () => {
    // Se recorre `ROLE_INFO` en vez de escribir la lista: el día que se añada un rol,
    // entra en la ventana por defecto, que es el lado seguro — y si tiene que quedar
    // exento, hay que decirlo aquí a propósito. Así fue como `logistics` se quedó fuera
    // por omisión: nadie lo decidió.
    const dentro = Object.keys(ROLE_INFO).filter((r) => !seesAllHistory(r));
    expect(dentro.sort()).toEqual(["accounting", "driver", "manager", "sales", "warehouse"]);
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

describe("la ventana en sí no cambia", () => {
  const hoy = "2026-09-11";
  const ayer = shiftDateISO(hoy, -1);

  it("ayer, hoy y el futuro entran; anteayer no", () => {
    expect(withinRetention({ delivery_date: ayer }, hoy)).toBe(true);
    expect(withinRetention({ delivery_date: hoy }, hoy)).toBe(true);
    expect(withinRetention({ delivery_date: shiftDateISO(hoy, 30) }, hoy)).toBe(true);
    expect(withinRetention({ delivery_date: shiftDateISO(hoy, -2) }, hoy)).toBe(false);
  });

  it("un pedido sin fecha siempre se ve", () => {
    expect(withinRetention({ delivery_date: null }, hoy)).toBe(true);
  });

  it("el piso de los selectores es el mismo día que el de la lista", () => {
    // Dos formas de la misma regla: si se separan, el selector deja elegir un día que la
    // lista va a enseñar vacío.
    expect(retentionFloorISO(hoy)).toBe(shiftDateISO(hoy, -RETENTION_DAYS_BACK));
    expect(withinRetention({ delivery_date: retentionFloorISO(hoy) }, hoy)).toBe(true);
    expect(withinRetention({ delivery_date: shiftDateISO(retentionFloorISO(hoy), -1) }, hoy)).toBe(false);
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
    for (const f of [TABLERO, CHOFER, ALMACEN]) {
      const src = sinComentarios(leer(f));
      expect(src, f).toMatch(/seesAllHistory\(realRole\)|veTodoElHistorial/);
      expect(src, f).toContain("withinRetention(d)");
      expect(src, f).not.toMatch(/seesAllHistory\(me\?\.role\)/);
    }
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
