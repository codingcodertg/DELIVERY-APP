import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { aprendeAfinidad, claveDeChofer, PESO_DE_HISTORIA_POR_DEFECTO, type Antecedente } from "./afinidad";
import { costeTotal, desconocidoMil } from "./evalua";
import { planifica, PARAMETROS_POR_DEFECTO, type ChoferEntrada, type Entrada, type Matriz, type OrdenEntrada } from "./index";

/**
 * D-834: el motor aprende de las rutas publicadas. El dueño, 2026-11-04: «quiero que el sistema estudie y aprenda de todas
 * las que hemos hecho para que el botón de optimizar y el autoassign funcionen como nosotros pensamos para armar las rutas».
 */
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const ant = (chofer: string, fecha: string, tienda: string, extra: Partial<Antecedente> = {}): Antecedente => ({ chofer, fecha, tienda, ...extra });

describe("aprendeAfinidad", () => {
  const historia = [
    ...Array.from({ length: 8 }, (_, i) => ant("Julio Jijon", `2026-10-${String(10 + i).padStart(2, "0")}`, "RDZ Pharr")),
    ...Array.from({ length: 8 }, (_, i) => ant("Maximo Garza", `2026-10-${String(10 + i).padStart(2, "0")}`, "RDZ Brownsville")),
    ant("Maximo Garza", "2026-10-20", "RDZ Pharr", { cuenta: "Cliente Raro" }), ant("Maximo Garza", "2026-10-21", "RDZ Pharr", { cuenta: "Cliente Raro" }),
  ];
  const choferes = ["Julio Jijon", "Maximo Garza", "Ernesto Castillo"];
  it("quien sale siempre de una tienda tiene la afinidad alta con ella; suman 1; sin mayúsculas ni espacios", () => {
    const af = aprendeAfinidad(historia, choferes, "2026-11-01", { pesoSitio: 0 });
    const a = af({ tienda: " rdz pharr " })!;
    expect(a[claveDeChofer("Julio Jijon")]).toBeGreaterThan(a[claveDeChofer("Maximo Garza")]);
    expect(a[claveDeChofer("Julio Jijon")]).toBeGreaterThan(0.6);
    expect(Object.values(a).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 6);
    // Ernesto no tiene historia: solo el suavizado, ni cero ni preferido.
    expect(a[claveDeChofer("Ernesto Castillo")]).toBeGreaterThan(0);
    expect(a[claveDeChofer("Ernesto Castillo")]).toBeLessThan(0.2);
  });
  it("el cliente que siempre lleva uno pesa: Cliente Raro sale de Pharr pero lo lleva Maximo", () => {
    const af = aprendeAfinidad(historia, choferes, "2026-11-01", { pesoSitio: 0, pesoCuenta: 1.5 });
    const conCliente = af({ tienda: "RDZ Pharr", cuenta: "cliente raro" })!, sinCliente = af({ tienda: "RDZ Pharr" })!;
    expect(conCliente["maximo garza"]).toBeGreaterThan(sinCliente["maximo garza"]);
  });
  it("solo aprende de días ANTERIORES al que se planifica; sin historia, nada", () => {
    expect(aprendeAfinidad(historia, choferes, "2026-10-01")({ tienda: "RDZ Pharr" })).toBeNull();
    expect(aprendeAfinidad([], choferes, "2026-11-01")({ tienda: "RDZ Pharr" })).toBeNull();
  });
  it("una tienda que nunca se vio no da señal", () => {
    expect(aprendeAfinidad(historia, choferes, "2026-11-01", { pesoSitio: 0 })({ tienda: "RDZ Mission" })).toBeNull();
  });
});

describe("el motor paga por llevar lo que no es de uno", () => {
  it("cuesta (1 − afinidad); sin afinidad, nada; el peso entra en el total", () => {
    expect(desconocidoMil({ nombre: "Julio Jijon" }, { afinidad: { "julio jijon": 0.8, "maximo garza": 0.2 } })).toBe(200);
    expect(desconocidoMil({ nombre: "Maximo Garza" }, { afinidad: null })).toBe(0);
    const base = { builder: 0, manejoMin: 0, millas: 0, tardeMin: 0, balanceMin: 0 };
    expect(costeTotal({ ...base, historiaMil: 1000 }, { ...PARAMETROS_POR_DEFECTO.pesos, historia: 60 })).toBe(costeTotal({ ...base, manejoMin: 60 }, PARAMETROS_POR_DEFECTO.pesos));
  });

  const matriz: Matriz = {};
  for (const a of ["0,0", "1,0", "10,0"]) { matriz[a] = {}; for (const b of ["0,0", "1,0", "10,0"]) if (a !== b) { const m = Math.abs(Number(a.split(",")[0]) - Number(b.split(",")[0])); matriz[a][b] = { minutos: m, millas: m * 0.6 }; } }
  const chofer = (id: string, base: string): ChoferEntrada => ({ id, nombre: id, base, capacidad: 20, entrada: 480, salida: 1080, vuelveABase: true });
  const orden = (afinidad?: Record<string, number>): OrdenEntrada => ({ id: "o1", codigo: "o1", entrada: "2026-01-05 0800", origen: "10,0", destino: "10,0", pallets: 1, ventana: null, servicioRecogidaMin: 5, servicioEntregaMin: 10, ...(afinidad ? { afinidad } : {}) });
  const dia = (o: OrdenEntrada): Entrada => ({ ordenes: [o], choferes: [chofer("Cerca", "1,0"), chofer("Lejos", "0,0")], matriz });
  const choferDe = (e: Entrada, historia: number) => planifica(e, { ...PARAMETROS_POR_DEFECTO, pesos: { ...PARAMETROS_POR_DEFECTO.pesos, historia } }).rutas.find((r) => r.paradas.length)?.chofer;

  it("sin historia gana el que está más cerca; con la historia de que siempre la lleva el otro, la lleva el otro", () => {
    expect(choferDe(dia(orden()), PESO_DE_HISTORIA_POR_DEFECTO)).toBe("Cerca");
    expect(choferDe(dia(orden({ cerca: 0.05, lejos: 0.95 })), PESO_DE_HISTORIA_POR_DEFECTO)).toBe("Lejos");
    // Con el peso en 0, lo aprendido no decide nada.
    expect(choferDe(dia(orden({ cerca: 0.05, lejos: 0.95 })), 0)).toBe("Cerca");
  });
});

describe("cableado", () => {
  it("la entrada del día aprende de la historia que le pasan; el servidor y «Asignar a…» se la pasan", () => {
    const e = leer("src/lib/route-plan/entrada.ts");
    expect(e).toContain("aprendeAfinidad(datos.historia.antecedentes, choferes.map((c) => c.nombre), datos.historia.fecha)");
    expect(e).toContain("afinidad: a");
    expect(leer("src/app/api/route-plan/route.ts")).toContain("historia: { fecha, antecedentes: historia }");
    expect(leer("src/app/api/route-plan/route.ts")).toContain("await leeHistoriaDeRutas(supabase as unknown as ClienteDeHistoria, fecha)");
    expect(leer("src/app/(app)/routes/page.tsx")).toContain("historia: { fecha: date, antecedentes: antecedentesDeRutas(");
  });
});
