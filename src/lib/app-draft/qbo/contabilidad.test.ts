import { describe, expect, it } from "vitest";
import {
  CTA, antiguedadPorCobrar, antiguedadPorPagar, asientoManualBalanceado, balanceGeneral, cuentaDeConciliacion,
  documentosDescuadrados, estadoDeFactura, estadoDeOrden, estadoDeResultados, facturasConSaldo, libroMayor,
  registroDelBanco, repartePago, saldoDeCliente, saldoDeCuenta, saldoDeFactura, saldoDeProveedor, saldoSegunBanco,
  sumaDias, totalDe, tramoDe, validaAplicacion, reglaQueAplica, candidatosDeEnlace, r2,
} from "./contabilidad";
import { generarMuestra } from "./muestra";
import { reductorQbo, siguienteNumero } from "./estado";
import type { EstadoQbo, Factura } from "./tipos";

const HOY = "2026-11-19";
const cuenta = (e: EstadoQbo, id: string) => e.cuentas.find((c) => c.id === id)!;
const suma = (xs: number[]) => r2(xs.reduce((a, b) => a + b, 0));

describe("totales de factura", () => {
  it("impuesto 8.25 % y 6.25 % en Mission", () => {
    const lineas = [{ articuloId: "i01", descripcion: "", cantidad: 100, precio: 4.29 }];
    expect(totalDe(lineas, 8.25)).toBe(464.39);
    expect(totalDe(lineas, 6.25)).toBe(455.81);
  });
  it("la muestra usa 6.25 % para Mission y 8.25 % en las demás", () => {
    const e = generarMuestra(HOY);
    for (const f of e.facturas) expect(f.tasa).toBe(f.tienda === "RDZ Mission" ? 6.25 : 8.25);
  });
});

describe("la muestra", () => {
  const e = generarMuestra(HOY);
  it("tiene el tamaño pedido", () => {
    expect(e.clientes).toHaveLength(15);
    expect(e.proveedores).toHaveLength(8);
    expect(e.articulos).toHaveLength(30);
    expect(e.facturas).toHaveLength(40);
  });
  it("es determinista", () => {
    expect(JSON.stringify(generarMuestra(HOY))).toBe(JSON.stringify(e));
  });
  it("mezcla estados", () => {
    const estados = new Set(facturasConSaldo(e, HOY).map((x) => x.estado));
    for (const s of ["draft", "paid", "overdue"]) expect(estados).toContain(s);
  });
  it("cada documento del libro cuadra, y el libro entero también", () => {
    const libro = libroMayor(e);
    expect(documentosDescuadrados(libro)).toEqual([]);
    expect(suma(libro.map((r) => r.debe))).toBe(suma(libro.map((r) => r.haber)));
  });
  it("la suma de saldos de clientes es la cuenta por cobrar; la de proveedores, por pagar", () => {
    const libro = libroMayor(e);
    expect(suma(e.clientes.map((c) => saldoDeCliente(e, c.id)))).toBe(saldoDeCuenta(cuenta(e, CTA.porCobrar), libro));
    expect(suma(e.proveedores.map((p) => saldoDeProveedor(e, p.id)))).toBe(saldoDeCuenta(cuenta(e, CTA.porPagar), libro));
  });
  it("la antigüedad suma lo mismo que la cuenta por cobrar y por pagar", () => {
    const libro = libroMayor(e);
    expect(suma(antiguedadPorCobrar(e, HOY).map((f) => f.total))).toBe(saldoDeCuenta(cuenta(e, CTA.porCobrar), libro));
    expect(suma(antiguedadPorPagar(e, HOY).map((f) => f.total))).toBe(saldoDeCuenta(cuenta(e, CTA.porPagar), libro));
  });
  it("el balance cuadra: activos = pasivos + capital (con la utilidad)", () => {
    const b = balanceGeneral(e, libroMayor(e), HOY);
    expect(b.cuadra).toBe(true);
  });
});

describe("estado de una factura", () => {
  const f: Factura = { id: "x", numero: "1", clienteId: "c", tienda: "RDZ McAllen", fecha: "2026-11-01", vence: "2026-11-15", lineas: [{ articuloId: "i01", descripcion: "", cantidad: 10, precio: 10 }], tasa: 0, borrador: false, enviada: true, nota: "" };
  it("borrador, pagada, vencida, a medias, enviada", () => {
    expect(estadoDeFactura({ ...f, borrador: true }, 100, 100, HOY)).toBe("draft");
    expect(estadoDeFactura(f, 0, 100, HOY)).toBe("paid");
    expect(estadoDeFactura(f, 50, 100, HOY)).toBe("overdue");
    expect(estadoDeFactura({ ...f, vence: "2026-12-01" }, 50, 100, HOY)).toBe("partial");
    expect(estadoDeFactura({ ...f, vence: "2026-12-01" }, 100, 100, HOY)).toBe("sent");
  });
  it("pagos y notas restan del saldo", () => {
    const s = saldoDeFactura(f, [{ id: "p", numero: "", clienteId: "c", fecha: HOY, monto: 70, metodo: "check", referencia: "", cuentaBanco: CTA.banco, aplicado: [{ facturaId: "x", monto: 60 }] }],
      [{ id: "n", numero: "", clienteId: "c", fecha: HOY, lineas: [{ articuloId: "i01", descripcion: "", cantidad: 1, precio: 10 }], tasa: 0, motivo: "", aplicado: [{ facturaId: "x", monto: 10 }] }]);
    expect(s).toEqual({ total: 100, pagado: 60, acreditado: 10, saldo: 30 });
  });
});

describe("antigüedad", () => {
  it("tramos", () => {
    expect(tramoDe(HOY, HOY)).toBe("current");
    expect(tramoDe(sumaDias(HOY, 5), HOY)).toBe("current");
    expect(tramoDe(sumaDias(HOY, -1), HOY)).toBe("d1_30");
    expect(tramoDe(sumaDias(HOY, -30), HOY)).toBe("d1_30");
    expect(tramoDe(sumaDias(HOY, -31), HOY)).toBe("d31_60");
    expect(tramoDe(sumaDias(HOY, -61), HOY)).toBe("d61_90");
    expect(tramoDe(sumaDias(HOY, -91), HOY)).toBe("d90");
  });
});

describe("aplicar pagos", () => {
  it("reparte de la más vieja a la más nueva y devuelve lo que sobra", () => {
    const r = repartePago(150, [{ id: "b", fecha: "2026-11-10", saldo: 100 }, { id: "a", fecha: "2026-11-01", saldo: 80 }]);
    expect(r.aplicado).toEqual([{ facturaId: "a", monto: 80 }, { facturaId: "b", monto: 70 }]);
    expect(r.sobra).toBe(0);
    expect(repartePago(200, [{ id: "a", fecha: "2026-11-01", saldo: 80 }]).sobra).toBe(120);
  });
  it("no deja aplicar de más", () => {
    expect(validaAplicacion(100, [{ facturaId: "a", monto: 90 }], { a: 80 })).toBe("over-invoice");
    expect(validaAplicacion(100, [{ facturaId: "a", monto: 80 }, { facturaId: "b", monto: 30 }], { a: 80, b: 50 })).toBe("over-amount");
    expect(validaAplicacion(100, [{ facturaId: "a", monto: 80 }], { a: 80 })).toBeNull();
  });
});

describe("el flujo entero mueve los informes", () => {
  it("factura → pago parcial → nota de crédito → antigüedad y P&L", () => {
    let e = generarMuestra(HOY);
    const libro0 = libroMayor(e);
    const ventas0 = estadoDeResultados(e, libro0, "2026-11-01", HOY).totalIngresos;
    const f: Factura = { id: "nueva", numero: siguienteNumero(e.facturas.map((x) => x.numero), "", 1001), clienteId: "c01", tienda: "RDZ McAllen", fecha: HOY, vence: sumaDias(HOY, 30), lineas: [{ articuloId: "i01", descripcion: "", cantidad: 100, precio: 4 }], tasa: 8.25, borrador: false, enviada: true, nota: "" };
    expect(f.numero).toBe("1041");
    e = reductorQbo(e, { tipo: "guardarFactura", factura: f });
    expect(estadoDeResultados(e, libroMayor(e), "2026-11-01", HOY).totalIngresos).toBe(r2(ventas0 + 400));
    const saldo0 = saldoDeCliente(e, "c01");
    e = reductorQbo(e, { tipo: "recibirPago", pago: { id: "pp", numero: "P-9", clienteId: "c01", fecha: HOY, monto: 200, metodo: "check", referencia: "", cuentaBanco: CTA.banco, aplicado: [{ facturaId: "nueva", monto: 200 }] } });
    expect(saldoDeCliente(e, "c01")).toBe(r2(saldo0 - 200));
    expect(facturasConSaldo(e, HOY).find((x) => x.factura.id === "nueva")!.estado).toBe("partial");
    e = reductorQbo(e, { tipo: "guardarNota", nota: { id: "nn", numero: "CM-9", clienteId: "c01", fecha: HOY, lineas: [{ articuloId: "i01", descripcion: "", cantidad: 10, precio: 4 }], tasa: 8.25, motivo: "", aplicado: [] } });
    e = reductorQbo(e, { tipo: "aplicarNota", id: "nn", aplicado: [{ facturaId: "nueva", monto: 43.3 }] });
    expect(saldoDeFactura(e.facturas.find((x) => x.id === "nueva")!, e.pagos, e.notas).saldo).toBe(r2(433 - 200 - 43.3));
    expect(estadoDeResultados(e, libroMayor(e), "2026-11-01", HOY).totalIngresos).toBe(r2(ventas0 + 360));
    const libro = libroMayor(e);
    expect(documentosDescuadrados(libro)).toEqual([]);
    expect(suma(antiguedadPorCobrar(e, HOY).map((x) => x.total))).toBe(saldoDeCuenta(cuenta(e, CTA.porCobrar), libro));
    expect(balanceGeneral(e, libro, HOY).cuadra).toBe(true);
  });

  it("factura de proveedor → pago → por pagar baja y el banco también", () => {
    let e = generarMuestra(HOY);
    const ap0 = saldoDeCuenta(cuenta(e, CTA.porPagar), libroMayor(e));
    const bank0 = saldoDeCuenta(cuenta(e, CTA.banco), libroMayor(e));
    e = reductorQbo(e, { tipo: "guardarFacturaProv", factura: { id: "bb", numero: "X1", proveedorId: "v3", fecha: HOY, vence: sumaDias(HOY, 30), ordenId: null, nota: "", lineas: [{ cuentaId: CTA.inventario, descripcion: "Thinset", monto: 500 }] } });
    expect(saldoDeCuenta(cuenta(e, CTA.porPagar), libroMayor(e))).toBe(r2(ap0 + 500));
    e = reductorQbo(e, { tipo: "pagarProveedor", pago: { id: "bpx", numero: "CHK-1", proveedorId: "v3", fecha: HOY, cuentaBanco: CTA.banco, metodo: "check", aplicado: [{ facturaId: "bb", monto: 500 }] } });
    expect(saldoDeCuenta(cuenta(e, CTA.porPagar), libroMayor(e))).toBe(ap0);
    expect(saldoDeCuenta(cuenta(e, CTA.banco), libroMayor(e))).toBe(r2(bank0 - 500));
    expect(balanceGeneral(e, libroMayor(e), HOY).cuadra).toBe(true);
  });

  it("orden de compra: recibir a medias, facturar lo recibido", () => {
    let e = generarMuestra(HOY);
    const o = e.ordenes.find((x) => estadoDeOrden(x) === "open")!;
    const l = o.lineas[0];
    e = reductorQbo(e, { tipo: "recibirOrden", id: o.id, cantidades: { [l.articuloId]: 1 } });
    expect(estadoDeOrden(e.ordenes.find((x) => x.id === o.id)!)).toBe("partial");
    const n = e.facturasProv.length;
    e = reductorQbo(e, { tipo: "facturarOrden", id: o.id, billId: "fromPo", numero: "B-1", fecha: HOY });
    expect(e.facturasProv).toHaveLength(n + 1);
    expect(e.facturasProv.at(-1)!.lineas[0].monto).toBe(l.costo);
  });

  it("asiento manual: debe = haber", () => {
    expect(asientoManualBalanceado([{ cuentaId: "a", debe: 100, haber: 0 }, { cuentaId: "b", debe: 0, haber: 100 }]).cuadra).toBe(true);
    expect(asientoManualBalanceado([{ cuentaId: "a", debe: 100, haber: 0 }, { cuentaId: "b", debe: 0, haber: 90 }]).cuadra).toBe(false);
    expect(asientoManualBalanceado([]).cuadra).toBe(false);
  });
});

describe("banco", () => {
  it("categorizar un cargo lo pasa al libro; las reglas categorizan solas", () => {
    let e = generarMuestra(HOY);
    const nuevo = e.movimientos.find((m) => m.estado === "new" && m.monto < 0 && !candidatosDeEnlace(e, m.id).length)!;
    const bank0 = saldoDeCuenta(cuenta(e, CTA.banco), libroMayor(e));
    e = reductorQbo(e, { tipo: "categorizar", id: nuevo.id, cuentaId: "a-6500" });
    expect(saldoDeCuenta(cuenta(e, CTA.banco), libroMayor(e))).toBe(r2(bank0 + nuevo.monto));
    expect(reglaQueAplica(e.reglas, "VALERO #4471")?.cuentaId).toBe("a-6200");
    e = reductorQbo(e, { tipo: "aplicarReglas" });
    expect(e.movimientos.filter((m) => m.estado === "new" && reglaQueAplica(e.reglas, m.descripcion))).toHaveLength(0);
  });
  it("un depósito nuevo se empareja con su pago registrado", () => {
    const e = generarMuestra(HOY);
    const dep = e.movimientos.find((m) => m.estado === "new" && m.monto > 0 && !m.descripcion.includes("INTEREST"))!;
    expect(candidatosDeEnlace(e, dep.id).length).toBeGreaterThan(0);
  });
  it("con todo emparejado y categorizado, libros = banco", () => {
    let e = generarMuestra(HOY);
    for (const m of e.movimientos.filter((x) => x.estado === "new")) {
      const c = candidatosDeEnlace(e, m.id)[0];
      e = c ? reductorQbo(e, { tipo: "enlazar", id: m.id, enlace: { tipo: c.tipo, id: c.id } }) : reductorQbo(e, { tipo: "categorizar", id: m.id, cuentaId: m.monto > 0 ? "a-4900" : "a-6500" });
    }
    // Lo registrado que el banco aún no ve (pagos de los últimos días) es la única diferencia.
    const enLibro = saldoDeCuenta(cuenta(e, CTA.banco), libroMayor(e));
    const enlazados = new Set(e.movimientos.filter((m) => m.enlace).map((m) => `${m.enlace!.tipo}:${m.enlace!.id}`));
    const enTransito = suma([
      ...e.pagos.filter((p) => !enlazados.has(`payment:${p.id}`)).map((p) => p.monto),
      ...e.pagosProv.filter((p) => !enlazados.has(`billPayment:${p.id}`)).map((p) => -p.aplicado.reduce((a, x) => a + x.monto, 0)),
    ]);
    expect(r2(enLibro - enTransito)).toBe(saldoSegunBanco(e, "bank-1"));
  });
  it("conciliar: la diferencia llega a cero marcando lo que el banco ya vio", () => {
    const e = generarMuestra(HOY);
    const reg = registroDelBanco(libroMayor(e), CTA.banco);
    const ya = new Set(e.conciliados);
    const inicial = cuentaDeConciliacion(reg, ya, new Set(), 0).inicial;
    expect(inicial).toBe(85000);
    const marcar = reg.filter((r) => r.fecha <= sumaDias(HOY, -30) && !ya.has(r.clave));
    const saldoFinal = suma([inicial, ...marcar.map((r) => r.efecto)]);
    expect(cuentaDeConciliacion(reg, ya, new Set(marcar.map((r) => r.clave)), saldoFinal).diferencia).toBe(0);
    expect(cuentaDeConciliacion(reg, ya, new Set(), saldoFinal).diferencia).not.toBe(0);
  });
});
