import { describe, expect, it } from "vitest";
import {
  aBase, acomodar, armarKit, avanzarEnvio, caducanPronto, costoDeKit, crearEnvio, crearTraspaso, deBase, disponible,
  enCamino, enMano, escanear, estadoDeOrdenVenta, hojaDeSurtido, maximoArmable, mejorProveedor, porReordenar,
  precioBaseDe, precioDeLinea, recibirTraspaso, repartirCosto, sugerirTomas, tramoDeCaducidad,
} from "./inventario";
import { generarMuestraQbd } from "./muestra";
import { guardarQbd, leerGuardadoQbd, reductorQbd } from "./estado";
import type { EstadoQbd, Existencia, ReglaDePrecio } from "./tipos";

const HOY = "2026-11-20";
const juego = (e: EstadoQbd, id: string) => e.juegos.find((j) => j.id === e.fichas.find((f) => f.articuloId === id)!.juegoId);
const total = (e: EstadoQbd, id: string) => enMano(e.existencias, id) + enCamino(e, id);
const sku = (e: EstadoQbd) => (id: string) => e.articulos.find((a) => a.id === id)!.sku;

describe("unidades de medida", () => {
  const e = generarMuestraQbd(HOY);
  const j = juego(e, "i01");
  it("200 ft² de 15.5 ft²/caja son 13 cajas (se redondea hacia arriba)", () => {
    expect(aBase(200, "sq ft", j)).toBe(13);
    expect(aBase(155, "sq ft", j)).toBe(10);
    expect(aBase(1, "pallet", j)).toBe(32);
    expect(aBase(3, "piece", j)).toBe(2);
  });
  it("de cajas a ft² y precio por caja", () => {
    expect(deBase(10, "sq ft", j)).toBe(155);
    expect(precioBaseDe(4.29, "sq ft", j)).toBeCloseTo(66.495, 3);
  });
});

describe("primeras caducidades", () => {
  const x = (id: string, caduca: string | null, recibido: string, cantidad: number): Existencia => ({ id, articuloId: "a", sitioId: "s", binId: null, lote: id, caduca, recibido, cantidad, costo: 1 });
  const filas = [x("nuevo", "2027-06-01", "2026-10-01", 10), x("viejo", "2027-01-01", "2026-11-01", 5), x("caducado", "2026-11-01", "2026-01-01", 50), x("sinFecha", null, "2025-01-01", 5)];
  it("toma primero lo que caduca antes y salta lo caducado", () => {
    const s = sugerirTomas(filas, "a", "s", 12, HOY);
    expect(s.tomas).toEqual([{ existenciaId: "viejo", cantidad: 5 }, { existenciaId: "nuevo", cantidad: 7 }]);
    expect(s.falta).toBe(0);
  });
  it("dice cuánto falta", () => expect(sugerirTomas(filas, "a", "s", 30, HOY).falta).toBe(10));
  it("tramos 30/60/90", () => {
    expect(tramoDeCaducidad("2026-11-19", HOY)).toBe("expired");
    expect(tramoDeCaducidad("2026-12-20", HOY)).toBe("d30");
    expect(tramoDeCaducidad("2027-01-10", HOY)).toBe("d60");
    expect(tramoDeCaducidad("2027-02-15", HOY)).toBe("d90");
    expect(tramoDeCaducidad("2027-06-01", HOY)).toBeNull();
  });
  it("la muestra trae lotes por caducar en cada tramo", () => {
    const e = generarMuestraQbd(HOY);
    const t = new Set<string>(caducanPronto(e.existencias, HOY, 90).map((r) => r.tramo));
    for (const k of ["expired", "d30", "d60", "d90"]) expect(t.has(k)).toBe(true);
  });
});

describe("traspasos", () => {
  it("sale del origen, queda en camino y entra al andén del destino", () => {
    const e = generarMuestraQbd(HOY);
    const antes = total(e, "i15");
    const r = crearTraspaso(e, { id: "t1", numero: "TR-1", origenId: "s-cen", destinoId: "s-wes", fecha: HOY, lineas: [{ articuloId: "i15", cantidad: 20 }] }, HOY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(enMano(r.e.existencias, "i15", "s-cen")).toBe(enMano(e.existencias, "i15", "s-cen") - 20);
    expect(enCamino(r.e, "i15", "s-wes")).toBe(20);
    expect(total(r.e, "i15")).toBe(antes);
    expect(r.e.traspasos[0].lineas.every((l) => Boolean(l.lote))).toBe(true);
    const r2 = recibirTraspaso(r.e, "t1", HOY);
    expect(enCamino(r2, "i15")).toBe(0);
    expect(enMano(r2.existencias, "i15", "s-wes")).toBe(enMano(e.existencias, "i15", "s-wes") + 20);
    expect(r2.existencias.some((x) => x.sitioId === "s-wes" && x.articuloId === "i15" && x.binId === null)).toBe(true);
  });
  it("no deja mandar más de lo que hay ni al mismo sitio", () => {
    const e = generarMuestraQbd(HOY);
    expect(crearTraspaso(e, { id: "t", numero: "1", origenId: "s-wes", destinoId: "s-mca", fecha: HOY, lineas: [{ articuloId: "i01", cantidad: 1 }] }, HOY).ok).toBe(false);
    expect(crearTraspaso(e, { id: "t", numero: "1", origenId: "s-mca", destinoId: "s-mca", fecha: HOY, lineas: [{ articuloId: "i02", cantidad: 1 }] }, HOY)).toEqual({ ok: false, error: "same-site" });
  });
});

describe("ubicaciones", () => {
  it("acomodar parte del andén en un bin conserva el total", () => {
    const e = generarMuestraQbd(HOY);
    const anden = e.existencias.find((x) => x.sitioId === "s-mca" && x.binId === null)!;
    const r = acomodar(e, anden.id, "s-mca-R-03", 2, "nuevo");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(enMano(r.e.existencias, anden.articuloId, "s-mca")).toBe(enMano(e.existencias, anden.articuloId, "s-mca"));
    expect(acomodar(e, anden.id, "s-cen-A-01-1", 1, "z")).toEqual({ ok: false, error: "other-site" });
  });
});

describe("órdenes de venta y surtido", () => {
  it("la hoja reparte la loseta escasa a la orden más vieja y deja el resto pendiente", () => {
    const e = generarMuestraQbd(HOY);
    const filas = hojaDeSurtido(e, HOY).filter((f) => f.articuloId === "i01");
    expect(filas.map((f) => f.numero)).toEqual(["SO-5101", "SO-5102"]);
    expect(filas[0].pendiente).toBe(8);
    expect(filas[0].sugerido).toBe(8);
    expect(filas[1].sugerido).toBe(disponible(e, "i01", "s-mca", HOY) - 8);
    expect(filas[1].backorder).toBeGreaterThan(0);
  });
  it("surtir → empacar → enviar descuenta existencia y cuenta en la orden", () => {
    let e = generarMuestraQbd(HOY);
    const mano = enMano(e.existencias, "i01", "s-mca");
    const r = crearEnvio(e, { id: "p1", numero: "PK-1", ordenId: "so1", fecha: HOY, cantidades: { i01: 8, i15: 6 } }, HOY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    e = r.e;
    expect(disponible(e, "i01", "s-mca", HOY)).toBe(mano - 8);
    expect(avanzarEnvio(e, "p1")).toEqual({ ok: false, error: "not-scanned" });
    const s1 = escanear(e, "p1", " por-2448-cal ", 8, sku(e));
    expect(s1.error).toBeNull();
    expect(escanear(s1.e, "p1", "NOPE", 1, sku(e)).error).toBe("unknown");
    e = escanear(s1.e, "p1", "THN-MOD-50", 99, sku(e)).e;
    for (let i = 0; i < 3; i++) { const a = avanzarEnvio(e, "p1"); expect(a.ok).toBe(true); if (a.ok) e = a.e; }
    expect(e.envios[0].estado).toBe("shipped");
    expect(enMano(e.existencias, "i01", "s-mca")).toBe(mano - 8);
    expect(estadoDeOrdenVenta(e.ordenes[0], e.envios)).toBe("shipped");
  });
  it("no deja pedir de más", () => {
    const e = generarMuestraQbd(HOY);
    expect(crearEnvio(e, { id: "p", numero: "1", ordenId: "so2", fecha: HOY, cantidades: { i01: 999 } }, HOY).ok).toBe(false);
  });
});

describe("kits", () => {
  it("armar consume componentes y suma el kit con su costo", () => {
    const e = generarMuestraQbd(HOY);
    const kit = e.kits[0];
    const max = maximoArmable(e, kit, "s-mca", HOY);
    expect(max).toBeGreaterThan(0);
    const r = armarKit(e, { id: "b1", kitId: kit.id, sitioId: "s-mca", cantidad: 2, fecha: HOY }, HOY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(enMano(r.e.existencias, "i09", "s-mca")).toBe(enMano(e.existencias, "i09", "s-mca") - 12);
    expect(enMano(r.e.existencias, kit.id, "s-mca")).toBe(2);
    const costo = costoDeKit(kit, (id) => e.existencias.find((x) => x.articuloId === id)!.costo);
    expect(r.e.armados[0].costoUnitario).toBeCloseTo(costo, 1);
    expect(armarKit(e, { id: "b2", kitId: kit.id, sitioId: "s-mca", cantidad: max + 50, fecha: HOY }, HOY).ok).toBe(false);
  });
});

describe("precios", () => {
  const niveles = [{ tipo: "contractor" as const, porcentaje: -10 }];
  const reglas: ReglaDePrecio[] = [
    { id: "a", nombre: "Pallet", categoria: "tile", tipoCliente: null, desde: null, hasta: null, minimo: 30, porcentaje: -14, activa: true },
    { id: "b", nombre: "Old", categoria: null, tipoCliente: null, desde: "2026-01-01", hasta: "2026-02-01", minimo: 0, porcentaje: -50, activa: true },
  ];
  it("gana el nivel del contratista en poca cantidad", () => {
    const p = precioDeLinea({ lista: 100, categoria: "tile", tipoCliente: "contractor", cantidad: 5, fecha: HOY, niveles, reglas });
    expect(p.ganador.clave).toBe("level:contractor");
    expect(p.precio).toBe(90);
  });
  it("gana la regla de tarima con 30 cajas; la vencida no cuenta", () => {
    const p = precioDeLinea({ lista: 100, categoria: "tile", tipoCliente: "contractor", cantidad: 30, fecha: HOY, niveles, reglas });
    expect(p.ganador.clave).toBe("rule:a");
    expect(p.candidatos.some((c) => c.clave === "rule:b")).toBe(false);
  });
  it("dueño de casa sin regla: precio de lista", () => {
    expect(precioDeLinea({ lista: 100, categoria: "setting", tipoCliente: "homeowner", cantidad: 1, fecha: HOY, niveles, reglas }).ganador.clave).toBe("list");
  });
});

describe("costo de importación", () => {
  const lineas = [{ articuloId: "a", cantidad: 10, costo: 10 }, { articuloId: "b", cantidad: 30, costo: 1 }];
  it("por valor", () => {
    const r = repartirCosto(lineas, 100, "value");
    expect(r.map((x) => x.extra)).toEqual([76.92, 23.08]);
    expect(r[0].nuevoCosto).toBeCloseTo(17.692, 3);
  });
  it("por cantidad y sumando exacto", () => {
    expect(repartirCosto(lineas, 100.01, "quantity").map((x) => x.extra)).toEqual([25, 75.01]);
  });
});

describe("proveedores alternos", () => {
  const e = generarMuestraQbd(HOY);
  it("el más barato y el más rápido", () => {
    expect(mejorProveedor(e.alternos, "i01", "cost")!.dias).toBe(21);
    expect(mejorProveedor(e.alternos, "i01", "speed")!.dias).toBe(5);
  });
  it("hay artículos por reordenar y la reorden los quita", () => {
    const xs = porReordenar(e);
    expect(xs.length).toBeGreaterThan(0);
    const x = xs[0];
    const e2 = reductorQbd(e, { tipo: "reorden", reorden: { id: "r", articuloId: x.articuloId, proveedorId: "v1", cantidad: x.punto * 3, costo: 1, fecha: HOY, llega: HOY } });
    expect(porReordenar(e2).some((y) => y.articuloId === x.articuloId)).toBe(false);
  });
});

describe("reductor y guardado", () => {
  it("una acción inválida no cambia el estado", () => {
    const e = generarMuestraQbd(HOY);
    expect(reductorQbd(e, { tipo: "armar", hoy: HOY, p: { id: "x", kitId: "k1", sitioId: "s-mca", cantidad: 9999, fecha: HOY } })).toBe(e);
  });
  it("reset es determinista", () => expect(generarMuestraQbd(HOY)).toEqual(generarMuestraQbd(HOY)));
  it("sin window, leer devuelve null y guardar no truena", () => {
    expect(leerGuardadoQbd()).toBeNull();
    expect(() => guardarQbd(generarMuestraQbd(HOY))).not.toThrow();
  });
});
