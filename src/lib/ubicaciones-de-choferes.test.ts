import { describe, expect, it } from "vitest";
import { aplicarPosicion, crearAlmacenDeUbicaciones, ultimasPorChofer, type FuenteDeUbicaciones } from "./ubicaciones-de-choferes";
import type { DriverLocation } from "@/lib/types";

const fila = (driver_id: string, recorded_at: string, lat = 1): DriverLocation => ({
  id: `${driver_id}-${recorded_at}`, driver_id, lat, lng: 2, accuracy_m: null, speed_mps: null,
  heading: null, battery_pct: null, recorded_at, created_at: recorded_at,
});

describe("aplicarPosicion", () => {
  it("pone un chofer nuevo al frente", () => {
    const out = aplicarPosicion([fila("a", "2026-11-16T10:00:00Z")], fila("b", "2026-11-16T10:01:00Z"));
    expect(out.map((p) => p.driver_id)).toEqual(["b", "a"]);
  });

  it("reemplaza la posición de un chofer por la más nueva", () => {
    const out = aplicarPosicion([fila("a", "2026-11-16T10:00:00Z", 1)], fila("a", "2026-11-16T10:05:00Z", 9));
    expect(out).toHaveLength(1);
    expect(out[0].lat).toBe(9);
  });

  it("una fila más vieja no pisa a la nueva y devuelve la MISMA lista", () => {
    const lista = [fila("a", "2026-11-16T10:05:00Z", 9)];
    const out = aplicarPosicion(lista, fila("a", "2026-11-16T10:00:00Z", 1));
    expect(out).toBe(lista);
  });
});

describe("ultimasPorChofer", () => {
  it("con las filas más nuevas primero, se queda con la primera de cada chofer", () => {
    const filas = [
      fila("a", "2026-11-16T10:09:00Z", 9),
      fila("b", "2026-11-16T10:08:00Z", 8),
      fila("a", "2026-11-16T10:01:00Z", 1),
    ];
    const out = ultimasPorChofer(filas);
    expect(out.map((p) => [p.driver_id, p.lat])).toEqual([["a", 9], ["b", 8]]);
  });
});

/** Una fuente de prueba: la consulta inicial se resuelve cuando el test lo dice, y el canal se puede disparar a mano. */
function fuentePrueba() {
  let resolverCarga: ((filas: DriverLocation[] | null) => void) | null = null;
  let alLlegarRef: ((f: DriverLocation) => void) | null = null;
  const llamadas = { cargar: 0, escuchar: 0, soltar: 0 };
  const fuente: FuenteDeUbicaciones = {
    cargar: () => { llamadas.cargar++; return new Promise((r) => { resolverCarga = r; }); },
    escuchar: (alLlegar) => { llamadas.escuchar++; alLlegarRef = alLlegar; return () => { llamadas.soltar++; alLlegarRef = null; }; },
  };
  return {
    fuente,
    llamadas,
    resolverCarga: (filas: DriverLocation[] | null) => resolverCarga?.(filas),
    llega: (f: DriverLocation) => alLlegarRef?.(f),
  };
}

const esperar = () => new Promise((r) => setTimeout(r, 0));

describe("crearAlmacenDeUbicaciones (contador de usos)", () => {
  it("sin nadie que la use, no escucha ni carga nada", () => {
    const p = fuentePrueba();
    const almacen = crearAlmacenDeUbicaciones();
    almacen.fijarFuente(p.fuente);
    expect(p.llamadas).toEqual({ cargar: 0, escuchar: 0, soltar: 0 });
  });

  it("la primera petición arranca una sola vez; la última que se suelta para y vacía la lista", async () => {
    const p = fuentePrueba();
    const almacen = crearAlmacenDeUbicaciones();
    almacen.fijarFuente(p.fuente);
    const soltar1 = almacen.pedir();
    const soltar2 = almacen.pedir();
    expect(p.llamadas.cargar).toBe(1);
    expect(p.llamadas.escuchar).toBe(1);

    p.resolverCarga([fila("a", "2026-11-16T10:00:00Z")]);
    await esperar();
    expect(almacen.leer().map((x) => x.driver_id)).toEqual(["a"]);

    soltar1();
    expect(p.llamadas.soltar).toBe(0);
    soltar2();
    expect(p.llamadas.soltar).toBe(1);
    expect(almacen.leer()).toEqual([]);
  });

  it("soltar dos veces la misma petición no la cuenta dos veces", () => {
    const p = fuentePrueba();
    const almacen = crearAlmacenDeUbicaciones();
    almacen.fijarFuente(p.fuente);
    const a = almacen.pedir();
    const b = almacen.pedir();
    a(); a();
    expect(p.llamadas.soltar).toBe(0);
    b();
    expect(p.llamadas.soltar).toBe(1);
  });

  it("los pings que llegan se aplican a la lista mientras alguien mira", () => {
    const p = fuentePrueba();
    const almacen = crearAlmacenDeUbicaciones();
    almacen.fijarFuente(p.fuente);
    almacen.pedir();
    p.llega(fila("z", "2026-11-16T10:00:00Z", 5));
    expect(almacen.leer().map((x) => x.driver_id)).toEqual(["z"]);
  });

  it("una carga que llega después de soltar no vuelve a poblar la lista", async () => {
    const p = fuentePrueba();
    const almacen = crearAlmacenDeUbicaciones();
    almacen.fijarFuente(p.fuente);
    const soltar = almacen.pedir();
    soltar();
    p.resolverCarga([fila("a", "2026-11-16T10:00:00Z")]);
    await esperar();
    expect(almacen.leer()).toEqual([]);
  });

  it("una carga fallida (null) no toca la lista", async () => {
    const p = fuentePrueba();
    const almacen = crearAlmacenDeUbicaciones();
    almacen.fijarFuente(p.fuente);
    almacen.pedir();
    p.llega(fila("a", "2026-11-16T10:00:00Z", 3));
    p.resolverCarga(null);
    await esperar();
    expect(almacen.leer().map((x) => [x.driver_id, x.lat])).toEqual([["a", 3]]);
  });

  it("la carga inicial no pisa una posición más nueva que llegó por realtime antes", async () => {
    const p = fuentePrueba();
    const almacen = crearAlmacenDeUbicaciones();
    almacen.fijarFuente(p.fuente);
    almacen.pedir();
    p.llega(fila("a", "2026-11-16T10:09:00Z", 9));
    p.resolverCarga([fila("a", "2026-11-16T10:01:00Z", 1), fila("b", "2026-11-16T10:02:00Z", 2)]);
    await esperar();
    const out = almacen.leer();
    expect(out.find((x) => x.driver_id === "a")?.lat).toBe(9);
    expect(out.find((x) => x.driver_id === "b")?.lat).toBe(2);
  });

  it("cambiar la fuente mientras alguien mira la reengancha (suelta la anterior y carga la nueva)", () => {
    const p1 = fuentePrueba();
    const p2 = fuentePrueba();
    const almacen = crearAlmacenDeUbicaciones();
    almacen.fijarFuente(p1.fuente);
    almacen.pedir();
    almacen.fijarFuente(p2.fuente);
    expect(p1.llamadas.soltar).toBe(1);
    expect(p2.llamadas.cargar).toBe(1);
    expect(p2.llamadas.escuchar).toBe(1);
  });

  it("avisa a los oyentes solo cuando la lista cambia de verdad", () => {
    const almacen = crearAlmacenDeUbicaciones();
    let avisos = 0;
    almacen.suscribir(() => { avisos++; });
    almacen.aplicar(fila("a", "2026-11-16T10:05:00Z", 9));
    almacen.aplicar(fila("a", "2026-11-16T10:00:00Z", 1));
    expect(avisos).toBe(1);
  });
});
