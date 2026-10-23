import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { botonDelCamion, capacidadAGuardar, capacidadEscrita } from "./boton-del-camion";
import { BotonDelCamion } from "@/components/BotonDelCamion";

// D-NEXT (2026-10-23). El dueño, con la captura de la vista eficiente y tres recuadros: «todo eso que dice órdenes expiradas
// […] ese texto vaya al lado para que en vez de que hayan dos rows, solo haya una. En el número 2, también quiero que solo
// haya una row […] En la parte número 3, igual, quiero una sola row», y la capacidad del camión como un botón «🚚 10».
const plano = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
const pagina = plano("src/app/(app)/routes/page.tsx");
const css = plano("src/app/globals.css");
const boton = plano("src/components/BotonDelCamion.tsx");
const antesQue = (src: string, a: string, b: string) => {
  expect(src.indexOf(a), a).toBeGreaterThan(-1);
  expect(src.indexOf(b), b).toBeGreaterThan(-1);
  expect(src.indexOf(a), `${a} antes que ${b}`).toBeLessThan(src.indexOf(b));
};
const trozo = (src: string, desde: string, hasta: string) => {
  const i = src.indexOf(desde);
  expect(i, desde).toBeGreaterThan(-1);
  const j = src.indexOf(hasta, i);
  expect(j, hasta).toBeGreaterThan(i);
  return src.slice(i, j);
};
const t = (en: string) => en;

describe("el camión: qué ve cada tarjeta", () => {
  it("pulsable donde la tarjeta lleva botones: la ancha, la desplegada y la eficiente de quien puede cambiarla", () => {
    expect(botonDelCamion(false, "ancha")).toBe("pulsable");
    expect(botonDelCamion(false, "desplegada")).toBe("pulsable");
    expect(botonDelCamion(false, "eficiente")).toBe("pulsable");
  });
  it("la compacta de «Cuadrícula» de quien puede cambiarla, nada: se cambia en su desplegada", () => {
    expect(botonDelCamion(false, "compacta")).toBeNull();
  });
  it("solo lectura: el número sin botón, donde la tarjeta lleva cabecera (la desplegada no la repite, D-482)", () => {
    expect(botonDelCamion(true, "ancha")).toBe("fijo");
    expect(botonDelCamion(true, "compacta")).toBe("fijo");
    expect(botonDelCamion(true, "desplegada")).toBeNull();
  });
});

describe("el camión: lo que se escribe y lo que se guarda", () => {
  it("una capacidad es un número mayor que 0, como en el campo de antes (`v > 0`)", () => {
    expect(capacidadEscrita("12")).toBe(12);
    expect(capacidadEscrita(" 14 ")).toBe(14);
    expect(capacidadEscrita("1.5")).toBe(1.5);
    expect(capacidadEscrita("0")).toBeNull();
    expect(capacidadEscrita("-3")).toBeNull();
    expect(capacidadEscrita("")).toBeNull();
    expect(capacidadEscrita("diez")).toBeNull();
  });
  it("«Guardar» guarda lo escrito si es otra; la misma, o una que no vale, no llama al guardado", () => {
    expect(capacidadAGuardar("12", 10)).toBe(12);
    expect(capacidadAGuardar("10", 10)).toBeNull();
    expect(capacidadAGuardar("0", 10)).toBeNull();
  });
  it("el botón, pintado: «🚚 10» que se pulsa, o el mismo «🚚 10» sin botón; cerrado, sin campo a la vista", () => {
    const pulsable = renderToStaticMarkup(createElement(BotonDelCamion, { capacidad: 10, puedeCambiar: true, onGuarda: () => {}, t }));
    expect(pulsable).toMatch(/^<span[^>]*><button[^>]*data-boton-del-camion[^>]*>🚚 (<!-- -->)?10<\/button><\/span>$/);
    expect(pulsable).not.toContain("data-campo-del-camion");
    const fijo = renderToStaticMarkup(createElement(BotonDelCamion, { capacidad: 10, puedeCambiar: false, onGuarda: () => {}, t }));
    expect(fijo).toMatch(/^<span[^>]*data-boton-del-camion[^>]*data-solo-lectura[^>]*>🚚 (<!-- -->)?10<\/span>$/);
    expect(fijo).not.toContain("<button");
    expect(fijo).toContain('title="Truck capacity: 10 pallets"');
  });
  it("la ventanita: Intro o «Guardar» pasan por `capacidadAGuardar` y llaman a `onGuarda`; «Guardar» se apaga si no vale", () => {
    expect(boton).toContain("const v = capacidadAGuardar(texto, capacidad); if (v != null) onGuarda(v); setAbierto(false);");
    expect(boton).toContain("<form onSubmit={(e) => { e.preventDefault(); guarda(); }}>");
    expect(boton).toContain('data-guardar-camion disabled={!valida}');
    expect(boton).toContain("const valida = capacidadEscrita(texto) != null;");
    // Abre con la capacidad de ahora escrita; Escape o un clic fuera la cierran sin guardar.
    expect(boton).toContain("setTexto(String(capacidad));");
    expect(boton).toContain("useCierraAlSalir(abierto, () => setAbierto(false), () => [caja.current]);");
    expect(boton).not.toContain("window.prompt");
  });
  it("la pantalla: el MISMO guardado que el campo (`setCapacity` → `settings.driver_capacity`), en las dos vistas", () => {
    expect(pagina).toContain("const camion = botonDelCamion(soloLectura, modoDeTarjeta);");
    expect(pagina).toContain('{camion && <BotonDelCamion capacidad={capacity} puedeCambiar={camion === "pulsable"} onGuarda={(v) => setCapacity(u.driver, v)} t={t} />}');
    expect(pagina).toContain("saveSettings({ driver_capacity: { ...(settings.driver_capacity ?? {}), [driver]: capacity } });");
    // El campo de antes no queda: ni «Capacidad del camión» con su input, ni la «trm».
    expect(pagina).not.toContain('{t("plt", "trm")}');
    expect(pagina).not.toContain('type="number" min={1} value={capacity}');
    // Al final de la fila de la cabecera, en la tarjeta de cualquier modo (no dentro de lo que es solo de la eficiente).
    antesQue(pagina, '<button className="btn btn-ghost btn-sm" data-png-de-la-ruta={u.key}', "{camion && <BotonDelCamion");
    antesQue(pagina, "{camion && <BotonDelCamion", "{!sinCuerpo && <>");
  });
});

describe("1 · el selector de vista y las expiradas, en una fila", () => {
  it("el aviso «N orden(es) expiradas · N sin fecha — Verlas» va DENTRO de la fila del selector, después de él", () => {
    const fila = trozo(pagina, "<div data-barra-de-arriba", "<div data-vista-del-gestor=");
    antesQue(fila, "data-selector-de-vista", "data-texto-de-expiradas");
    expect(fila).toContain("{!soloPendientes && !soloLectura && (pendientes.atrasadas.length + pendientes.sinFecha.length > 0) && !oculto(AVISOS_DEL_GESTOR.atrasadas) && (");
    expect(fila).toContain('onClick={() => { setAllDates(false); setSoloPendientes(true); }}>{t("View them", "Verlas")}</button>');
    // Una sola vez en la página: el renglón aparte de encima ya no está.
    expect(pagina.split("overdue order(s) · ${pendientes.sinFecha.length} with no date").length - 1).toBe(1);
    // «Viendo solo órdenes expiradas…» (lo que sale tras «Verlas») sigue en su renglón.
    expect(pagina).toContain('{soloPendientes && ( <div className="hint" style={{ marginBottom: 8 }}>');
  });
});

describe("2 · las pestañas de la eficiente, en una fila con «Solicitudes»", () => {
  it("«Solicitudes» está en la franja de las pestañas, junto a «Incidencias»", () => {
    const franja = trozo(pagina, "<div data-barra-de-vistas", "{incidenciasAbiertas && (");
    antesQue(franja, "data-abrir-incidencias", "<BandejaDeSolicitudes");
  });
  it("en escritorio no baja de línea; si no cabe, se desplaza dentro de la franja y no la página", () => {
    const escritorio = trozo(css, '.gestor-eficiente [data-panel-de-choferes] { contain: size;', "/* Por debajo de 1600 px");
    expect(escritorio).toContain(".gestor-eficiente [data-barra-de-vistas] { flex-wrap: nowrap !important; overflow-x: auto; gap: 6px !important; }");
    expect(escritorio).toContain(".gestor-eficiente [data-barra-de-vistas] > .viewtoggle { flex-wrap: nowrap !important; }");
    expect(escritorio).toContain(".gestor-eficiente [data-barra-de-vistas] .rotulo-del-boton { display: none; }");
    expect(css).toContain("@media (min-width: 900px) and (max-width: 1599px) { .gestor-eficiente [data-barra-de-vistas] .rotulo-de-la-franja { display: none; } }");
    expect(plano("src/components/BandejaDeSolicitudes.tsx")).toContain('📥 <span className="rotulo-de-la-franja">{t("Requests", "Solicitudes")}</span> ({pendientes.length})');
  });
});

describe("3 · la cabecera de cada ruta en la eficiente: una fila, sin el resumen", () => {
  it("el resumen (paradas · pallets movidos · carga máxima · millas · jornada) no se pinta en la eficiente; queda en el `title` del nombre", () => {
    expect(pagina).toContain('const eficienteAqui = modoDeTarjeta === "eficiente";');
    expect(pagina).toContain('{stops.length > 0 && !eficienteAqui && ( <span className="hint" data-totales-de-la-lista');
    expect(pagina).toContain("{info && !eficienteAqui && (");
    expect(pagina).toContain("<span data-nombre-de-ruta={u.key} title={resumenDeLaRuta || undefined}");
  });
  it("los avisos de problema siguen en las dos: se pasa de la capacidad, no acaba en 0, más de 8 h, sin medida", () => {
    expect(pagina).toContain("{cuenta.totales.paradasConExceso > 0 && ( <span className=\"sema\" data-exceso-en-la-ruta");
    expect(pagina).toContain("{stops.length > 0 && cuenta.totales.finalNoCero && (");
    expect(pagina).toContain("{info && info.dayMinutes > 8 * 60 && (");
    expect(pagina).toContain('{medida === "fallo" && (');
  });
  it("«⚙ Columnas» sube a la fila de la cabecera en la eficiente; en la completa, su renglón de siempre", () => {
    expect(pagina).toContain("{eficienteAqui && hayFilas && !soloLectura && selectorDeParadas}");
    expect(pagina).toContain("{hayFilas && !soloLectura && !eficienteAqui && (");
    antesQue(pagina, "{eficienteAqui && hayFilas && !soloLectura && selectorDeParadas}", "{!sinCuerpo && <>");
    expect(pagina.split("<SelectorDeColumnas columnas={columnasDelSelector(\"paradas\", ordenGestor)}").length - 1).toBe(1);
  });
  it("en la eficiente los botones van solo con su icono (el rótulo, en el `title`)", () => {
    expect(css).toContain(".gestor-eficiente [data-tarjeta-de-ruta] .rotulo-del-boton { display: none; }");
    const grupo = trozo(pagina, "<span data-acciones-de-la-ruta", "{!sinCuerpo && <>");
    for (const r of ['{t("Undo", "Deshacer")}', '{t("Redo", "Rehacer")}', 't("Lock", "Bloquear")', 't("Optimize", "Optimizar")', '{t("Clear", "Vaciar")}']) {
      expect(grupo).toMatch(new RegExp(`<span className="rotulo-del-boton">[^<]*${r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    }
  });
});
