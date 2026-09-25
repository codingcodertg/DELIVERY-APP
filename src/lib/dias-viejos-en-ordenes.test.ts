import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { enLaVentanaDeOrdenes, ordenesVisibles, type ContextoDeLista } from "./ordenes-visibles";
import { pastillasDeOrdenes, PASTILLA_TODAS } from "./pastillas-de-ordenes";
import { PESTANA_ATRASADAS } from "./atrasadas";
import { ROLE_INFO } from "./constants";
import { mkDelivery } from "./__fixtures";
import { seesAllHistory, shiftDateISO, todayISO, withinRetention } from "./utils";
import type { OrderTypeRules } from "./required";
import type { Delivery, NamedLocation, UserRole } from "./types";

/**
 * D-392. El dueño, 2026-09-25: *«ONLY LOGISTICS AND admin CAN SEE DAYS BEFORE YESTERDAY»*.
 *
 * En Órdenes, quien no es admin ni logística no ve **nada** con fecha anterior a ayer: ni la atrasada
 * abierta (que D-384 le daba en «Outdated»), ni lo que encuentre buscando. La pastilla «Outdated» no le
 * sale. Admin y logística siguen como en D-384.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const ids = (l: readonly Delivery[]) => l.map((d) => d.id).sort();

const HOY = todayISO();
const AYER = shiftDateISO(HOY, -1);
const ANTEAYER = shiftDateISO(HOY, -2);
const HACE_DIEZ = shiftDateISO(HOY, -10);
const MANANA = shiftDateISO(HOY, 1);

const REGLAS: OrderTypeRules = { SinDocumento: { docRef: "none" } };
const TIENDAS: NamedLocation[] = [{ name: "Norte" }] as NamedLocation[];
const YO = "u-yo";

const orden = (id: string, stage: Delivery["stage"], delivery_date: string | null) =>
  mkDelivery({ id, stage, delivery_date, order_type: "SinDocumento", store: "Norte", created_by: YO, invoice_num: "F-" + id });

/**
 * Datos que contradicen: la abierta vieja es justo la que D-374/D-384 dejaban ver (por atrasada), la
 * entregada vieja la que dejaba ver la búsqueda, y la de ayer la que tiene que seguir saliendo. Todas
 * son de quien mira y de etapas que almacén ve, para que lo único que las separe sea la fecha.
 */
const DIA = [
  orden("vieja-abierta", "ready", HACE_DIEZ),
  orden("anteayer-abierta", "approved", ANTEAYER),
  orden("vieja-entregada", "delivered", HACE_DIEZ),
  orden("ayer-abierta", "approved", AYER),
  orden("hoy", "approved", HOY),
  orden("manana", "approved", MANANA),
  orden("sin-fecha", "approved", null),
];
const VIEJAS = ["anteayer-abierta", "vieja-abierta", "vieja-entregada"];

const ctxDe = (role: UserRole, over: Partial<ContextoDeLista> = {}): ContextoDeLista => ({
  me: { id: YO, role, store: "Norte" },
  teaching: false,
  // El primer eslabón de la cadena, no un booleano inventado: `ROLE_CAPS` → `seesAllHistory`.
  veTodoElHistorial: seesAllHistory(role),
  busqueda: "",
  reglas: REGLAS,
  tiendas: TIENDAS,
  tiendasDeAlmacen: role === "warehouse" ? ["norte"] : [],
  ...over,
});

// Se recorre `ROLE_INFO`: un rol nuevo entra solo en el lado que no ve días viejos.
const TODOS = Object.keys(ROLE_INFO) as UserRole[];
const SIN_DIAS_VIEJOS = TODOS.filter((r) => !seesAllHistory(r));
const CON_DIAS_VIEJOS = TODOS.filter((r) => seesAllHistory(r));

describe("quién ve los días anteriores a ayer", () => {
  it("de fábrica, solo admin y logística", () => {
    expect([...CON_DIAS_VIEJOS].sort()).toEqual(["admin", "logistics"]);
  });
});

describe("`enLaVentanaDeOrdenes`: ayer, hoy, futuro y sin fecha; nada más", () => {
  it("anteayer no, ayer sí", () => {
    expect(enLaVentanaDeOrdenes({ delivery_date: ANTEAYER })).toBe(false);
    expect(enLaVentanaDeOrdenes({ delivery_date: AYER })).toBe(true);
  });
  it("hoy, mañana y sin fecha, sí", () => {
    for (const f of [HOY, MANANA, null]) expect(enLaVentanaDeOrdenes({ delivery_date: f }), String(f)).toBe(true);
  });
  it("con el día fijado, el suelo se mueve con él", () => {
    expect(enLaVentanaDeOrdenes({ delivery_date: "2026-09-21" }, "2026-09-23")).toBe(false);
    expect(enLaVentanaDeOrdenes({ delivery_date: "2026-09-22" }, "2026-09-23")).toBe(true);
  });
  it("y NO es `withinRetention`: esa sigue dejando pasar la atrasada abierta, para almacén y chofer", () => {
    const abiertaVieja = { delivery_date: HACE_DIEZ, stage: "ready" };
    expect(withinRetention(abiertaVieja)).toBe(true);
    expect(enLaVentanaDeOrdenes(abiertaVieja)).toBe(false);
  });
});

describe("en Órdenes, quien no es admin ni logística no ve nada anterior a ayer", () => {
  for (const role of SIN_DIAS_VIEJOS) {
    it(`${role}: ni en la lista, ni en «Outdated»`, () => {
      const { visibles, atrasadas } = ordenesVisibles(DIA, ctxDe(role));
      for (const v of VIEJAS) expect(ids(visibles), v).not.toContain(v);
      expect(ids(atrasadas)).toEqual([]);
      // Control: la de ayer y la de hoy sí le salen, así que el corte es de fecha y no de rol.
      expect(ids(visibles)).toContain("ayer-abierta");
      expect(ids(visibles)).toContain("hoy");
    });

    it(`${role}: buscando la factura de una orden de hace 10 días, no la encuentra`, () => {
      const { visibles, atrasadas } = ordenesVisibles(DIA, ctxDe(role, { busqueda: "F-vieja-abierta" }));
      expect(ids(visibles)).toEqual([]);
      expect(ids(atrasadas)).toEqual([]);
      // Control: la misma búsqueda de la de ayer sí encuentra.
      expect(ids(ordenesVisibles(DIA, ctxDe(role, { busqueda: "F-ayer-abierta" })).visibles)).toEqual(["ayer-abierta"]);
    });
  }
});

describe("admin y logística, como en D-384", () => {
  for (const role of CON_DIAS_VIEJOS) {
    it(`${role}: la abierta vieja en «Outdated», la entregada vieja en la lista`, () => {
      const { visibles, atrasadas } = ordenesVisibles(DIA, ctxDe(role));
      expect(ids(atrasadas)).toEqual(["anteayer-abierta", "vieja-abierta"]);
      expect(ids(visibles)).toContain("vieja-entregada");
    });

    it(`${role}: buscando, encuentra la de hace 10 días`, () => {
      expect(ids(ordenesVisibles(DIA, ctxDe(role, { busqueda: "F-vieja-abierta" })).visibles)).toEqual(["vieja-abierta"]);
    });
  }

  it("quien mira «como» otro rol sigue viendo como admin: cuenta el rol REAL (D-239)", () => {
    // La pantalla calcula `veTodoElHistorial` con `realRole`; aquí, un admin viendo como office.
    const { atrasadas } = ordenesVisibles(DIA, ctxDe("accounting", { veTodoElHistorial: seesAllHistory("admin") }));
    expect(ids(atrasadas)).toEqual(["anteayer-abierta", "vieja-abierta"]);
  });
});

describe("la pastilla «Outdated»", () => {
  const fila = (veDiasViejos: boolean) =>
    pastillasDeOrdenes({ etapas: ["approved", "ready"], todasAprueban: false, cuentas: {}, filtro: PASTILLA_TODAS, veDiasViejos });

  it("sale para quien ve los días viejos", () => {
    expect(fila(true).map((p) => p.key)).toContain(PESTANA_ATRASADAS);
  });

  it("y NO para los demás: no una pastilla con 0, ninguna", () => {
    expect(fila(false).map((p) => p.key)).not.toContain(PESTANA_ATRASADAS);
  });
});

describe("la pantalla usa todo esto", () => {
  const pagina = plano(leer("src/app/(app)/page.tsx"));

  it("le dice a la fila de pastillas si la persona ve días viejos, con la misma pregunta que corta la lista", () => {
    expect(pagina).toContain("veDiasViejos: veTodoElHistorial,");
    expect(pagina).toContain("const veTodoElHistorial = seesAllHistory(realRole, me?.permissions);");
  });

  it("`pasaLaVentana` corta con `enLaVentanaDeOrdenes`, navegando y buscando", () => {
    const lib = plano(leer("src/lib/ordenes-visibles.ts"));
    expect(lib).toContain("if (pendientesEntran && facturaPendiente(d, reglas)) return true; return enLaVentanaDeOrdenes(d); }");
  });
});
