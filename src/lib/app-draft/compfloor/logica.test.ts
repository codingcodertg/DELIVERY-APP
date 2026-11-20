import { describe, expect, it } from "vitest";
import {
  buscarLotes, cabeEnCuenta, convertir, convertirAPedido, estadoDePedido, mezclaDeLotes, pendientesDeArticulo, precioPara,
  repartirStock, reservadoPorExistencia, siguiente,
} from "./logica";
import { generarMuestra } from "./muestra";
import { reductorCf } from "./estado";
import type { Articulo, Pedido } from "./tipos";

const HOY = "2026-11-20";
const trav: Articulo = { id: "a", sku: "T", nombre: "T", sqftPorCaja: 15.5, piezasPorCaja: 8, unidadVenta: "sqft", precioCaja: 38.75, costoCaja: 20, proveedorId: "v" };

describe("unidades", () => {
  it("convierte pies² a cajas enteras hacia arriba", () => {
    const c = convertir(trav, 200, "sqft");
    expect(c.cajas).toBe(13);
    expect(c.sqft).toBe(201.5);
    expect(c.piezas).toBe(104);
    expect(c.sobraSqft).toBe(1.5);
  });
  it("no sube una caja por coma flotante", () => {
    expect(convertir(trav, 31, "sqft").cajas).toBe(2);
    expect(convertir(trav, 16, "pc").cajas).toBe(2);
  });
  it("piezas y cajas", () => {
    expect(convertir(trav, 9, "pc").cajas).toBe(2);
    expect(convertir(trav, 3, "box").sqft).toBe(46.5);
    expect(convertir(trav, 0, "box").cajas).toBe(0);
  });
});

describe("lotes", () => {
  const e = generarMuestra(HOY);
  it("muestra pone primero el lote que alcanza", () => {
    const r = buscarLotes(e, "a-trav", 30, "mca");
    expect(r[0].alcanza).toBe(true);
    expect(r[0].existencia.tienda).toBe("mca");
    expect(r.find((f) => f.existencia.id === "x-2")?.alcanza).toBe(false);
  });
  it("lo apartado por pedidos no está libre", () => {
    const res = reservadoPorExistencia(e);
    expect(res["x-5"]).toBe(18);
    expect(buscarLotes(e, "a-cala", 1).find((f) => f.existencia.id === "x-5")?.libre).toBe(0);
  });
  it("avisa al mezclar lotes del mismo artículo", () => {
    expect(mezclaDeLotes([{ articuloId: "a-trav", existenciaId: "x-1" }, { articuloId: "a-trav", existenciaId: "x-2" }], e.existencias)).toEqual(["a-trav"]);
    expect(mezclaDeLotes([{ articuloId: "a-trav", existenciaId: "x-1" }, { articuloId: "a-trav", existenciaId: "x-3" }], e.existencias)).toEqual([]);
  });
});

describe("precios", () => {
  const e = generarMuestra(HOY);
  const sub = e.articulos.find((a) => a.id === "a-sub")!;
  it("lista, % por nivel y fijo", () => {
    expect(precioPara(sub, "retail", e.niveles).precio).toBe(18.75);
    expect(precioPara(sub, "contractor", e.niveles)).toMatchObject({ precio: 16.5, regla: "level" });
    expect(precioPara(sub, "dealer", e.niveles)).toMatchObject({ precio: 14, regla: "fixed" });
  });
  it("remanente descuenta encima", () => {
    const wood = e.articulos.find((a) => a.id === "a-wood")!;
    const x = e.existencias.find((y) => y.id === "x-9")!;
    expect(precioPara(wood, null, e.niveles, x)).toMatchObject({ precio: 19.95, remanente: true });
  });
});

describe("pedidos y backorders", () => {
  it("cotización a pedido aparta lo que hay y deja el resto por surtir", () => {
    const e = generarMuestra(HOY);
    const q = e.pedidos.find((p) => p.id === "p-3")!;
    expect(estadoDePedido(q)).toBe("quote");
    const o = convertirAPedido(e, q);
    expect(o.lineas[0]).toMatchObject({ reservadas: 40 });
    expect(estadoDePedido(o)).toBe("backorder");
  });
  it("reparte stock escaso por prioridad y fecha sin mezclar lotes", () => {
    const e = generarMuestra(HOY);
    const pend = pendientesDeArticulo(e.pedidos, "a-cala");
    expect(pend.map((p) => p.pedidoId)).toEqual(["p-2", "p-1"]);
    const rep = repartirStock(30, pend, "x-6");
    expect(rep).toEqual([{ lineaId: "l-3", pedidoId: "p-2", cajas: 10 }]);
    expect(repartirStock(5, pend)).toEqual([{ lineaId: "l-3", pedidoId: "p-2", cajas: 5 }]);
  });
  it("enviar descuenta stock y cierra cuando todo salió", () => {
    let e = generarMuestra(HOY);
    e = reductorCf(e, { tipo: "aPedido", id: "p-3" });
    e = reductorCf(e, { tipo: "enviar", id: "p-3", envioId: "s1", numero: "INV-1", fecha: HOY });
    expect(e.existencias.find((x) => x.id === "x-1")!.cajas).toBe(0);
    expect(e.envios[0].total).toBe(r(40 * 38.75 + 4 * 24));
    const p = e.pedidos.find((x) => x.id === "p-3")!;
    expect(estadoDePedido(p)).toBe("backorder");
  });
  it("surtir desde la pantalla de faltantes", () => {
    let e = generarMuestra(HOY);
    e = reductorCf(e, { tipo: "surtir", existenciaId: "x-6", asignaciones: [{ pedidoId: "p-2", lineaId: "l-3", cajas: 10 }] });
    const p = e.pedidos.find((x) => x.id === "p-2") as Pedido;
    expect(p.lineas[0]).toMatchObject({ existenciaId: "x-6", reservadas: 10 });
    expect(estadoDePedido(p)).toBe("ready");
  });
});

describe("mostrador, especiales, traslados", () => {
  it("límite de crédito", () => {
    expect(cabeEnCuenta({ limite: 2500, saldo: 2300 }, 250)).toEqual({ ok: false, disponible: 200 });
    expect(cabeEnCuenta({ limite: 5000, saldo: 3200 }, 1800).ok).toBe(true);
    expect(cabeEnCuenta({ limite: null, saldo: 0 }, 1).ok).toBe(false);
  });
  it("venta a cuenta sube el saldo y baja el stock", () => {
    let e = generarMuestra(HOY);
    e = reductorCf(e, { tipo: "venta", venta: { id: "v", numero: "CS-1", clienteId: "c-2", tienda: "mca", fecha: HOY, pago: "account", lineas: [{ articuloId: "a-sub", existenciaId: "x-10", cajas: 10, precioCaja: 16.5 }], total: 165 } });
    expect(e.clientes.find((c) => c.id === "c-2")!.saldo).toBe(3365);
    expect(e.existencias.find((x) => x.id === "x-10")!.cajas).toBe(110);
  });
  it("recibir un especial aparta para el cliente y avisa", () => {
    let e = generarMuestra(HOY);
    e = reductorCf(e, { tipo: "recibirEspecial", ocId: "oc-1", existenciaId: "nx", lote: "SL9", tono: "A", bin: "A-01", alertaId: "al", fecha: HOY });
    expect(e.alertas).toHaveLength(1);
    expect(e.existencias.find((x) => x.id === "nx")).toMatchObject({ apartadoPara: "c-2", cajas: 20 });
    expect(e.pedidos.find((p) => p.id === "p-1")!.lineas[1]).toMatchObject({ existenciaId: "nx", reservadas: 20 });
    expect(buscarLotes(e, "a-slate", 1)).toHaveLength(0);
  });
  it("traslado: sale, viaja y entra", () => {
    let e = generarMuestra(HOY);
    e = reductorCf(e, { tipo: "mandarTraslado", traslado: { id: "t", numero: "TR-9", existenciaOrigenId: "x-10", articuloId: "a-sub", lote: "S10", tono: "W", desde: "mca", hacia: "bro", binDestino: "A-02", cajas: 20, fecha: HOY, recibido: false } });
    expect(e.existencias.find((x) => x.id === "x-10")!.cajas).toBe(100);
    expect(e.existencias.find((x) => x.id === "x-14")!.cajas).toBe(90);
    e = reductorCf(e, { tipo: "recibirTraslado", id: "t", nuevoId: "n" });
    expect(e.existencias.find((x) => x.id === "x-14")!.cajas).toBe(110);
    // Más de lo que hay: no hace nada.
    const antes = e;
    expect(reductorCf(e, { tipo: "mandarTraslado", traslado: { ...e.traslados[0], id: "t2", cajas: 999, recibido: false } })).toBe(antes);
  });
  it("numeración", () => {
    expect(siguiente(["SO-5001", "SO-5003", "X-9"], "SO-", 5001)).toBe("SO-5004");
  });
});

function r(v: number) { return Math.round(v * 100) / 100; }
