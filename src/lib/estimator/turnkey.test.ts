import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLANES, MATERIALES, REMOCION, INSTALACION, EXTRAS, PLANTILLA, datosTurnkey } from "./turnkey-datos";
import { calcular, desglosar, precioDe, porcentaje, dinero, type Entradas, type Resultado } from "./turnkey";

/**
 * La plantilla del dueño con los ajustes que él pidió (trabajos de piso; entrega calculada; comisión por plan). Las
 * cifras de abajo salen de esas reglas, no de la hoja guardada: la hoja tenía el monto fijo de cola (400), el gas de 80
 * por día y la comisión sobre el precio de contado. Ya no son esas.
 *
 * Entradas de la plantilla: laminado 1700 SF de material, quitar azulejo 1600, instalar laminado 1600, quitar inodoro 1,
 * plan 922 en el desglose. Sin entrega (sin dirección no hay tarifa), así que la mano de obra es 1600 + 2240 + 30.
 */
const datos = datosTurnkey();
const r: Resultado = calcular(PLANTILLA, datos);
const plan = (nombre: string) => {
  const f = r.planes.find((p) => p.plan === nombre);
  if (!f) throw new Error(`no hay plan ${nombre}`);
  return f;
};
const conCantidades = (cantidades: Record<string, number>, extra: Partial<Entradas> = {}): Entradas => ({
  ...PLANTILLA, cantidades: { ...PLANTILLA.cantidades, ...cantidades }, ...extra,
});

describe("plantilla del dueño con los ajustes", () => {
  it("MATERIAL: sin la cola fija, total 3553 (laminado 1700 × 2.09), todo es piso; SF de piso 1700", () => {
    expect(r.material.total).toBeCloseTo(3553, 6);
    expect(r.material.preparacion).toBe(0);
    expect(r.material.piso).toBeCloseTo(3553, 6);
    expect(r.material.sf).toBe(1700);
  });

  it("LABOR: 3870 = removal 1600 + instalación 2240 + extras 30 (el gas de 200 ya no existe)", () => {
    expect(r.mano.removal.total).toBe(1600);
    expect(r.mano.instalacion.total).toBe(2240);
    expect(r.mano.extras.total).toBe(30);
    expect(r.mano.total).toBe(3870);
  });

  it("LABOR: SF de instalación 1600, días 5 (ROUNDUP(1600/450+1)), sin fila de gas", () => {
    expect(r.mano.sf).toBe(1600);
    expect(r.mano.dias).toBe(5);
    expect(r.mano.filas["ent-gas"]).toBeUndefined();
    expect(r.mano.removal.sf).toBe(1600);
    expect(r.mano.filas["ap-taza-quitar"].total).toBe(30);
  });

  it("FIN: precio de contado 16 070.80 = (3870 + 3553) × 2 × 1.0825", () => {
    expect(r.contado).toBeCloseTo(16070.795, 2);
    expect(plan("Cash").precio).toBeCloseTo(16070.795, 2);
    expect(plan("Cash").porSF).toBeCloseTo(10.044246875, 6);
    expect(plan("Cash").costoPorSF).toBeCloseTo((16070.795 - 3870 - 3553) / 1600, 6);
    expect(plan("Cash").margen).toBeCloseTo(0.4618937644341801, 9);
    expect(plan("Cash").descuentoPct).toBeCloseTo(0.2525, 9);
  });

  it("FIN: Credit Card = (mano + material) × 2 × 1.04 × 1.0825", () => {
    expect(plan("Credit Card").precio).toBeCloseTo(16713.6268, 4);
    expect(plan("Credit Card").descuentoPct).toBeCloseTo(0.2226, 9);
  });

  it("FIN: Plan 965 (fijo): precio 16 828.06, pago mensual 462.63, interés 2 017.68", () => {
    const f = plan("Plan 965");
    expect(f.precio).toBeCloseTo(16828.057591623037, 6);
    expect(f.mensual).toBeCloseTo(462.63134995637006, 6);
    expect(f.pagosIguales).toBeCloseTo(294.4910078534032, 6);
    expect(f.plazo).toBeCloseTo(57.142857142857139, 9);
    expect(f.interes).toBeCloseTo(2017.6841052356024, 6);
    expect(f.total).toBeCloseTo(18845.74169685864, 6);
    expect(f.porSF).toBeCloseTo(10.517535994764398, 9);
    expect(f.margen).toBeCloseTo(0.441108545034642, 9);
    expect(f.descuentoPct).toBeCloseTo(0.2172774869109947, 9);
    expect(f.descuentoDolar).toBeCloseTo(4671.333712724787, 6);
  });

  it("FIN: Plan 922 (diferido 12 meses): precio 17 611.83, mensual 440.30, pagos 1 467.65", () => {
    const f = plan("Plan 922");
    expect(f.precio).toBeCloseTo(17611.830136986304, 6);
    expect(f.precio.toFixed(2)).toBe("17611.83");
    expect(f.mensual).toBeCloseTo(440.2957534246576, 6);
    expect(f.pagosIguales).toBeCloseTo(1467.6525114155254, 6);
    expect(f.interes).toBe(0);
    expect(f.porSF).toBeCloseTo(11.00739383561644, 9);
    expect(f.costoPorSF).toBeCloseTo(6.36801883561644, 9);
    expect(f.margen).toBeCloseTo(0.4214780600461893, 9);
    expect(f.descuentoPct).toBeCloseTo(0.180821917808219, 9);
    expect(f.descuentoDolar).toBeCloseTo(3887.5611673615203, 6);
  });

  it("FIN: plan de 72 meses (fila 37 = referencia): precio 21 499.39, descuento 0", () => {
    const f = plan("Plan 934");
    expect(f.precio).toBeCloseTo(21499.391304347824, 6);
    expect(f.mensual).toBeCloseTo(298.84153913043474, 6);
    expect(f.margen).toBeCloseTo(0.3452655889145496, 9);
    expect(f.descuentoPct).toBe(0);
    expect(f.descuentoDolar).toBe(0);
  });

  it("FIN: Plan 930 y 931 (Equal No Int) y Plan 925 (diferido 24 meses)", () => {
    expect(plan("Plan 930").precio).toBeCloseTo(18398.162564396112, 6);
    expect(plan("Plan 930").pagosIguales).toBeCloseTo(735.9265025758446, 6);
    expect(plan("Plan 931").precio).toBeCloseTo(19479.751515151518, 6);
    expect(plan("Plan 931").pagosIguales).toBeCloseTo(541.1042087542088, 6);
    expect(plan("Plan 925").mensual).toBeCloseTo(459.95406410990284, 6);
  });

  it("COMISIÓN DEL FINANCIAMIENTO: precio del plan sin impuesto × su tasa (no el precio de contado)", () => {
    // Plan 922: 17 611.83 / 1.0825 × 0.0875 = 1 423.59. Plan 965: 16 828.06 / 1.0825 × 0.045 = 699.55.
    expect(plan("Plan 922").negocio).toBeCloseTo(1423.5890410958905, 6);
    expect(plan("Plan 965").negocio).toBeCloseTo(699.5497382198953, 6);
    expect(plan("Plan 934").negocio).toBeCloseTo(5014.869565217391, 6);
    // Contado y tarjeta no tienen tasa de descuento: su comisión es 0.
    expect(plan("Cash").negocio).toBe(0);
    expect(plan("Credit Card").negocio).toBe(0);
  });

  it("BREAKDOWN, Plan 922: revenue 17 611.83, labor 3870, material 3553, fees & tax 2765.83, profit 7423, margin 42.15%", () => {
    const b = desglosar(r, "Plan 922");
    expect(b).not.toBeNull();
    expect(b!.ingreso.toFixed(2)).toBe("17611.83");
    expect(b!.mano).toBe(3870);
    expect(b!.material).toBeCloseTo(3553, 6);
    expect(b!.finanzas).toBeCloseTo(0.0875, 9);
    expect(b!.cargosEImpuesto).toBeCloseTo(2765.830136986304, 6);
    expect(b!.utilidad).toBeCloseTo(7423, 6);
    expect(b!.margen).toBeCloseTo(0.4214780600461893, 9);
    expect(porcentaje(b!.margen)).toBe("42.15%");
    expect(dinero(b!.ingreso)).toBe("17,611.83");
  });

  it("el desglose de cualquier plan da la misma utilidad (la hoja la define como mano + material)", () => {
    for (const p of r.planes) {
      const b = desglosar(r, p.plan);
      expect(b!.utilidad).toBeCloseTo(7423, 6);
    }
  });
});

describe("reglas nuevas", () => {
  const sinEntradas: Entradas = { cantidades: {}, precios: {}, planDesglose: "Plan 922" };

  it("la demo de regadera ($100 cada una) entra en el total de remoción; no cuenta como SF", () => {
    const con = calcular(conCantidades({ "demo-regadera": 2 }), datos);
    expect(con.mano.filas["demo-regadera"].total).toBe(200);
    expect(con.mano.removal.total).toBe(1800);
    expect(con.mano.total).toBe(4070);
    expect(con.mano.removal.sf).toBe(1600);
  });

  it("escaleras: (tramos − 2) × 0.1 × SF de instalación, nunca negativo", () => {
    const cuatro = calcular(conCantidades({ escaleras: 4 }), datos);
    expect(cuatro.mano.filas["escaleras"].total).toBeCloseTo(320, 9); // (4 − 2) × 0.1 × 1600
    const uno = calcular(conCantidades({ escaleras: 1 }), datos);
    expect(uno.mano.filas["escaleras"].total).toBe(0);
  });

  it("entrega: el cargo de la calculadora es la fila de entrega, con cantidad 1", () => {
    const f = calcular(conCantidades({}, { entrega: { cargo: 90, minutos: 20 } }), datos);
    expect(f.mano.filas["ent-entrega"].precio).toBe(90);
    expect(f.mano.filas["ent-entrega"].total).toBe(90);
    expect(f.mano.filas["ent-viajes"].total).toBe(0); // 20 min: no pasa de 45
    expect(f.mano.extras.total).toBe(120);
  });

  it("viajes extra: manejo de más de 45 min de ida → (días − 1) × ½ entrega", () => {
    // 5 días de laminado; 90 de entrega → 4 × 45 = 180.
    const f = calcular(conCantidades({}, { entrega: { cargo: 90, minutos: 50 } }), datos);
    expect(f.mano.dias).toBe(5);
    expect(f.mano.filas["ent-viajes"].precio).toBe(45);
    expect(f.mano.filas["ent-viajes"].cantidad).toBe(4);
    expect(f.mano.filas["ent-viajes"].total).toBe(180);
    expect(f.mano.extras.total).toBe(30 + 90 + 180);
  });

  it("viajes extra: exactamente 45 min no pasa el límite; sin minutos no hay viajes; 1 día no tiene viajes", () => {
    const a = calcular(conCantidades({}, { entrega: { cargo: 90, minutos: 45 } }), datos);
    expect(a.mano.filas["ent-viajes"].total).toBe(0);
    const b = calcular(conCantidades({}, { entrega: { cargo: 90, minutos: null } }), datos);
    expect(b.mano.filas["ent-viajes"].total).toBe(0);
    const c = calcular(conCantidades({ "ins-laminado": 0 }, { entrega: { cargo: 90, minutos: 60 } }), datos);
    expect(c.mano.dias).toBe(1);
    expect(c.mano.filas["ent-viajes"].total).toBe(0);
  });

  it("la entrega y los viajes no se pueden cambiar a mano: el precio escrito no las mueve", () => {
    const f = calcular(conCantidades({}, { entrega: { cargo: 90, minutos: 50 } }), datos);
    const con = calcular(conCantidades({}, { entrega: { cargo: 90, minutos: 50 }, precios: { "ent-entrega": 1, "ent-viajes": 1 } }), datos);
    expect(con.mano.filas["ent-entrega"].total).toBe(f.mano.filas["ent-entrega"].total);
    expect(con.mano.filas["ent-viajes"].total).toBe(f.mano.filas["ent-viajes"].total);
  });

  it("escalones, decoración y pies lineales no suman SF de instalación ni de piso", () => {
    const f = calcular(conCantidades({
      "ins-escalon-laminado": 3, "ins-alfombras-azulejo": 40, "ins-zoclo-azulejo": 20, "ins-escalon-alfombra": 2, deco: 10,
    }), datos);
    expect(f.mano.sf).toBe(1600);
    expect(f.material.sf).toBe(1700);
    // Pero sí cobran: escalón 3 × 35, alfombra 40 × 1.5, zoclo 20 × 1, escalón alfombra 2 × 2.
    expect(f.mano.filas["ins-escalon-laminado"].total).toBe(105);
    expect(f.mano.filas["ins-alfombras-azulejo"].total).toBe(60);
    expect(f.mano.filas["ins-zoclo-azulejo"].total).toBe(20);
    expect(f.mano.filas["ins-escalon-alfombra"].total).toBe(4);
    // Deco: 10 × $15 de material, pero no suma a material.sf.
    expect(f.material.filas["deco"].total).toBe(150);
  });

  it("el precio de la hoja se reemplaza por el de la persona, y sin override vuelve al de defecto", () => {
    const con = calcular({ ...PLANTILLA, precios: { laminado: 3 } }, datos);
    expect(con.material.filas["laminado"].total).toBeCloseTo(5100, 6);
    expect(precioDe({ ...PLANTILLA, precios: { laminado: -1 } }, "laminado", 2.09)).toBe(2.09);
    expect(precioDe(PLANTILLA, "laminado", 2.09)).toBe(2.09);
  });

  it("la cola de madera es precio × cantidad, como el resto (sin monto fijo)", () => {
    const sin = calcular({ ...PLANTILLA, cantidades: { ...PLANTILLA.cantidades, "cola-madera": 9 } }, datos);
    expect(sin.material.filas["cola-madera"].total).toBe(0); // sin precio por defecto
    const con = calcular(conCantidades({ "cola-madera": 9 }, { precios: { "cola-madera": 10 } }), datos);
    expect(con.material.filas["cola-madera"].total).toBe(90);
    expect(con.material.preparacion).toBe(90);
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

  it("solo piso: no hay filas de pared ni de regadera en el catálogo (charola, backer, pared, Recessit, repisa)", () => {
    const ids = [...MATERIALES, ...REMOCION, ...INSTALACION, ...EXTRAS].map((c) => c.id);
    for (const viejo of ["charola-regadera", "backer-board", "ins-pared-azulejo", "ins-backer", "ins-charola", "ins-nicho", "ins-ledge", "ent-gas"]) {
      expect(ids).not.toContain(viejo);
    }
  });

  it("los precios por defecto son los de la hoja (lechada, cemento son fórmulas); la cola de madera es 0", () => {
    const m = (id: string) => MATERIALES.find((a) => a.id === id)!.precio;
    expect(m("lechada-sin-arena")).toBeCloseTo(23.29 / 350, 12);
    expect(m("cemento")).toBeCloseTo(0.24975, 9);
    expect(m("plg-ceramica")).toBe(1.39);
    expect(m("cola-madera")).toBe(0);
    expect(REMOCION.find((c) => c.id === "demo-regadera")!.pago).toBe(100);
    expect(INSTALACION.find((c) => c.id === "ins-laminado")!.pago).toBe(1.4);
    expect(EXTRAS.find((c) => c.id === "ent-entrega")!.formula).toBe("entrega");
    expect(EXTRAS.find((c) => c.id === "ent-viajes")!.formula).toBe("viajes");
  });

  it("basura: recolección y tiro quedan en 0, editables, con la pista «Not normally charged»", () => {
    for (const id of ["lim-recoleccion", "lim-tiro"]) {
      const c = EXTRAS.find((x) => x.id === id)!;
      expect(c.pago).toBe(0);
      expect(c.pista).toEqual({ en: "Not normally charged", es: "Normalmente no se cobra" });
      expect(c.nota).toBeUndefined();
    }
  });

  it("confidencialidad: turnkey.ts (lo que va al navegador) no importa el catálogo ni los planes", () => {
    const fuente = readFileSync(join(__dirname, "turnkey.ts"), "utf8");
    expect(fuente).not.toMatch(/from\s+["']\.\/turnkey-datos["']/);
    expect(fuente).not.toMatch(/\bPLANES\b|\bMATERIALES\b/);
  });
});
