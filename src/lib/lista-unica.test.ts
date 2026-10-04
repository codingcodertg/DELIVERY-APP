import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  cabeEnElPuesto, cambiosDeLaLista, cuentaDePallets, entregasEnOrden, escrituraDeLaLista, gruposDeMismoLugar, listaConEntregasEn, listaDelChofer,
  mueveEnLaLista, numeroDePallets, numeraLaLista, etiquetaDeLaParada, textoDeLaCuenta, textoDelExceso, tienePosicionDeRecogida, type OrdenDeLaLista, type ParadaDeLaLista,
} from "./lista-unica";

/**
 * Una sola lista por camión, sin cargas separadas (D-443). El dueño, 2026-09-28: «SI ELIMINA VIAJES». Las pruebas que su
 * especificación pide y faltaban: la cuenta con decimales parada a parada (con SU ejemplo del camión de 10 pallets), la
 * recarga a media ruta con carga a bordo, la ruta que termina en 0, el aviso en la parada exacta que se pasa, y la
 * precedencia al mover a mano.
 */

const P = (...ordenes: string[]): ParadaDeLaLista => ({ tipo: "P", ordenes, tienda: null });
const D = (orden: string): ParadaDeLaLista => ({ tipo: "D", orden });
const texto = (l: readonly ParadaDeLaLista[]) => l.map((p) => (p.tipo === "P" ? `P(${p.ordenes.join(",")})` : `D(${p.orden})`)).join(" ");

// ---------------------------------------------------------------------------------------------------------------------
// El ejemplo de la especificación, literal: camión de 10 pallets.
//   Parada  Etapa     Lugar  Cuenta          A bordo  Disponible
//   Base    Salida    Base   0.00            0.00     10.00
//   P1      Recogida  MCA    0.00 + 2.50     2.50     7.50
//   P2      Recogida  MCA    2.50 + 0.25     2.75     7.25
//   P3      Recogida  EDG    2.75 + 6.00     8.75     1.25
//   D1      Entrega   …      8.75 − 2.50     6.25     3.75
//   P4      Recogida  PHR    6.25 + 3.00     9.25     0.75
//   D3      Entrega   …      9.25 − 6.00     3.25     6.75
//   D2      Entrega   …      3.25 − 0.25     3.00     7.00
//   D4      Entrega   …      3.00 − 3.00     0.00     10.00
//   Base    Regreso   Base   0.00            0.00     10.00
const ORDENES = [
  { id: "o1", store: "MCA", est_pallets: 2.5 }, { id: "o2", store: "MCA", est_pallets: 0.25 },
  { id: "o3", store: "EDG", est_pallets: 6 }, { id: "o4", store: "PHR", est_pallets: 3 },
];
const SU_LISTA: ParadaDeLaLista[] = [
  { tipo: "P", ordenes: ["o1"], tienda: "MCA" }, { tipo: "P", ordenes: ["o2"], tienda: "MCA" }, { tipo: "P", ordenes: ["o3"], tienda: "EDG" },
  D("o1"), { tipo: "P", ordenes: ["o4"], tienda: "PHR" }, D("o3"), D("o2"), D("o4"),
];

describe("la cuenta con decimales, parada a parada: el camión de 10 pallets de la especificación", () => {
  const c = cuentaDePallets(cambiosDeLaLista(SU_LISTA, ORDENES), 10);

  it("cada fila dice lo de la parada y el total a bordo, «+2.5 = 2.5» (D-444: sin el «antes» ni «libres»)", () => {
    expect(c.paradas.map((f) => textoDeLaCuenta(f))).toEqual([
      "+2.5 = 2.5",
      "+0.25 = 2.75",
      "+6 = 8.75",
      "−2.5 = 6.25",
      "+3 = 9.25",
      "−6 = 3.25",
      "−0.25 = 3",
      "−3 = 0",
    ]);
    // Los números, no solo el texto: en centésimas, sin la cola de coma flotante (0.1 + 0.2).
    expect(c.paradas.map((f) => [f.antes, f.cambio, f.despues, f.disponible])).toEqual([
      [0, 2.5, 2.5, 7.5], [2.5, 0.25, 2.75, 7.25], [2.75, 6, 8.75, 1.25], [8.75, -2.5, 6.25, 3.75],
      [6.25, 3, 9.25, 0.75], [9.25, -6, 3.25, 6.75], [3.25, -0.25, 3, 7], [3, -3, 0, 10],
    ]);
  });
  it("la Base: sale con 0.00 a bordo y 10.00 libres, y vuelve con 0.00 y 10.00", () => {
    expect([c.salida.despues, c.salida.disponible, c.regreso.antes, c.regreso.despues, c.regreso.disponible]).toEqual([0, 10, 0, 0, 10]);
  });
  it("los totales: 8 paradas, 11.75 pallets movidos, carga máxima 9.25, ninguna se pasa, y acaba en 0", () => {
    expect(c.totales).toEqual({ paradas: 8, palletsMovidos: 11.75, cargaMaxima: 9.25, paradasConExceso: 0, finalNoCero: false });
  });
  it("con 0.1 + 0.2 la cuenta da 0.3, no 0.30000000000000004", () => {
    const x = cuentaDePallets([0.1, 0.2, -0.3], 1);
    expect([x.paradas[1].despues, x.paradas[2].despues, x.totales.finalNoCero]).toEqual([0.3, 0, false]);
  });
});

describe("el aviso EN LA PARADA EXACTA que se pasa (un cambio manual no se bloquea)", () => {
  // «En este ejemplo P4 solo es posible porque D1 va antes: si el camión intentara recoger P4 justo después de P3, la cuenta
  // sería 8.75 + 3.00 = 11.75, que pasa la capacidad por 1.75 pallets.»
  const iP4 = SU_LISTA.findIndex((p) => p.tipo === "P" && p.ordenes[0] === "o4");
  const movida = mueveEnLaLista(SU_LISTA, iP4, -1);

  it("subir P4 por encima de D1 se HACE (es a mano), y la cuenta lo dice en P4: 8.75 + 3.00 = 11.75, se pasa 1.75 de 10", () => {
    expect(movida.ok).toBe(true);
    if (!movida.ok) return;
    const c = cuentaDePallets(cambiosDeLaLista(movida.paradas, ORDENES), 10);
    const i = movida.paradas.findIndex((p) => p.tipo === "P" && p.ordenes.includes("o4"));
    expect(textoDeLaCuenta(c.paradas[i])).toBe("+3 = 11.75");
    expect(c.paradas[i].exceso).toBe(1.75);
    expect(textoDelExceso(c.paradas[i], 10, true)).toBe("⚠ se pasa 1.75 de 10");
    expect(textoDelExceso(c.paradas[i], 10, false)).toBe("⚠ over by 1.75 of 10");
    // SOLO en esa parada: en la siguiente (D1) ya baja a 9.25 y cabe.
    expect(c.paradas.map((f) => f.exceso)).toEqual(c.paradas.map((_, k) => (k === i ? 1.75 : 0)));
    expect(c.totales.paradasConExceso).toBe(1);
    expect(c.paradas.filter((f) => textoDelExceso(f, 10, true)).length).toBe(1);
  });
  it("sin exceso, no hay aviso", () => {
    expect(textoDelExceso(cuentaDePallets([2], 10).paradas[0], 10, true)).toBe("");
  });
});

describe("recarga a media ruta CON carga a bordo", () => {
  it("la P4 se recoge con 6.25 a bordo —el camión no se vació— y la ruta sigue siendo UNA lista", () => {
    const c = cuentaDePallets(cambiosDeLaLista(SU_LISTA, ORDENES), 10);
    const iP4 = SU_LISTA.findIndex((p) => p.tipo === "P" && p.ordenes[0] === "o4");
    expect(SU_LISTA.slice(0, iP4).some((p) => p.tipo === "D")).toBe(true);   // hay entregas antes
    expect(c.paradas[iP4].antes).toBe(6.25);                                  // y no llega vacío
  });
  it("guardada (154) y leída de nuevo, la lista sale IGUAL: la recogida vuelve a su sitio a media ruta", () => {
    const e = escrituraDeLaLista(SU_LISTA, 0);
    const guardadas: OrdenDeLaLista[] = ORDENES.map((o) => ({ ...o, route_seq: e.ids.indexOf(o.id), pickup_seq: e.pickupSeqById[o.id] }));
    const leida = listaDelChofer(guardadas, 10);
    // Las dos recogidas SEGUIDAS en MCA van cada una en su fila (D-444; hasta ahí, «P1·P2» en una): la lista, tal cual.
    expect(texto(leida)).toBe("P(o1) P(o2) P(o3) D(o1) P(o4) D(o3) D(o2) D(o4)");
    const n = numeraLaLista(leida);
    expect(leida.map((p) => etiquetaDeLaParada(p, n))).toEqual(["P1", "P2", "P3", "D1", "P4", "D3", "D2", "D4"]);
    // Las mismas filas de la especificación.
    expect(cuentaDePallets(cambiosDeLaLista(leida, guardadas), 10).paradas.map((f) => textoDeLaCuenta(f))).toEqual([
      "+2.5 = 2.5", "+0.25 = 2.75", "+6 = 8.75", "−2.5 = 6.25", "+3 = 9.25", "−6 = 3.25", "−0.25 = 3", "−3 = 0",
    ]);
  });
  it("SIN la 154 (no se sabe dónde iba cada recogida), la regla: bloques de lo que cabe, cada uno antes de su primera entrega", () => {
    // 6 + 6 no caben en 10: se carga a, se entrega, y se recarga b. Todo en una lista, sin «viaje 2».
    const sinColumna = [{ id: "a", store: "T", est_pallets: 6, route_seq: 0 }, { id: "b", store: "T", est_pallets: 6, route_seq: 1 }];
    expect(tienePosicionDeRecogida(sinColumna)).toBe(false);
    expect(texto(listaDelChofer(sinColumna, 10))).toBe("P(a) D(a) P(b) D(b)");
    // Si cabe todo, todas las recogidas delante, las de una tienda seguidas (cada una en su fila, D-444), en el orden de su
    // primera entrega.
    const caben = [{ id: "x", store: "B", est_pallets: 1, route_seq: 0 }, { id: "y", store: "A", est_pallets: 1, route_seq: 1 }, { id: "z", store: "B", est_pallets: 1, route_seq: 2 }];
    expect(texto(listaDelChofer(caben, 10))).toBe("P(x) P(z) P(y) D(x) D(y) D(z)");
  });
});

describe("la ruta termina en 0", () => {
  it("toda lista que sale de lo guardado vuelve a la base vacía", () => {
    const c = cuentaDePallets(cambiosDeLaLista(listaDelChofer(ORDENES.map((o, i) => ({ ...o, route_seq: i })), 10), ORDENES), 10);
    expect([c.regreso.despues, c.totales.finalNoCero]).toEqual([0, false]);
  });
  it("si no da 0 (una entrega sin su recogida, o al revés), se marca", () => {
    const c = cuentaDePallets(cambiosDeLaLista([P("o1"), P("o3"), D("o3")], ORDENES), 10);
    expect([c.regreso.despues, c.totales.finalNoCero]).toEqual([2.5, true]);
  });
});

describe("mover a mano: cualquier parada, P o D, sin romper «la recogida antes que su entrega»", () => {
  it("una P que BAJA sobre la entrega de una de sus órdenes no se mueve, y se dice cuál", () => {
    expect(mueveEnLaLista([P("a"), D("a")], 0, 1)).toEqual({ ok: false, motivo: "precedencia", orden: "a" });
    expect(mueveEnLaLista([P("a", "b"), D("b"), D("a")], 0, 1)).toEqual({ ok: false, motivo: "precedencia", orden: "b" });
  });
  it("una D que SUBE sobre su propia recogida no se mueve", () => {
    expect(mueveEnLaLista([P("a"), D("a")], 1, -1)).toEqual({ ok: false, motivo: "precedencia", orden: "a" });
  });
  it("lo demás se mueve: dos D, dos P, una D sobre la recogida de OTRA orden, una P sobre la entrega de otra", () => {
    const l = [P("a"), P("b"), D("a"), D("b")];
    const r1 = mueveEnLaLista(l, 3, -1);
    expect(r1.ok && texto(r1.paradas)).toBe("P(a) P(b) D(b) D(a)");
    const r2 = mueveEnLaLista(l, 1, -1);
    expect(r2.ok && texto(r2.paradas)).toBe("P(b) P(a) D(a) D(b)");
    const r3 = mueveEnLaLista([P("a"), D("a"), P("b"), D("b")], 2, -1);
    expect(r3.ok && texto(r3.paradas)).toBe("P(a) P(b) D(a) D(b)");
  });
  it("en el borde no hay movimiento", () => {
    expect(mueveEnLaLista([P("a"), D("a")], 0, -1)).toEqual({ ok: false, motivo: "borde" });
    expect(mueveEnLaLista([P("a"), D("a")], 1, 1)).toEqual({ ok: false, motivo: "borde" });
  });
  it("dos recogidas que quedan seguidas en la misma tienda siguen cada una en su fila (D-444), y se pueden volver a separar", () => {
    const r = mueveEnLaLista([P("a"), P("b"), P("c"), D("a"), D("b"), D("c")], 1, 1);
    expect(r.ok && texto(r.paradas)).toBe("P(a) P(c) P(b) D(a) D(b) D(c)");
    // Y dentro de las seguidas de la misma tienda, el orden también se cambia: c sube por encima de a.
    const r2 = r.ok ? mueveEnLaLista(r.paradas, 1, -1) : r;
    expect(r2.ok && texto(r2.paradas)).toBe("P(c) P(a) P(b) D(a) D(b) D(c)");
  });
  it("una parada P de varias órdenes que llegue (lista vieja) sale separada al mover, en el mismo orden", () => {
    const r = mueveEnLaLista([P("a", "b"), D("x"), D("a"), D("b")], 1, 1);
    expect(r.ok && texto(r.paradas)).toBe("P(a) P(b) D(a) D(x) D(b)");
  });
});

describe("lo que se escribe (\`escrituraDeLaLista\`) y lo que se vuelve a leer (\`listaDelChofer\`)", () => {
  it("las entregas seguidas desde \`desde\`; cada recogida entre la entrega de antes y la de después; el viaje, vacío", () => {
    const e = escrituraDeLaLista([P("a"), P("b"), D("a"), P("c"), D("b"), D("c")], 5);
    expect(e.ids).toEqual(["a", "b", "c"]);
    expect(e.pickupSeqById).toEqual({ a: 4.3333, b: 4.6667, c: 5.5 });
    expect(e.loadNoById).toEqual({ a: null, b: null, c: null });
  });
  it("ida y vuelta, en 300 listas inventadas que respetan la precedencia: se lee exactamente lo que se escribió", () => {
    let semilla = 11;
    const azar = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
    for (let n = 0; n < 300; n++) {
      const k = 1 + Math.floor(azar() * 6);
      const ids = Array.from({ length: k }, (_, i) => `o${i}`);
      // Una lista al azar: en cada paso, recoger una pendiente o entregar una recogida.
      const porRecoger = [...ids], aBordo: string[] = [], lista: ParadaDeLaLista[] = [];
      while (porRecoger.length || aBordo.length) {
        if (porRecoger.length && (!aBordo.length || azar() < 0.5)) { const id = porRecoger.splice(Math.floor(azar() * porRecoger.length), 1)[0]; lista.push(P(id)); aBordo.push(id); }
        else { const id = aBordo.splice(Math.floor(azar() * aBordo.length), 1)[0]; lista.push(D(id)); }
      }
      const e = escrituraDeLaLista(lista, 3);
      // Cada orden en su tienda propia: así ninguna recogida se junta con otra, y la lista leída es la escrita, parada a parada.
      const guardadas = ids.map((id) => ({ id, store: `T-${id}`, est_pallets: 1, route_seq: 3 + e.ids.indexOf(id), pickup_seq: e.pickupSeqById[id] }));
      expect(texto(listaDelChofer(guardadas, 100))).toBe(texto(lista));
    }
  });
  it("una recogida guardada DESPUÉS de su entrega (movida la entrega por otro camino) se adelanta justo delante de ella", () => {
    const r = listaDelChofer([{ id: "a", store: "T", route_seq: 0, pickup_seq: 1.5 }, { id: "b", store: "U", route_seq: 1, pickup_seq: -0.5 }], 10);
    expect(texto(r)).toBe("P(b) P(a) D(a) D(b)");
  });
  it("una orden sin posición guardada, en una lista que sí la tiene: su recogida por la regla (justo antes de su entrega)", () => {
    const r = listaDelChofer([{ id: "a", store: "T", route_seq: 0, pickup_seq: -0.5 }, { id: "b", store: "U", route_seq: 1, pickup_seq: null }], 10);
    expect(texto(r)).toBe("P(a) D(a) P(b) D(b)");
  });
  it("lo HISTÓRICO: una ruta guardada con viajes (\`load_no\`) y el puesto dentro de cada viaje se lee en su orden, y cada viaje viejo corta su bloque", () => {
    const vieja = [{ id: "c", store: "T", route_seq: 0, load_no: 2 }, { id: "a", store: "T", route_seq: 0, load_no: null }, { id: "b", store: "T", route_seq: 1, load_no: 1 }];
    expect(entregasEnOrden(vieja).map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(texto(listaDelChofer(vieja, 100))).toBe("P(a) P(b) D(a) D(b) P(c) D(c)");
  });
  it("¿la base guarda la recogida? Se mira si la fila TRAE la clave, aunque valga \`null\`", () => {
    expect(tienePosicionDeRecogida([{ id: "a" }, { id: "b", pickup_seq: null }])).toBe(true);
    expect(tienePosicionDeRecogida([{ id: "a" }])).toBe(false);
  });
});

describe("las entregas en otro orden (\`listaConEntregasEn\`: «Mejor lugar» y soltar en «Horario»)", () => {
  it("cada recogida sigue pegada a la entrega que la seguía; la de una orden nueva, justo antes de su entrega", () => {
    const l = [P("a"), D("a"), P("b"), D("b")];
    expect(texto(listaConEntregasEn(l, ["b", "a"], []))).toBe("P(b) D(b) P(a) D(a)");
    expect(texto(listaConEntregasEn(l, ["a", "x", "b"], []))).toBe("P(a) D(a) P(x) D(x) P(b) D(b)");
  });
  it("si así una entrega quedara antes que su recogida, esa recogida se adelanta (solo esa orden)", () => {
    // P(a,b) iba delante de D(a); b se entrega ahora primero: la recogida de b se adelanta sola, la de a se queda donde iba.
    expect(texto(listaConEntregasEn([P("a", "b"), D("a"), D("b")], ["b", "a"], []))).toBe("P(b) D(b) P(a) D(a)");
    expect(texto(listaConEntregasEn([P("a"), D("a"), P("b"), D("b")], ["b", "a"], [{ id: "a", store: "T" }, { id: "b", store: "U" }]))).toBe("P(b) D(b) P(a) D(a)");
  });
  it("una orden que sale de la lista se lleva su recogida y su entrega", () => {
    expect(texto(listaConEntregasEn([P("a", "b"), D("a"), D("b")], ["b"], []))).toBe("P(b) D(b)");
  });
  it("«Mejor lugar» solo mira los puestos donde cabe: la carga a bordo en ese punto más la nueva", () => {
    const cambios = cambiosDeLaLista(SU_LISTA, ORDENES);
    // Antes de D1 van 8.75 a bordo: una de 2 no cabe (10.75); antes de D2, 3.25: sí.
    expect(cabeEnElPuesto(SU_LISTA, cambios, 0, 2, 10)).toBe(false);
    expect(cabeEnElPuesto(SU_LISTA, cambios, 2, 2, 10)).toBe(true);
    // Justo lleno cabe (8.75 + 1.25 = 10).
    expect(cabeEnElPuesto(SU_LISTA, cambios, 0, 1.25, 10)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// La pantalla usa esto: se lee el fuente.
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");
const pagina = leer("src/app/(app)/routes/page.tsx");
const cuerpoDe = (fuente: string, desde: string, hasta: string) => {
  const i = fuente.indexOf(desde);
  expect(i, desde).toBeGreaterThan(-1);
  const j = fuente.indexOf(hasta, i + desde.length);
  expect(j, hasta).toBeGreaterThan(i);
  return fuente.slice(i, j);
};

describe("el Gestor (pestaña Rutas): una lista por chofer, con su cuenta a la vista", () => {
  const tarjeta = cuerpoDe(pagina, "{shownDrivers.map((u) => {", "{!ready && <div className=\"empty\">");
  const mueve = cuerpoDe(pagina, "const mueveParada = async (", "\n  };\n");

  it("la tabla pinta \`lectura.filas\` con la cuenta de \`cuentaDePallets\` en cada fila, y la Base al principio y al final", () => {
    expect(tarjeta).toContain("const cuenta = cuentaDePallets(lectura.filas.map((f) => f.cambio), capacity);");
    // D-459: las filas pendientes siguen siendo las de `lectura.filas`, con su índice; entre ellas se intercalan las hechas.
    expect(tarjeta).toContain("const pintadas = filasConLoHecho(lectura, stops, hechas, capacity, paradasPublicadasDe(u.key));");
    expect(tarjeta).toContain("{pintadas.map((fp) => {");
    expect(tarjeta).toContain("if (fp.hecha) return filaYaHecha(fp);");
    expect(tarjeta).toContain("const fi = fp.i;");
    expect(tarjeta).toContain("const cu = cuenta.paradas[fi];");
    expect(tarjeta).toContain("{cu.sinConteo ? \"~\" : \"\"}{textoDeLaCuenta(cu)}");
    expect(tarjeta).toContain("{cu.exceso > 0 && <div data-exceso style={{ color: \"var(--red)\", fontWeight: 700 }}>{textoDelExceso(cu, capacity, lang === \"es\")}</div>}");
    expect(tarjeta).toContain("{filaDeLaBase(u.key, \"salida\", cuenta.salida, false)}");
    expect(tarjeta).toContain("{filaDeLaBase(u.key, \"regreso\", cuenta.regreso, cuenta.totales.finalNoCero)}");
    // La celda de la cuenta va en las filas P y en las D.
    expect(tarjeta.split("{celdaDeCuenta}").length - 1).toBe(3);
  });
  it("la cabecera: paradas, pallets movidos, carga máxima contra el camión; el aviso de exceso y el de «no acaba en 0»", () => {
    expect(tarjeta).toContain("{cuenta.totales.paradas} {t(\"stops\", \"paradas\")} · {numeroDePallets(cuenta.totales.palletsMovidos)} {t(\"pallets moved\", \"pallets movidos\")} · {t(\"peak load\", \"carga máxima\")} {numeroDePallets(cuenta.totales.cargaMaxima)}/{capacity}");
    expect(tarjeta).toContain("{cuenta.totales.paradasConExceso > 0 && (");
    expect(tarjeta).toContain("{stops.length > 0 && cuenta.totales.finalNoCero && (");
  });
  it("las flechas van en las filas P y en las D, y llaman a \`mueveParada\` con el puesto de la parada en la lista", () => {
    expect(tarjeta).toContain("onClick={() => void mueveParada(u.key, f.indice!, -1)}");
    expect(tarjeta).toContain("onClick={() => void mueveParada(u.key, f.indice!, 1)}");
    expect(tarjeta.split("{flechas}{pasar}").length - 1).toBe(2);
  });
  it("\`mueveParada\` decide con \`mueveEnLaLista\`, dice por qué no mueve si rompe la precedencia, y guarda la lista entera", () => {
    expect(mueve).toContain("const r = mueveEnLaLista(lectura.paradas, indice, dir);");
    // D-456: el aviso es el mismo para las flechas y para el arrastre (`avisaDeLaPrecedencia`).
    expect(mueve).toContain("if (r.motivo === \"precedencia\") avisaDeLaPrecedencia(stops, lectura, r.orden);");
    expect(pagina).toContain("se entregaría antes de recogerla");
    expect(mueve).toContain("if (!(await guardaLaLista(laneKey, stops, r.paradas,");
  });
  it("sin la 154, las flechas de una recogida se apagan y lo dicen; las de entrega, no", () => {
    expect(tarjeta).toContain("disabled={f.indice === 0 || (f.tipo === \"P\" && !hayRecogidaGuardada)}");
    expect(mueve).toContain("if (p.tipo === \"P\" && !hayRecogidaGuardada) {");
    expect(pagina).toContain("const hayRecogidaGuardada = useMemo(() => tienePosicionDeRecogida(deliveries), [deliveries]);");
  });
  it("«Pasar a…» otro chofer en cada fila, con las órdenes de la parada", () => {
    expect(tarjeta).toContain("const ordenesDeLaFila = f.tipo === \"P\" ? f.ordenes : [f.orden];");
    expect(tarjeta).toContain("if (v) void pasaA(u.key, ordenesDeLaFila, v);");      // D-459: con la ruta de salida, para deshacer
  });
  it("el panel de choferes mide la CARGA MÁXIMA de la lista contra el camión, no la suma del día", () => {
    // **Puesto al día por D-467**: la cuenta es `cargaDelPanel` (lib/mapa-de-rutas) y la pinta `PanelDeChoferes`; las dos
    // las comparten el Gestor y «Ruta de hoy».
    expect(leer("src/lib/mapa-de-rutas.ts")).toContain("const pallets = cuentaDePallets(lectura.filas.map((f) => f.cambio), capacidad).totales.cargaMaxima;");
    expect(pagina).toContain("carga: cargaDelPanel(lecturaDe(u.key, stops), capacityFor(u.driver)),");
    expect(leer("src/components/PanelDeChoferes.tsx")).toContain("{numeroDePallets(pallets)}/{cap}");
  });
  it("sin viajes: ni «Viaje N», ni cabecera de viaje, ni «Ver un viaje», ni unir/dividir", () => {
    for (const x of ["🚚 {t(\"Truckload\", \"Viaje\")}", "data-viaje-visto", "data-unir-viajes", "data-dividir-en-dos", "data-recogida-viaje", "tripColor(", "viajeVisto"]) expect(pagina).not.toContain(x);
  });
});

describe("el plan («Armar rutas») y «Mi ruta»", () => {
  const plan = leer("src/components/RutaDelPlan.tsx");
  it("la tabla del plan lleva la cuenta FIJA en cada parada y la Base al principio y al final; sin raya ni «N viajes»", () => {
    expect(plan).toContain("{celdaDeCuenta(p.cuenta, ruta.capacidad)}");
    expect(plan).toContain("<tbody>{filaDeBase(ruta, \"salida\")}{ruta.paradas.map((p, k) => fila(p, k, ruta))}{filaDeBase(ruta, \"regreso\")}</tbody>");
    expect(plan).toContain("{f.exceso > 0 && <span data-exceso style={{ color: \"var(--red)\", fontWeight: 700, marginLeft: 6 }}>{textoDelExceso(f, capacidad, lang === \"es\")}</span>}");
    for (const x of ["otroViaje", "x.viajes", "\"trips\""]) expect(plan).not.toContain(x);
  });
  it("«Orden planeado del día» no dice «N viajes» ni raya entre viajes", () => {
    const mi = leer("src/components/MiPlanPublicado.tsx");
    for (const x of ["plan.viajes", "truckloads", "viaje !=="]) expect(mi).not.toContain(x);
  });
});

describe("los datos: se escribe la recogida y se deja de escribir el viaje", () => {
  it("los dos proveedores escriben \`pickup_seq\` SOLO si se lo dan (sin la 154, escribirlo haría fallar la escritura)", () => {
    for (const f of ["src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) expect(leer(f)).toContain("...(pickupSeqById ? { pickup_seq: pickupSeqById[");
  });
  it("guardar la lista pasa las recogidas solo con la columna, y el viaje siempre vacío", () => {
    const guarda = cuerpoDe(pagina, "const guardaLaLista = async (", "\n  };\n");
    expect(guarda).toContain("const recogidas = hayRecogidaGuardada ? e.pickupSeqById : undefined;");
    expect(guarda).toContain("await reorderStops(e.ids, e.loadNoById, undefined, desde, recogidas);");
  });
  it("asignar, quitar y pasar a otro chofer dejan el viaje vacío; nada escribe un viaje distinto de null", () => {
    expect(pagina).not.toMatch(/load_no: (load|w\.loadNoDeLaNueva|target)/);
    expect(pagina).not.toContain("nextLoadFor");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("la migración 154 (escrita, NO aplicada: la aplica el orquestador tras el merge)", () => {
  const sql = leer("supabase/migrations/154_lista_unica.sql");
  const codigo = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const funcion = (t: string) => { const i = t.indexOf("create or replace function public.publish_route_plan("); const fin = "grant execute on function public.publish_route_plan(uuid, jsonb) to authenticated;\n"; return t.slice(i, t.indexOf(fin, i) + fin.length); };

  it("una columna `pickup_seq numeric`, nula y sin defecto; `load_no` NO se borra ni se toca ningún dato", () => {
    expect(codigo).toContain("alter table public.deliveries add column if not exists pickup_seq numeric;");
    expect(codigo).not.toMatch(/drop column|update public\.deliveries set|delete from public\.deliveries/i);
    expect(codigo).not.toMatch(/create policy|drop policy|alter policy|create trigger|grant (select|insert|update|delete|all)/i);
  });
  it("`publish_route_plan` es la de la 135 letra por letra, con UNA línea más: escribe la recogida", () => {
    const de135 = funcion(leer("supabase/migrations/135_no_publicar_hoja_importada.sql"));
    const de154 = funcion(sql);
    expect(de135.length).toBeGreaterThan(3000);
    const l135 = de135.split("\n"), l154 = de154.split("\n");
    expect(l154.filter((l) => !l135.includes(l)).map((l) => l.trim())).toEqual(["pickup_seq      = (w->>'pickup_seq')::numeric,"]);
    expect(l154.filter((l) => !l.includes("pickup_seq")).join("\n")).toBe(de135);
    // Y la app manda justo esa clave (y ya no `load_no`, que la función deja en null al leerlo nulo).
    expect(leer("src/lib/route-plan/publicar.ts")).toContain("...(x.pickup_seq != null ? { pickup_seq: x.pickup_seq } : {})");
  });
  it("sin begin/commit propios, sin el número de la decisión dentro (numerar cambiaría el checksum), con reversión y su fila del registro al día", () => {
    expect(codigo).not.toMatch(/(^|;)\s*(begin|commit|rollback)\s*;/im);
    expect(sql).not.toContain("D-" + "NEXT");
    expect(sql).not.toMatch(/D-4\d\d/);
    expect(sql).toContain("--        alter table public.deliveries drop column if exists pickup_seq;");
    const [cuerpo, registro] = sql.split("-- @ledger-below");
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro.trim()).toBe(`insert into public.schema_migrations (name, checksum) values ('154_lista_unica.sql', '${sha}') on conflict (name) do nothing;`);
  });
});

// Mutante del orquestador: con `>=` en vez de `>`, ir JUSTO lleno contaba como pasarse. Justo lleno cabe.
describe("justo lleno no es pasarse (D-443)", () => {
  it("10.00 de 10: sin exceso, 0.00 libres; 10.01 de 10: se pasa 0.01", () => {
    const lleno = cuentaDePallets([7.5, 2.5, -10], 10);
    expect(lleno.paradas[1]).toMatchObject({ despues: 10, disponible: 0, exceso: 0 });
    expect(lleno.totales.paradasConExceso).toBe(0);
    const pasado = cuentaDePallets([7.5, 2.51, -10.01], 10);
    expect(pasado.paradas[1].exceso).toBeCloseTo(0.01, 5);
    expect(pasado.totales.paradasConExceso).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// D-444. El dueño, 2026-09-29, sobre la tabla del Gestor: «cada pickup tiene que tener su propio row, ahora si el sistema
// detecta que […] hay pickups en el mismo lugar seguidos, entonces los va a poner de ese color […] y si es delivery en el
// mismo lugar también, para que se mire como group. Pero no me los pongas en una sola línea».
describe("D-444: una fila por recogida, el mismo sitio como grupo, y los pallets sin decimales de más", () => {
  it("los pallets: sin decimales si no los tiene, con los suyos si sí", () => {
    expect([4, 10, 0, 3.15, 3.6, 2.75, 0.1 + 0.2, -0].map(numeroDePallets)).toEqual(["4", "10", "0", "3.15", "3.6", "2.75", "0.3", "0"]);
  });
  it("la cuenta de la fila: lo de la parada y el total a bordo; el aviso de exceso con el mismo número", () => {
    const c = cuentaDePallets([4, 6, -4, 1.5], 10);
    expect(c.paradas.map((f) => textoDeLaCuenta(f))).toEqual(["+4 = 4", "+6 = 10", "−4 = 6", "+1.5 = 7.5"]);
    const pasado = cuentaDePallets([10, 1.5], 10).paradas[1];
    expect(textoDelExceso(pasado, 10, true)).toBe("⚠ se pasa 1.5 de 10");
  });
  it("tres recogidas seguidas en la misma tienda son tres filas, un grupo; la de otra tienda va sola", () => {
    const ordenes = [
      { id: "a", store: "RDZ McAllen", est_pallets: 1, route_seq: 0 }, { id: "b", store: "RDZ McAllen", est_pallets: 1, route_seq: 1 },
      { id: "c", store: "RDZ McAllen", est_pallets: 1, route_seq: 2 }, { id: "d", store: "RDZ Pharr", est_pallets: 1, route_seq: 3 },
    ];
    const l = listaDelChofer(ordenes, 10);
    expect(texto(l)).toBe("P(a) P(b) P(c) P(d) D(a) D(b) D(c) D(d)");
    expect(gruposDeMismoLugar(l, ordenes)).toEqual([0, 0, 0, null, null, null, null, null]);
  });
  it("entregas seguidas en la MISMA dirección (sin mirar mayúsculas ni espacios) son un grupo; dos grupos seguidos, números distintos", () => {
    const ordenes = [
      { id: "a", delivery_address: "100 Main St, McAllen" }, { id: "b", delivery_address: " 100  main st, mcallen " },
      { id: "c", delivery_address: "5 Oak Ave" }, { id: "d", delivery_address: "5 Oak Ave" }, { id: "e", delivery_address: "100 Main St, McAllen" },
    ];
    const l: ParadaDeLaLista[] = [D("a"), D("b"), D("c"), D("d"), D("e")];
    expect(gruposDeMismoLugar(l, ordenes)).toEqual([0, 0, 1, 1, null]);
  });
  it("una P y una D en el mismo sitio no se agrupan, ni dos P sin tienda, ni una sola", () => {
    const l: ParadaDeLaLista[] = [{ tipo: "P", ordenes: ["b"], tienda: null }, { tipo: "P", ordenes: ["c"], tienda: null }, { tipo: "P", ordenes: ["a"], tienda: "T" }, D("a")];
    // La P de «T» y la D a «T», seguidas: no son grupo (una carga, otra descarga).
    expect(gruposDeMismoLugar(l, [{ id: "a", delivery_address: "T" }])).toEqual([null, null, null, null]);
  });
  it("el Gestor: cada fila P con su ID, su llegada (la de la medida, «P:» + su puesto) y la clase de su grupo; las D también", () => {
    const tarjeta = cuerpoDe(pagina, "{shownDrivers.map((u) => {", "{!ready && <div className=\"empty\">");
    expect(tarjeta).toContain("const grupos = gruposDeMismoLugar(lectura.paradas, stops);");
    expect(tarjeta).toContain("const etaP = f.indice != null ? routeEtas[u.key]?.[`P:${f.indice}`] : undefined;");
    // La medida usa la MISMA clave para la recogida. (**Puesto al día por D-461**: lo que la recogida tarda ya no es la recarga
    // entera por fila, sino lo de su visita a la tienda —`minutosEnCadaParada`—. La clave «P:» + su puesto no cambia.)
    // (**Puesto al día por D-467**: la medida vive en `lib/usa-medida-de-rutas`, que comparten el Gestor y «Ruta de hoy».)
    expect(leer("src/lib/usa-medida-de-rutas.ts")).toContain("if (c) puntos.push({ id: `P:${i}`, lat: c.lat, lng: c.lng, servicio: parado[i] });");
    // D-456: detrás de la clase del grupo va la raya de «aquí cae» mientras se arrastra una fila.
    expect(tarjeta).toContain("className={`${claseDeLaFilaDelPlan(\"P\")}${claseDeGrupo(f)}${claseDeSoltar}`}");
    expect(tarjeta).toContain('" row-done" : ""}${claseDeGrupo(f)}${claseDeSoltar}`}');
    // Desde D-452 la fila P dice también «carga 1 de 2» cuando la orden está partida (`etiquetaDeLaCarga`).
    expect(tarjeta).toContain("{suyas.map((x, k) => <Fragment key={x.id}>{k > 0 && \" · \"}{facturaConSuId(x)}{etiquetaDeLaCarga(x)}</Fragment>)}");
    // Sin «Fact.» en la fila P: el texto de la recogida es solo la tienda.
    expect(tarjeta).not.toContain("nombraLaOrden(deliveries, id, lang === \"es\")).join(\" · \")");
    // Sin «libres» en la tabla.
    expect(tarjeta).not.toMatch(/"libres"/);
    expect(pagina).not.toMatch(/t\("free", "libres"\)/);
  });
});
