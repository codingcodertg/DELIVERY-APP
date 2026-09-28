import { describe, expect, it } from "vitest";
import CASO from "./zona-recogida-caso-real.json";
import { millasEnLineaRecta, FACTOR_DE_RODEO, MILLAS_POR_HORA_ESTIMADAS } from "@/lib/route-times/proveedores";
import {
  evaluaPlan, fueraDeSuZona, PARAMETROS_POR_DEFECTO, planifica, puntasFueraDeZona, zonasReclamadas,
  type ChoferEntrada, type Entrada, type Matriz, type OrdenEntrada, type Parametros, type Plan,
} from "./index";

/**
 * La zona de la RECOGIDA también cuenta (D-NEXT, `motor-6`). El dueño, 2026-09-27, con la captura del borrador del 28:
 * *«mira esto es para mana 28 no entiendo porque la p5 y d 5 se las a julio no tiene sentido mandar a julio hasta
 * brownsville si ya te dije que ahi esta maximo  revisa ese alritmo»*.
 *
 * Hasta `motor-5` la zona de una orden era solo la ciudad de su ENTREGA: ir a recoger a la tienda de la zona de otro
 * chofer no costaba nada, y el chofer de esa zona pagaba por la entrega aunque la carga saliera de SU tienda. Ahora cada
 * orden tiene dos puntas —la ciudad de la tienda y la de la entrega— y cada punta en la zona de otro cuesta el peso.
 *
 * Un día real anonimizado (`zona-recogida-caso-real.json`) y una cuadrícula inventada para cada regla por separado.
 */

// ---- El día real ------------------------------------------------------------------------------------------------------

type Dia = { caso: string; choferes: ChoferEntrada[]; ordenes: OrdenEntrada[]; puntos: Record<string, { lat: number; lng: number }> };
const DIA = (CASO as unknown as { dias: Record<string, Dia> }).dias["2026-09-28"];

/** La matriz que usa «Planificar el día» sin Google ni OSRM (`proveedorEstimado`), sobre los pins redondeados. */
function matrizEstimada(puntos: Dia["puntos"]): Matriz {
  const m: Matriz = {};
  for (const [a, pa] of Object.entries(puntos)) {
    m[a] = {};
    for (const [b, pb] of Object.entries(puntos)) {
      if (a === b) continue;
      const millas = Math.round(millasEnLineaRecta(pa, pb) * FACTOR_DE_RODEO * 100) / 100;
      m[a][b] = { minutos: Math.round((millas / MILLAS_POR_HORA_ESTIMADAS) * 60), millas };
    }
  }
  return m;
}
/** Lo de `motor-5`: la zona, solo la de la entrega. */
const soloEntrega = (e: Entrada): Entrada => ({ ...e, ordenes: e.ordenes.map(({ zonaRecogida: _r, ...o }) => { void _r; return o; }) });
const choferDe = (plan: Plan, id: string) => plan.rutas.find((r) => r.paradas.some((p) => p.orden === id || p.orden.startsWith(`${id}#`)))?.chofer ?? null;
const con = (extra: Partial<Parametros["pesos"]> = {}): Parametros => ({ ...PARAMETROS_POR_DEFECTO, pesos: { ...PARAMETROS_POR_DEFECTO.pesos, zona: 60, ...extra } });

describe("el caso del dueño: 2026-09-28, #FT205", () => {
  const e: Entrada = { ordenes: DIA.ordenes, choferes: DIA.choferes, matriz: matrizEstimada(DIA.puntos) };
  const caso = DIA.ordenes.find((o) => o.id === DIA.caso)!;

  it("es una orden que se RECOGE en la tienda de la zona de C y se ENTREGA en una zona de A y B", () => {
    const c = (id: string) => DIA.choferes.find((x) => x.id === id)!;
    expect(c("C").zonas).toContain(caso.zonaRecogida);
    expect(c("B").zonas).toContain(caso.zona);
    expect(c("A").zonas).toContain(caso.zona);
    expect(c("C").base).toBe(caso.origen);                 // la tienda de la recogida es la base de C
  });

  it("contando solo la entrega iba con B —hasta la tienda de C y de vuelta— aunque C la hacía con las mismas millas: lo decidía la zona", () => {
    const antes = planifica(soloEntrega(e), con());
    expect(choferDe(antes, caso.id)).toBe("B");
    const alt = antes.explicaciones.find((x) => x.orden === caso.id)!.alternativas.find((a) => a.chofer === "C")!.diferencia!;
    expect(Math.abs(alt.millas)).toBeLessThan(1);           // medido: +0,33 mi con C
    expect(alt.balanceMin).toBeLessThan(0);                  // C no llevaba nada ese día: con él, el reparto mejoraba
    expect(alt.fueraDeZona).toBe(1);                          // y aun así perdía: una entrega «fuera de zona», 60
  });

  it("ahora va con C: recoger en su tienda y entregar en la zona de otro cuesta lo mismo que mandar a B hasta allí, y decide la eficiencia", () => {
    const antes = planifica(soloEntrega(e), con()), ahora = planifica(e, con());
    expect(choferDe(ahora, caso.id)).toBe("C");
    const alt = ahora.explicaciones.find((x) => x.orden === caso.id)!.alternativas.find((a) => a.chofer === "B")!.diferencia!;
    expect(alt.fueraDeZona).toBe(0);                          // con B, una punta fuera (la recogida); con C, otra (la entrega)
    // Sin dejar nada fuera, sin romper nada, sin llegar más tarde y sin más de un 1 % de millas.
    expect(ahora.sinAsignar.length).toBe(antes.sinAsignar.length);
    expect(ahora.violaciones).toEqual([]);
    expect(ahora.coste.tardeMin).toBeLessThanOrEqual(antes.coste.tardeMin);
    expect(ahora.coste.millas).toBeLessThanOrEqual(antes.coste.millas * 1.01);
  });
});

// ---- Las puntas ------------------------------------------------------------------------------------------------------

describe("cuántas puntas de una orden hace un chofer en la zona de otro", () => {
  const J = { zonas: ["Norte", "Centro"] }, M = { zonas: ["Sur"] }, E = { zonas: ["Centro", "Oeste"] };
  const recl = zonasReclamadas([J, M, E]);

  it("la entrega y la recogida cuentan por separado: 0, 1 o 2", () => {
    expect(puntasFueraDeZona(M, { zona: "Centro", zonaRecogida: "Sur" }, recl)).toBe(1);    // su tienda, la entrega de otro
    expect(puntasFueraDeZona(J, { zona: "Centro", zonaRecogida: "Sur" }, recl)).toBe(1);    // la tienda de otro, su entrega
    expect(puntasFueraDeZona(M, { zona: "Norte", zonaRecogida: "Centro" }, recl)).toBe(2);  // las dos, de otros
    expect(puntasFueraDeZona(E, { zona: "Sur", zonaRecogida: "Sur" }, recl)).toBe(2);       // la misma zona, dos veces
    expect(puntasFueraDeZona(J, { zona: "Norte", zonaRecogida: "Centro" }, recl)).toBe(0);
  });

  it("sin recogida conocida, o ya hecha, solo la entrega: lo de antes", () => {
    expect(puntasFueraDeZona(J, { zona: "Centro" }, recl)).toBe(0);
    expect(puntasFueraDeZona(M, { zona: "Centro" }, recl)).toBe(1);
    expect(puntasFueraDeZona(J, { zona: "Centro", zonaRecogida: "Sur", recogidaHecha: true }, recl)).toBe(0);
    expect(puntasFueraDeZona(E, { zona: "Sur", zonaRecogida: "Sur", recogidaHecha: true }, recl)).toBe(1);
  });

  it("una ciudad que nadie prefiere no cuenta, un chofer sin zonas nunca está fuera, y se compara sin mayúsculas", () => {
    expect(puntasFueraDeZona(J, { zona: "Pueblo", zonaRecogida: "Villa" }, recl)).toBe(0);
    expect(puntasFueraDeZona({ zonas: [] }, { zona: "Sur", zonaRecogida: "Sur" }, recl)).toBe(0);
    expect(puntasFueraDeZona({}, { zona: "Sur", zonaRecogida: "Norte" }, recl)).toBe(0);
    expect(puntasFueraDeZona(M, { zona: " centro ", zonaRecogida: "SUR" }, recl)).toBe(1);
    expect(fueraDeSuZona(J, { zona: "Centro", zonaRecogida: "Sur" }, recl)).toBe(true);
    expect(fueraDeSuZona(J, { zona: "Centro", zonaRecogida: "Norte" }, recl)).toBe(false);
  });

  it("evaluar un plan suma las puntas, y cada una cuesta el peso `zona`", () => {
    const e = entradaDe([orden("o", { origen: punto(0), destino: punto(10), zona: "Sur", zonaRecogida: "Sur" })],
      [chofer("E", { zonas: ["Este"] }), chofer("S", { zonas: ["Sur"] })]);
    const conE = evaluaPlan({ ...e, secuencias: { E: [{ orden: "o", tipo: "P" }, { orden: "o", tipo: "D" }] } });
    const conS = evaluaPlan({ ...e, secuencias: { S: [{ orden: "o", tipo: "P" }, { orden: "o", tipo: "D" }] } });
    expect(conE.coste.fueraDeZona).toBe(2);
    expect(conE.rutas.find((r) => r.chofer === "E")!.fueraDeZona).toBe(2);
    expect(conS.coste.fueraDeZona).toBe(0);
    expect(conE.coste.total - conS.coste.total).toBe(2 * 60 * 100_000);
  });
});

// ---- La cuadrícula ----------------------------------------------------------------------------------------------------

/** De «x,y» a «x',y'» se tarda |dx|+|dy| minutos, y una milla son 2 minutos (30 mph, como la estimación). */
const punto = (x: number, y = 0) => `${x},${y}`;
function matrizDe(puntos: string[]): Matriz {
  const m: Matriz = {};
  for (const a of puntos) {
    m[a] = {};
    for (const b of puntos) {
      if (a === b) continue;
      const [ax, ay] = a.split(",").map(Number), [bx, by] = b.split(",").map(Number);
      const minutos = Math.abs(ax - bx) + Math.abs(ay - by);
      m[a][b] = { minutos, millas: minutos / 2 };
    }
  }
  return m;
}
function orden(id: string, extra: Partial<OrdenEntrada> = {}): OrdenEntrada {
  return { id, codigo: id, entrada: "2026-01-05 0800", origen: punto(0), destino: punto(10), pallets: 1, ventana: null, servicioRecogidaMin: 5, servicioEntregaMin: 10, ...extra };
}
function chofer(id: string, extra: Partial<ChoferEntrada> = {}): ChoferEntrada {
  return { id, nombre: id, base: punto(0), capacidad: 20, entrada: 480, salida: 1080, vuelveABase: true, ...extra };
}
function entradaDe(ordenes: OrdenEntrada[], choferes: ChoferEntrada[]): Entrada {
  const puntos = new Set<string>();
  for (const o of ordenes) { if (o.origen) puntos.add(o.origen); if (o.destino) puntos.add(o.destino); }
  for (const c of choferes) puntos.add(c.base);
  return { ordenes, choferes, matriz: matrizDe([...puntos]) };
}

/** Dos tiendas: la de J en x=0 (zona Norte) y la de M en x=40 (zona Sur). J también prefiere el «Centro», entre las dos. */
const J = chofer("J", { base: punto(0), zonas: ["Norte", "Centro"] });
const M = chofer("M", { base: punto(40), zonas: ["Sur"] });

describe("las reglas del dueño, una por una", () => {
  it("lo que sale de la tienda de M hacia el Centro va con M, que ya está allí (antes: J iba a buscarlo)", () => {
    const e = entradaDe([orden("o", { origen: punto(40), destino: punto(10), zona: "Centro", zonaRecogida: "Sur" })], [J, M]);
    expect(choferDe(planifica(soloEntrega(e), con()), "o")).toBe("J");
    expect(choferDe(planifica(e, con()), "o")).toBe("M");
  });

  it("el Centro sigue siendo de J cuando la recogida NO es en la zona de M: M solo por emergencia", () => {
    // Desde la tienda de J hasta cerca de la de M: M pagaría dos puntas (la tienda de J y el Centro).
    const e = entradaDe([orden("o", { origen: punto(0), destino: punto(35), zona: "Centro", zonaRecogida: "Norte" })], [J, M]);
    const plan = planifica(e, con());
    expect(choferDe(plan, "o")).toBe("J");
    expect(plan.explicaciones[0].alternativas.find((a) => a.chofer === "M")!.diferencia!.fueraDeZona).toBe(2);
    // Emergencia: si J no puede (su turno ya se acabó), la lleva M.
    const sinJ = entradaDe(e.ordenes, [{ ...J, salida: 481 }, M]);
    expect(choferDe(planifica(sinJ, con()), "o")).toBe("M");
  });

  it("con una orden imposible en el día (queda fuera igual), sigue mandando la recogida: a igualdad de fuera, el plan de las dos puntas", () => {
    const e = entradaDe([
      orden("o", { origen: punto(40), destino: punto(10), zona: "Centro", zonaRecogida: "Sur" }),
      orden("imposible", { origen: punto(0), destino: punto(30), ventana: [0, 10], estrecha: true }),
    ], [J, M]);
    const plan = planifica(e, con());
    expect(plan.sinAsignar.map((s) => s.orden)).toEqual(["imposible"]);
    expect(planifica(soloEntrega(e), con()).sinAsignar.length).toBe(1);
    expect(choferDe(plan, "o")).toBe("M");
  });

  it("una entrega de una ciudad sin dueño, desde una tienda sin dueño, va por eficiencia: como sin zonas", () => {
    const e = entradaDe([orden("o", { origen: punto(20), destino: punto(30), zona: "Pueblo", zonaRecogida: "Villa" })], [J, M]);
    const plan = planifica(e, con());
    expect(choferDe(plan, "o")).toBe("M");
    expect(choferDe(plan, "o")).toBe(choferDe(planifica(e, con({ zona: 0 })), "o"));
    expect(plan.coste.fueraDeZona).toBe(0);
  });
});

describe("el umbral de D-423 con dos puntas: vuelve con quien hace MENOS puntas fuera", () => {
  /**
   * N (Norte) y S (Sur) tienen fijada cada uno una entrega con ventana dura temprana y una hora de descarga; E (Este) no
   * tiene nada. Llega un builder que se recoge en la tienda del Norte y se entrega en el Sur: con E son dos puntas fuera,
   * con N o con S, una. Con E el builder llega casi 100 minutos antes (×2), y el coste se lo da a E aunque pague dos
   * puntas; con N las millas de más son las mismas que con E. Ningún chofer lo hace con cero puntas: solo «menos puntas»
   * lo devuelve.
   */
  const dia = () => entradaDe([
    orden("fijaN", { origen: punto(0), destino: punto(20), zona: "Norte", zonaRecogida: "Norte", entrada: "2026-01-05 0600", ventana: [480, 530], estrecha: true, servicioEntregaMin: 60, choferFijado: "N" }),
    orden("fijaS", { origen: punto(0), destino: punto(20), zona: "Sur", zonaRecogida: "Norte", entrada: "2026-01-05 0601", ventana: [480, 530], estrecha: true, servicioEntregaMin: 60, choferFijado: "S" }),
    orden("builder", { origen: punto(0), destino: punto(0, 10), zona: "Sur", zonaRecogida: "Norte", builder: true, entrada: "2026-01-05 0700" }),
  ], [chofer("N", { zonas: ["Norte"] }), chofer("S", { zonas: ["Sur"] }), chofer("E", { zonas: ["Este"] })]);

  it("sin el umbral (0), el builder se queda con E, con dos puntas fuera", () => {
    const plan = planifica(dia(), con({ zonaMillas: 0 }));
    expect(choferDe(plan, "builder")).toBe("E");
  });

  it("con el umbral, vuelve con N o con S —una punta fuera— porque con ellos son menos de 5 mi de más", () => {
    const plan = planifica(dia(), con());
    expect(["N", "S"]).toContain(choferDe(plan, "builder"));
    expect(plan.violaciones).toEqual([]);
  });

  it("un chofer SIN zonas no es «de la zona» de nadie: el umbral no le pasa entregas, aunque con él no pague ninguna punta", () => {
    // Como arriba, pero S no tiene zonas, y el Sur lo prefiere W, que hoy no tiene turno. Con S, cero puntas; con N, una.
    // Vuelve con N (una punta menos que con E), no con S: S no es de ninguna zona (como en D-423).
    const e = dia();
    const sinZonasS = { ...e, choferes: [...e.choferes.map((c) => (c.id === "S" ? { ...c, zonas: undefined } : c)), chofer("W", { zonas: ["Sur"], salida: 481 })] };
    expect(choferDe(planifica(sinZonasS, con({ zonaMillas: 0 })), "builder")).toBe("E");
    expect(choferDe(planifica(sinZonasS, con()), "builder")).toBe("N");
  });
});

// ---- Días inventados: nunca queda una orden fuera por la zona de la recogida -----------------------------------------

const serie = (semilla: number) => { let s = semilla; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; };
/** Un día inventado con 2-3 choferes, cada uno con una zona de cuatro; tres tiendas, cada una en la zona de uno. */
function diaInventado(sem: number, conZonaDeEntrega = true): Entrada {
  const r = serie(sem);
  const tiendas = [punto(0, 0), punto(40, 0), punto(0, 40)];
  const DE_TIENDA = ["N", "S", "E"];
  const ZONAS = ["N", "S", "E", "O"];
  const ordenes: OrdenEntrada[] = Array.from({ length: 8 + Math.floor(r() * 14) }, (_, k) => {
    const x = Math.floor(r() * 80) - 20, y = Math.floor(r() * 80) - 20, t = Math.floor(r() * 3);
    return orden(`o${k}`, {
      entrada: `2026-01-05 ${String(600 + k).padStart(4, "0")}`, origen: tiendas[t], destino: punto(x, y),
      pallets: Math.round((0.5 + r() * 5) * 100) / 100, ventana: r() < 0.4 ? [480, 480 + 60 + Math.floor(r() * 240)] : null, estrecha: r() < 0.3,
      ...(conZonaDeEntrega ? { zona: ZONAS[(x > 20 ? 1 : 0) + (y > 20 ? 2 : 0)] } : {}), zonaRecogida: DE_TIENDA[t],
    });
  });
  const choferes = Array.from({ length: 2 + Math.floor(r() * 2) }, (_, k) => chofer(`c${k}`, {
    base: tiendas[k % 3], capacidad: 5 + Math.floor(r() * 6), salida: 480 + 240 + Math.floor(r() * 180), zonas: [ZONAS[k]],
  }));
  return entradaDe(ordenes, choferes);
}

describe("preferencia, no regla: la zona de la recogida nunca deja una orden fuera", () => {
  it("el día inventado 55: contar la recogida dejaba una orden fuera, y el motor se queda con el plan que cuenta solo la entrega", () => {
    // Medido al escribirlo: sin esta vuelta, 37 de 600 días inventados dejaban más fuera (el 55 es el primero). Con ella, ninguno.
    const e = diaInventado(55);
    expect(planifica(soloEntrega(e)).sinAsignar).toEqual([]);
    expect(planifica(e).sinAsignar).toEqual([]);
  });

  it("el día inventado 48, con zona solo en las tiendas: también se prueba sin zonas, y no queda nada fuera", () => {
    // Ninguna entrega tiene ciudad: las zonas deciden solo por la recogida. Medido: sin mirar la recogida al decidir si las
    // zonas cuentan, 85 de 600 días así dejaban más fuera.
    const e = diaInventado(48, false);
    expect(e.ordenes.every((o) => !o.zona)).toBe(true);
    expect(planifica(e).sinAsignar).toEqual([]);
  });

  it("un empate de puntas no se mueve por el umbral: el día inventado 154, la o7 se queda donde la deja el coste", () => {
    // o7 sale de la tienda de la zona «E» y va a la «N»: una punta fuera con c0 (N) y otra con c2 (E). Ninguno es «más de
    // su zona»: el umbral no la toca, y la deja el coste con c2.
    const e = diaInventado(154);
    const o7 = e.ordenes.find((o) => o.id === "o7")!;
    const recl = zonasReclamadas(e.choferes);
    const c = (id: string) => e.choferes.find((x) => x.id === id)!;
    expect(puntasFueraDeZona(c("c0"), o7, recl)).toBe(1);
    expect(puntasFueraDeZona(c("c2"), o7, recl)).toBe(1);
    expect(choferDe(planifica(e), "o7")).toBe("c2");
  });

  it("en 30 días inventados, con la recogida nunca queda fuera más que contando solo la entrega, ni que sin zonas", () => {
    for (let s = 1; s <= 30; s++) {
      const e = diaInventado(s);
      const n = planifica(e).sinAsignar.length;
      const sinZonas = { ...e, choferes: e.choferes.map(({ zonas: _z, ...c }) => { void _z; return c; }) };
      expect({ dia: s, ok: n <= planifica(soloEntrega(e)).sinAsignar.length && n <= planifica(sinZonas).sinAsignar.length }).toEqual({ dia: s, ok: true });
    }
  }, 180_000);
});
