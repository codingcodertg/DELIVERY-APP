import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLANES, MATERIALES, REMOCION, INSTALACION, EXTRAS, PLANTILLA, datosTurnkey } from "./turnkey-datos";
import { calcular, desglosar, precioDe, porcentaje, dinero, type Entradas, type Resultado } from "./turnkey";

/**
 * Los valores de la plantilla del dueño (el Excel), tomados de la hoja con sus entradas de la plantilla: laminado 1700
 * SF de material, quitar azulejo 1600, instalar laminado 1600, quitar inodoro 1, desglose del Plan 922. Si uno de estos
 * cambia, la cuenta ya no es la de la hoja.
 */
const datos = datosTurnkey();
const r: Resultado = calcular(PLANTILLA, datos);
const plan = (nombre: string) => {
  const f = r.planes.find((p) => p.plan === nombre);
  if (!f) throw new Error(`no hay plan ${nombre}`);
  return f;
};

describe("plantilla del dueño: los valores guardados de la hoja", () => {
  it("MATERIAL: total 3953 (I2), preparación con la cola fija de 400 (I4), piso 3553 (I5), SF de piso 1700 (H5)", () => {
    expect(r.material.total).toBeCloseTo(3953, 6);
    expect(r.material.preparacion).toBeCloseTo(400, 6);
    expect(r.material.piso).toBeCloseTo(3553, 6);
    expect(r.material.sf).toBe(1700);
  });

  it("LABOR: total 4070 (O2) = removal 1600 (O4) + instalación 2240 (O5) + extras 230 (O6)", () => {
    expect(r.mano.removal.total).toBe(1600);
    expect(r.mano.instalacion.total).toBe(2240);
    expect(r.mano.extras.total).toBe(230);
    expect(r.mano.total).toBe(4070);
  });

  it("LABOR: SF de instalación 1600 (N2), días 5 (K2 = ROUNDUP(1600/450+1)), gas 200 (D24 = 0.5 × 80 × 5)", () => {
    expect(r.mano.sf).toBe(1600);
    expect(r.mano.dias).toBe(5);
    expect(r.mano.filas["ent-gas"].cantidad).toBe(400);
    expect(r.mano.filas["ent-gas"].total).toBe(200);
    expect(r.mano.removal.sf).toBe(1600);
    expect(r.mano.filas["ap-taza-quitar"].total).toBe(30);
  });

  it("FIN: precio de contado 17 369.80 (L3 = (3953 + 4070) × 2 × 1.0825)", () => {
    expect(r.contado).toBeCloseTo(17369.795, 2);
    expect(plan("Cash").precio).toBeCloseTo(17369.795, 2);
    expect(plan("Cash").porSF).toBeCloseTo(10.856121875, 6);
    expect(plan("Cash").costoPorSF).toBeCloseTo(5.841746875, 6);
    expect(plan("Cash").margen).toBeCloseTo(0.46189376443418012, 9);
    expect(plan("Cash").utilidad).toBeCloseTo(8023, 6);
    expect(plan("Cash").descuentoPct).toBeCloseTo(0.2525, 9);
    expect(plan("Cash").descuentoDolar).toBeCloseTo(5867.3889464882959, 6);
  });

  it("FIN: Credit Card = (mano + material) × 2 × 1.04 × 1.0825 (L4 = 18 064.59)", () => {
    expect(plan("Credit Card").precio).toBeCloseTo(18064.5868, 4);
    expect(plan("Credit Card").porSF).toBeCloseTo(11.29036675, 8);
    expect(plan("Credit Card").descuentoPct).toBeCloseTo(0.2226, 9);
    expect(plan("Credit Card").descuentoDolar).toBeCloseTo(5172.5971464882969, 6);
  });

  it("FIN: Plan 965 (fila 5, fijo): precio, mensual, pagos iguales, interés, total", () => {
    const f = plan("Plan 965");
    expect(f.precio).toBeCloseTo(18188.26701570681, 6);
    expect(f.negocio).toBeCloseTo(781.64077500000008, 6);
    expect(f.mensual).toBeCloseTo(500.02577404013971, 6);
    expect(f.pagosIguales).toBeCloseTo(318.29467277486918, 6);
    expect(f.plazo).toBeCloseTo(57.142857142857139, 9);
    expect(f.interes).toBeCloseTo(2180.7732151832465, 6);
    expect(f.total).toBeCloseTo(20369.040230890056, 6);
    expect(f.porSF).toBeCloseTo(11.367666884816757, 9);
    expect(f.margen).toBeCloseTo(0.44110854503464197, 9);
    expect(f.descuentoPct).toBeCloseTo(0.21727748691099469, 9);
    expect(f.descuentoDolar).toBeCloseTo(5048.9169307814882, 6);
  });

  it("FIN: Plan 922 (fila 13, diferido 12 meses): revenue 19 035.39, mensual 475.88, pagos 1586.28", () => {
    const f = plan("Plan 922");
    expect(f.precio).toBeCloseTo(19035.391780821919, 6);
    expect(f.precio.toFixed(2)).toBe("19035.39");
    expect(f.negocio).toBeCloseTo(1519.8570625, 6);
    expect(f.mensual).toBeCloseTo(475.88479452054798, 6);
    expect(f.pagosIguales).toBeCloseTo(1586.2826484018267, 6);
    expect(f.interes).toBe(0);
    expect(f.porSF).toBeCloseTo(11.8971198630137, 9);
    expect(f.costoPorSF).toBeCloseTo(6.8827448630136994, 9);
    expect(f.margen).toBeCloseTo(0.42147806004618937, 9);
    expect(f.descuentoPct).toBeCloseTo(0.18082191780821921, 9);
    expect(f.descuentoDolar).toBeCloseTo(4201.7921656663784, 6);
  });

  it("FIN: plan de 72 meses (fila 37 = referencia): precio 23 237.18, descuento 0", () => {
    const f = plan("Plan 934");
    expect(f.precio).toBeCloseTo(23237.183946488298, 6);
    expect(f.mensual).toBeCloseTo(322.99685685618732, 6);
    expect(f.pagosIguales).toBeCloseTo(322.73866592344859, 6);
    expect(f.margen).toBeCloseTo(0.34526558891454956, 9);
    expect(f.descuentoPct).toBe(0);
    expect(f.descuentoDolar).toBe(0);
  });

  it("FIN: Plan 930 y 931 (Equal No Int) y Plan 925 (diferido 24 meses)", () => {
    expect(plan("Plan 930").precio).toBeCloseTo(19885.283342873503, 6);
    expect(plan("Plan 930").pagosIguales).toBeCloseTo(795.41133371494016, 6);
    expect(plan("Plan 931").precio).toBeCloseTo(21054.296969696974, 6);
    expect(plan("Plan 931").pagosIguales).toBeCloseTo(584.84158249158259, 6);
    expect(plan("Plan 925").mensual).toBeCloseTo(497.1320835718376, 6);
  });

  it("BREAKDOWN, Plan 922: revenue 19 035.39, labor 4070, material 3953, fees & tax 2989.39, profit 8023, margin 42.15%", () => {
    const b = desglosar(r, "Plan 922");
    expect(b).not.toBeNull();
    expect(b!.ingreso.toFixed(2)).toBe("19035.39");
    expect(b!.mano).toBe(4070);
    expect(b!.material).toBeCloseTo(3953, 6);
    expect(b!.finanzas).toBeCloseTo(0.0875, 9);
    expect(b!.cargosEImpuesto).toBeCloseTo(2989.3917808219194, 6);
    expect(b!.utilidad).toBeCloseTo(8023, 6);
    expect(b!.margen).toBeCloseTo(0.42147806004618932, 9);
    expect(porcentaje(b!.margen)).toBe("42.15%");
    expect(dinero(b!.ingreso)).toBe("19,035.39");
  });

  it("el desglose de cualquier plan da la misma utilidad (la hoja la define como mano + material)", () => {
    for (const p of r.planes) {
      const b = desglosar(r, p.plan);
      expect(b!.utilidad).toBeCloseTo(8023, 6);
    }
  });
});

describe("reglas de la hoja que se conservan", () => {
  const sinEntradas: Entradas = { cantidades: {}, precios: {}, planDesglose: "Plan 922" };

  it("la fila Demo Shower se calcula pero no entra en el total de removal (D2 = SUM(D4:D9))", () => {
    const con = calcular({ ...PLANTILLA, cantidades: { ...PLANTILLA.cantidades, "demo-regadera": 2 } }, datos);
    expect(con.mano.filas["demo-regadera"].total).toBe(200);
    expect(con.mano.removal.total).toBe(1600);
    expect(con.mano.total).toBe(4070);
  });

  it("escaleras: (escalones − 2) × 0.1 × SF de instalación, nunca negativo (D27)", () => {
    const cuatro = calcular({ ...PLANTILLA, cantidades: { ...PLANTILLA.cantidades, escaleras: 4 } }, datos);
    expect(cuatro.mano.filas["escaleras"].total).toBeCloseTo(320, 9); // (4 − 2) × 0.1 × 1600
    const uno = calcular({ ...PLANTILLA, cantidades: { ...PLANTILLA.cantidades, escaleras: 1 } }, datos);
    expect(uno.mano.filas["escaleras"].total).toBe(0);
  });

  it("gas: con cero SF de laminado la hoja igual cuenta 1 día (ROUNDUP(0/450+1) = 1) y 80 de gas", () => {
    const sinLaminado = calcular({ ...PLANTILLA, cantidades: { ...PLANTILLA.cantidades, "ins-laminado": 0 } }, datos);
    expect(sinLaminado.mano.dias).toBe(1);
    expect(sinLaminado.mano.filas["ent-gas"].cantidad).toBe(80);
  });

  it("el precio de la hoja se reemplaza por el de la persona, y sin override vuelve al de la hoja", () => {
    const con = calcular({ ...PLANTILLA, precios: { laminado: 3 } }, datos);
    expect(con.material.filas["laminado"].total).toBeCloseTo(5100, 6);
    expect(precioDe({ ...PLANTILLA, precios: { laminado: -1 } }, "laminado", 2.09)).toBe(2.09);
    expect(precioDe(PLANTILLA, "laminado", 2.09)).toBe(2.09);
  });

  it("la cola de madera es un monto fijo: la cantidad no la cambia", () => {
    const f = calcular({ ...PLANTILLA, cantidades: { ...PLANTILLA.cantidades, "cola-madera": 9 } }, datos);
    expect(f.material.filas["cola-madera"].total).toBe(400);
  });

  it("sin SF de instalación no hay $/SF: el dato sale null, no Infinity", () => {
    const vacio = calcular(sinEntradas, datos);
    expect(vacio.mano.sf).toBe(0);
    expect(vacio.planes.find((p) => p.plan === "Cash")!.porSF).toBeNull();
    expect(vacio.planes.find((p) => p.plan === "Cash")!.margen).toBeNull();
  });
});

describe("catálogo y planes", () => {
  it("35 filas de FIN (contado, tarjeta y 33 planes), filas 3 a 37, sin repetir nombre", () => {
    expect(PLANES).toHaveLength(35);
    expect(PLANES.map((p) => p.fila)).toEqual(Array.from({ length: 35 }, (_, i) => i + 3));
    expect(new Set(PLANES.map((p) => p.plan)).size).toBe(35);
  });

  it("los precios por defecto son los de la hoja (lechada, cemento y backer board son fórmulas)", () => {
    const m = (id: string) => MATERIALES.find((a) => a.id === id)!.precio;
    expect(m("lechada-sin-arena")).toBeCloseTo(23.29 / 350, 12);
    expect(m("cemento")).toBeCloseTo(0.24975, 9);
    expect(m("backer-board")).toBeCloseTo(1.1666666666666667, 9);
    expect(m("plg-ceramica")).toBe(1.39);
    expect(REMOCION.find((c) => c.id === "demo-regadera")!.pago).toBe(100);
    expect(INSTALACION.find((c) => c.id === "ins-laminado")!.pago).toBe(1.4);
    expect(EXTRAS.find((c) => c.id === "ent-entrega")!.pago).toBe(80);
  });

  it("confidencialidad: turnkey.ts (lo que va al navegador) no importa el catálogo ni los planes", () => {
    const fuente = readFileSync(join(__dirname, "turnkey.ts"), "utf8");
    expect(fuente).not.toMatch(/from\s+["']\.\/turnkey-datos["']/);
    expect(fuente).not.toMatch(/\bPLANES\b|\bMATERIALES\b/);
  });
});
