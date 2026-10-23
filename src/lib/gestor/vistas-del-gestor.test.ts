import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { abreAlMarcar, claveDeLaVista, guardaVista, leeVista } from "./vistas-del-gestor";
import { MAPA_INICIAL, alAbrirRutas } from "./mapa-al-abrir-ruta";
import { conAcciones, conCabecera, conCuerpo } from "./cuadricula";
import { estaPlegada } from "@/lib/vista-del-gestor";

// D-653 (2026-10-23). El dueño: «Cuando yo elijo un driver, él me abre la ruta, pero no me abre […] la ruta de abajo», y
// dos vistas, la completa (la de siempre) y la eficiente. Nombres inventados.
const plano = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
const pagina = plano("src/app/(app)/routes/page.tsx");
const css = plano("src/app/globals.css");
/** Está, y antes que lo otro (un `indexOf` de −1 pasaría cualquier orden). */
const antesQue = (src: string, a: string, b: string) => {
  expect(src.indexOf(a), a).toBeGreaterThan(-1);
  expect(src.indexOf(b), b).toBeGreaterThan(-1);
  expect(src.indexOf(a)).toBeLessThan(src.indexOf(b));
};

describe("1 · marcar un chofer abre su tabla, desmarcarlo la cierra (`abreAlMarcar`)", () => {
  it("«Cuadrícula»: marcar despliega ESA ruta, aunque hubiera otra desplegada", () => {
    expect(abreAlMarcar({ ancho: false, desplegada: null, alternadas: new Set() }, "Ana", true).desplegada).toBe("Ana");
    expect(abreAlMarcar({ ancho: false, desplegada: "Beto", alternadas: new Set() }, "Ana", true).desplegada).toBe("Ana");
  });
  it("«Cuadrícula»: desmarcar la desplegada la pliega; desmarcar otra no toca la desplegada", () => {
    expect(abreAlMarcar({ ancho: false, desplegada: "Ana", alternadas: new Set() }, "Ana", false).desplegada).toBeNull();
    expect(abreAlMarcar({ ancho: false, desplegada: "Beto", alternadas: new Set() }, "Ana", false).desplegada).toBe("Beto");
  });
  it("«Ancho»: marcar deja su tarjeta abierta (nacen plegadas), y desmarcar la vuelve a plegar; las demás, igual", () => {
    const abierta = abreAlMarcar({ ancho: true, desplegada: null, alternadas: new Set(["Beto"]) }, "Ana", true);
    expect(estaPlegada("Ana", abierta.alternadas)).toBe(false);
    expect(estaPlegada("Beto", abierta.alternadas)).toBe(false);
    // Ya abierta: marcar no la pliega.
    expect(estaPlegada("Ana", abreAlMarcar({ ancho: true, desplegada: null, alternadas: abierta.alternadas }, "Ana", true).alternadas)).toBe(false);
    const cerrada = abreAlMarcar({ ancho: true, desplegada: null, alternadas: abierta.alternadas }, "Ana", false);
    expect(estaPlegada("Ana", cerrada.alternadas)).toBe(true);
    expect(estaPlegada("Beto", cerrada.alternadas)).toBe(false);
    // Ya plegada: desmarcar no la abre.
    expect(estaPlegada("Ana", abreAlMarcar({ ancho: true, desplegada: null, alternadas: new Set() }, "Ana", false).alternadas)).toBe(true);
  });
  it("no cambia lo que recibe", () => {
    const alternadas = new Set<string>();
    abreAlMarcar({ ancho: true, desplegada: null, alternadas }, "Ana", true);
    expect(alternadas.size).toBe(0);
  });
  it("lo abierto desde el panel no esconde el mapa; abrirla por su nombre, sí (D-544)", () => {
    expect(alAbrirRutas(MAPA_INICIAL, [], ["Ana"], new Set(["Ana"])).visible).toBe(true);
    expect(alAbrirRutas(MAPA_INICIAL, [], ["Ana"]).visible).toBe(false);
    // Una del panel y otra nueva a mano: la de a mano manda.
    expect(alAbrirRutas(MAPA_INICIAL, [], ["Ana", "Beto"], new Set(["Ana"])).visible).toBe(false);
  });
  it("la pantalla: la casilla y la fila del panel pasan por `abreAlMarcar`, y sin esconder el mapa", () => {
    expect(pagina).toContain("onEnfoca={enfocaEnElPanel} onAlterna={alternaEnElPanel}");
    expect(pagina).toContain("const ahora = alternaVisible(selected, clavesDelPanel, clave); setSelected(ahora); abreDesdeElPanel(clave, ahora.has(clave));");
    expect(pagina).toContain("const enfocaEnElPanel = (clave: string) => { focusOnly(clave); abreDesdeElPanel(clave, true); };");
    expect(pagina).toContain("const r = abreAlMarcar({ ancho: wideRoutes, desplegada, alternadas }, clave, marcada); if (marcada) abiertasDesdeElPanel.current = new Set([clave]); setDesplegada(r.desplegada); setAlternadas(r.alternadas);");
    expect(pagina).toContain("const desdeElPanel = abiertasDesdeElPanel.current; abiertasDesdeElPanel.current = new Set(); setEstadoDelMapa((e) => alAbrirRutas(e, antes, abiertas, desdeElPanel));");
    // Lo marcado que se recuerda llega abierto.
    expect(pagina).toContain("if (leidos.length > 0) { abiertasDesdeElPanel.current = new Set(leidos); setDesplegada(leidos[leidos.length - 1]); }");
  });
});

describe("2 · el selector «Vista completa | Vista eficiente», recordado por persona", () => {
  const almacen = () => {
    const m = new Map<string, string>();
    return { m, a: { setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } };
  };
  it("sin nada guardado, o con algo raro, o sin almacenamiento: la completa", () => {
    expect(leeVista(() => null, "u1")).toBe("completa");
    expect(leeVista(() => "otra", "u1")).toBe("completa");
    expect(leeVista(() => { throw new Error("bloqueado"); }, "u1")).toBe("completa");
  });
  it("guardar la eficiente y leerla; volver a la completa BORRA la clave; cada persona la suya", () => {
    const { m, a } = almacen();
    guardaVista(() => a, "u1", "eficiente");
    expect(leeVista((k) => m.get(k) ?? null, "u1")).toBe("eficiente");
    expect(leeVista((k) => m.get(k) ?? null, "u2")).toBe("completa");
    expect(claveDeLaVista("u1")).not.toBe(claveDeLaVista("u2"));
    guardaVista(() => a, "u1", "completa");
    expect(m.size).toBe(0);
    expect(() => guardaVista(() => { throw new Error("sin almacenamiento"); }, "u1", "eficiente")).not.toThrow();
  });
  it("la pantalla: los dos botones arriba, se lee al saber quién es y se guarda al pulsar; solo en el Gestor", () => {
    expect(pagina).toContain('<div className="viewtoggle" data-selector-de-vista');
    expect(pagina).toContain('data-vista="completa" aria-pressed={!eficiente} onClick={() => eligeVista("completa")}');
    expect(pagina).toContain('data-vista="eficiente" aria-pressed={eficiente} onClick={() => eligeVista("eficiente")}');
    expect(pagina).toContain("setVista(leeVista((k) => window.localStorage.getItem(k), me.id));");
    expect(pagina).toContain("setVista(v); if (me?.id) guardaVista(() => window.localStorage, me.id, v);");
    expect(pagina).toContain('const eficiente = vista === "eficiente" && !soloLectura;');
    // El selector, arriba: antes que el panel y que las pestañas.
    antesQue(pagina, "data-selector-de-vista", "<PanelDeChoferes");
    antesQue(pagina, "data-selector-de-vista", "<div data-barra-de-vistas");
  });
});

describe("3 · la vista eficiente: pestañas en la fila del panel, y la tabla pegada al mapa", () => {
  it("en la completa los envoltorios no generan caja: nada cambia", () => {
    expect(css).toContain("[data-vista-del-gestor], [data-contenido-de-la-pestana] { display: contents; }");
    expect(pagina).toContain('<div data-vista-del-gestor={eficiente ? "eficiente" : "completa"} className={eficiente ? "gestor-eficiente" : undefined}>');
  });
  it("en la eficiente, una rejilla: el panel a la izquierda, las pestañas a su derecha arriba, el mapa debajo y la tabla bajo los dos", () => {
    expect(css).toContain('grid-template-areas: "panel barra" "panel mapa" "contenido contenido";');
    // En el teléfono, una columna: las pestañas siguen ANTES que el mapa y la tabla.
    expect(css).toContain('grid-template-areas: "panel" "barra" "mapa" "contenido";');
    expect(css).toContain(".gestor-eficiente .panel-fijo-del-gestor { display: contents !important; }");
    expect(css).toContain(".gestor-eficiente [data-barra-de-vistas] { grid-area: barra;");
    expect(css).toContain(".gestor-eficiente [data-mapa-del-gestor] { grid-area: mapa;");
    expect(css).toContain(".gestor-eficiente > [data-contenido-de-la-pestana] { grid-area: contenido;");
    expect(pagina).toContain('<div className="card" data-mapa-del-gestor');
    // Todo lo que la rejilla coloca está dentro del envoltorio, y lo de la pestaña dentro del suyo.
    antesQue(pagina, "<div data-vista-del-gestor=", '<div ref={panelFijoRef} className="panel-fijo-del-gestor"');
    antesQue(pagina, '<div ref={panelFijoRef} className="panel-fijo-del-gestor"', "<div data-barra-de-vistas");
    antesQue(pagina, "<div data-barra-de-vistas", "<div data-contenido-de-la-pestana>");
    antesQue(pagina, "<div data-contenido-de-la-pestana>", "<div data-tarjetas-de-ruta=");
    expect(pagina).toContain("{!soloLectura && tab === \"routes\" && seleccionDelReparto.length > 0 && recuadroDeReparto()} </div> </div>");
  });
  it("el mapa no se esconde en la eficiente, y lo que solo es de la completa no sale", () => {
    expect(pagina).toContain("const showTop = eficiente || estadoDelMapa.visible;");
    expect(pagina).toContain('{!eficiente && ( <button className={"btn btn-sm " + (showTop ? "btn-ghost" : "btn-primary")} data-boton-del-mapa');
    expect(pagina).toContain('{tab === "routes" && !eficiente && ( <button className="btn btn-ghost btn-sm" data-cuadricula');
    expect(pagina).toContain("if (eficiente) return; if (!wideRoutes) { setDesplegada(key); return; }");
  });
  it("qué rutas salen lo deciden solo las casillas: una tarjeta entera por ruta que pasa el filtro, sin desplegable", () => {
    expect(pagina).toContain('const tarjetasDeRuta: [Lane, ModoDeTarjeta][] = eficiente ? shownDrivers.map((u) => [u, "eficiente"]) :');
    expect(pagina).toContain("const lanesDelFiltro = lanes.filter((l) => pasaFiltro(l.key));");
    expect(pagina).toContain("const shownDrivers = lanesDelFiltro.filter(");
    // El nombre solo nombra: sin onClick, sin ▸/▾.
    // Nota D-655: el nombre lleva en su `title` el resumen de la ruta, que en la eficiente ya no se pinta.
    expect(pagina).toContain('{modoDeTarjeta === "eficiente" ? ( <span data-nombre-de-ruta={u.key} title={resumenDeLaRuta || undefined} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>');
    // Entera: con sus números, su tabla y sus botones (flechas, Bloquear, Optimizar, Vaciar, PNG).
    expect(conCabecera("eficiente")).toBe(true);
    expect(conCuerpo("eficiente", true)).toBe(true);
    expect(conAcciones(false, "eficiente")).toBe(true);
    expect(conAcciones(true, "eficiente")).toBe(false);
  });
});
