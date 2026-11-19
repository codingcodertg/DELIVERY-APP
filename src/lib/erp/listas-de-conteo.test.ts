import { describe, expect, it } from "vitest";
import {
  altaDeResultados,
  cantidadDesdeTexto,
  diferencia,
  nombreDeLista,
  puedeEnviar,
  resumenDeRenglones,
  TOPE_DE_ALTA,
} from "./listas-de-conteo";

describe("cantidadDesdeTexto", () => {
  it("vacío es «sin contar» (null), no un cero", () => {
    expect(cantidadDesdeTexto("")).toEqual({ ok: true, valor: null });
    expect(cantidadDesdeTexto("   ")).toEqual({ ok: true, valor: null });
  });

  it("acepta cero, enteros y decimales con punto o coma", () => {
    expect(cantidadDesdeTexto("0")).toEqual({ ok: true, valor: 0 });
    expect(cantidadDesdeTexto("12")).toEqual({ ok: true, valor: 12 });
    expect(cantidadDesdeTexto("2.5")).toEqual({ ok: true, valor: 2.5 });
    expect(cantidadDesdeTexto("2,5")).toEqual({ ok: true, valor: 2.5 });
    expect(cantidadDesdeTexto(".5")).toEqual({ ok: true, valor: 0.5 });
  });

  it("rechaza negativos, letras, notación científica y números fuera de rango", () => {
    for (const malo of ["-1", "3x", "1e3", "1..2", "abc", "2,5,1", "2000000000"]) {
      expect(cantidadDesdeTexto(malo), malo).toEqual({ ok: false });
    }
  });
});

describe("diferencia", () => {
  it("contado menos sistema, con signo en el número", () => {
    expect(diferencia(10, 12)).toBe(2);
    expect(diferencia(10, 7)).toBe(-3);
    expect(diferencia(0, 0)).toBe(0);
  });

  it("sin contar o sin sistema no hay diferencia", () => {
    expect(diferencia(10, null)).toBeNull();
    expect(diferencia(null, 4)).toBeNull();
  });

  it("no arrastra errores de punto flotante", () => {
    expect(diferencia(0.1 + 0.2, 0.3)).toBe(0);
  });
});

describe("resumenDeRenglones y puedeEnviar", () => {
  it("cuenta contados y sin contar (un 0 cuenta como contado)", () => {
    const r = resumenDeRenglones([{ counted_qty: 0 }, { counted_qty: null }, { counted_qty: "3" }]);
    expect(r).toEqual({ total: 3, contadas: 2, sinContar: 1 });
  });

  it("una lista vacía no se envía", () => {
    expect(puedeEnviar({ total: 0, sinContar: 0 })).toEqual({ ok: false, motivo: "vacia" });
  });

  it("con renglones sin contar tampoco: hay que contarlos o quitarlos", () => {
    expect(puedeEnviar({ total: 4, sinContar: 1 })).toEqual({ ok: false, motivo: "sinContar" });
  });

  it("todo contado se envía", () => {
    expect(puedeEnviar({ total: 4, sinContar: 0 })).toEqual({ ok: true });
  });
});

describe("nombreDeLista", () => {
  it("«Count <tienda> <fecha>» con la fecha local AAAA-MM-DD", () => {
    expect(nombreDeLista("T1", new Date(2026, 10, 9, 15, 30))).toBe("Count T1 2026-11-09");
  });
});

describe("altaDeResultados", () => {
  it("arriba del tope no agrega nada y lo dice", () => {
    expect(altaDeResultados(TOPE_DE_ALTA + 1, [], new Set())).toEqual({ excede: true, nuevos: [], yaEnLista: 0 });
  });

  it("separa los que ya están en la lista", () => {
    expect(altaDeResultados(3, [1, 2, 3], new Set([2]))).toEqual({ excede: false, nuevos: [1, 3], yaEnLista: 1 });
  });

  it("en el tope exacto sí se puede", () => {
    expect(altaDeResultados(TOPE_DE_ALTA, [7], new Set()).excede).toBe(false);
  });
});

