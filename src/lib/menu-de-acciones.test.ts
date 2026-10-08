import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ALTO_OPCION, ALTO_RAYA, ANCHO_MENU_ACCIONES, altoDelMenu, colocacionDelMenu, focoAlTeclear } from "./menu-de-acciones";
import { posicionDelMenu } from "./menu-desplegable";
import { MenuDeAcciones, OpcionesDelMenu, type OpcionDelMenu } from "@/components/MenuDeAcciones";

// D-NEXT · El menú «Acciones ▾» de la ficha: dónde se pinta, el teclado, y lo que lee un lector de pantalla.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

describe("altoDelMenu: 44 px por opción, más la raya y el relleno", () => {
  it("cuenta cada opción a 44 px (un dedo), cada raya a 9 y 14 de relleno y borde", () => {
    expect(ALTO_OPCION).toBe(44);
    expect(altoDelMenu(3, 0)).toBe(3 * 44 + 14);
    expect(altoDelMenu(7, 1)).toBe(7 * 44 + ALTO_RAYA + 14);
  });
});

describe("colocacionDelMenu: nunca fuera de la ventana", () => {
  const telefono = { ancho: 390, alto: 844 };

  it("en un teléfono de 390 px: 260 de ancho, pegado al borde derecho del botón y con 8 px de aire como mínimo", () => {
    // El botón «Acciones ▾» a la derecha del pie, al fondo de la pantalla.
    const c = colocacionDelMenu({ top: 760, bottom: 800, right: 382 }, telefono, altoDelMenu(7, 1));
    expect(c.width).toBe(ANCHO_MENU_ACCIONES);
    expect(c.left).toBe(382 - 260);
    expect(c.left + c.width).toBeLessThanOrEqual(390 - 8);
    // Debajo no cabe: abre hacia arriba, a 6 px del botón.
    expect([c.top, c.bottom]).toEqual(["auto", 844 - 760 + 6]);
  });

  it("con el botón pegado a la izquierda no se sale por la izquierda", () => {
    const c = colocacionDelMenu({ top: 300, bottom: 340, right: 120 }, telefono, altoDelMenu(4, 0));
    expect(c.left).toBe(8);
  });

  it("en una ventana más estrecha que el menú, se estrecha él", () => {
    const c = colocacionDelMenu({ top: 300, bottom: 340, right: 240 }, { ancho: 250, alto: 600 }, altoDelMenu(4, 0));
    expect(c.width).toBe(250 - 16);
    expect(c.left).toBe(8);
  });

  it("si cabe debajo, abre debajo; y su alto máximo es lo que mide", () => {
    const alto = altoDelMenu(3, 0);
    const c = colocacionDelMenu({ top: 100, bottom: 140, right: 382 }, telefono, alto);
    expect([c.top, c.bottom]).toEqual([146, "auto"]);
    expect(c.maxHeight).toBe(alto);
  });

  it("si no cabe en ningún lado, se queda en el sitio que hay y se desplaza por dentro", () => {
    // Ventana de 500 de alto, botón en medio: 230 arriba, 230 abajo, y el menú mide 9 × 44 + 9 + 14 = 419.
    const c = colocacionDelMenu({ top: 230, bottom: 270, right: 382 }, { ancho: 390, alto: 500 }, altoDelMenu(9, 1));
    expect(c.top).toBe(276);
    expect(c.maxHeight).toBe(500 - 270 - 6 - 8);
    // Y hacia arriba igual: el sitio de arriba.
    const arriba = colocacionDelMenu({ top: 300, bottom: 340, right: 382 }, { ancho: 390, alto: 500 }, altoDelMenu(9, 1));
    expect(arriba.top).toBe("auto");
    expect(arriba.maxHeight).toBe(300 - 6 - 8);
  });

  it("`posicionDelMenu` sin medidas sigue siendo el de las cabeceras (210 de ancho, 400 de alto previsto)", () => {
    // El menú de las cabeceras de Órdenes no cambia: con el botón a 230 del fondo, abre hacia arriba por sus 400.
    expect(posicionDelMenu({ top: 400, bottom: 443, right: 500 }, { ancho: 1366, alto: 673 }).top).toBe("auto");
    expect(posicionDelMenu({ top: 400, bottom: 443, right: 500 }, { ancho: 1366, alto: 673 }, { ancho: 260, alto: 200 }).top).toBe(449);
    expect(posicionDelMenu({ top: 400, bottom: 443, right: 500 }, { ancho: 1366, alto: 673 }, { ancho: 260, alto: 200 }).left).toBe(240);
  });
});

describe("focoAlTeclear: el teclado dentro del menú", () => {
  it("↓ y ↑ recorren las opciones y dan la vuelta", () => {
    expect(focoAlTeclear("ArrowDown", 0, 4)).toBe(1);
    expect(focoAlTeclear("ArrowDown", 3, 4)).toBe(0);
    expect(focoAlTeclear("ArrowUp", 0, 4)).toBe(3);
    expect(focoAlTeclear("ArrowUp", 2, 4)).toBe(1);
  });
  it("sin foco aún, ↓ va a la primera y ↑ a la última", () => {
    expect(focoAlTeclear("ArrowDown", -1, 4)).toBe(0);
    expect(focoAlTeclear("ArrowUp", -1, 4)).toBe(3);
  });
  it("Inicio y Fin, a los extremos; cualquier otra tecla no mueve nada; sin opciones, nada", () => {
    expect(focoAlTeclear("Home", 2, 4)).toBe(0);
    expect(focoAlTeclear("End", 1, 4)).toBe(3);
    expect(focoAlTeclear("Enter", 1, 4)).toBeNull();
    expect(focoAlTeclear("a", 1, 4)).toBeNull();
    expect(focoAlTeclear("ArrowDown", -1, 0)).toBeNull();
  });
});

describe("lo que se pinta: el botón y las opciones", () => {
  const opciones: OpcionDelMenu[] = [
    { id: "editar", texto: "Editar", alPulsar: () => {} },
    { id: "imprimir", texto: "🖨 Comprobante", titulo: "Imprimir", alPulsar: () => {} },
    { id: "duplicar", texto: "⧉ Duplicar", deshabilitada: "Espere — todavía se está guardando el último cambio", titulo: "Crear una copia", alPulsar: () => {} },
    { id: "anular", texto: "Cancelar orden", peligro: true, alPulsar: () => {} },
    { id: "eliminar", texto: "Eliminar", peligro: true, alPulsar: () => {} },
  ];

  it("cerrado: «Acciones ▾» dice que abre un menú y que está cerrado", () => {
    const html = renderToStaticMarkup(createElement(MenuDeAcciones, { rotulo: "Acciones", opciones }));
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Acciones <span aria-hidden="true">▾</span>');
    expect(html).not.toContain('role="menu"');
  });

  it("sin opciones no hay botón", () => {
    expect(renderToStaticMarkup(createElement(MenuDeAcciones, { rotulo: "Acciones", opciones: [] }))).toBe("");
  });

  it("cada opción es un `menuitem`; la apagada lo dice con `aria-disabled` y su motivo en el `title`", () => {
    const html = renderToStaticMarkup(createElement(OpcionesDelMenu, { opciones, onElegir: () => {} }));
    expect((html.match(/role="menuitem"/g) ?? []).length).toBe(5);
    expect(html).toContain('aria-disabled="true" title="Espere — todavía se está guardando el último cambio"');
    expect((html.match(/aria-disabled/g) ?? []).length).toBe(1);
    // La encendida lleva el `title` que tenía su botón.
    expect(html).toContain('title="Imprimir"');
  });

  it("lo destructivo, en rojo y con UNA raya encima, justo antes de la primera", () => {
    const html = renderToStaticMarkup(createElement(OpcionesDelMenu, { opciones, onElegir: () => {} }));
    expect((html.match(/role="separator"/g) ?? []).length).toBe(1);
    expect(html.indexOf('role="separator"')).toBeGreaterThan(html.indexOf("⧉ Duplicar"));
    expect(html.indexOf('role="separator"')).toBeLessThan(html.indexOf("Cancelar orden"));
    expect((html.match(/menu-accion-peligro/g) ?? []).length).toBe(2);
  });

  it("si solo hay destructivas, no hay raya: arriba del todo no separa nada", () => {
    const html = renderToStaticMarkup(createElement(OpcionesDelMenu, { opciones: opciones.slice(3), onElegir: () => {} }));
    expect(html).not.toContain('role="separator"');
  });
});

describe("el componente: cierre, teclado y portal", () => {
  const src = plano(leer("src/components/MenuDeAcciones.tsx"));

  it("se cierra con Escape y con un clic fuera (el mismo `useCierraAlSalir` de los menús de Órdenes)", () => {
    expect(src).toContain("useCierraAlSalir(abierto, cerrar, () => [boton.current, menu.current]);");
  });

  it("elegir cierra el menú y luego hace la acción; una apagada no hace nada", () => {
    expect(src).toContain("const elegir = (o: OpcionDelMenu) => { if (o.deshabilitada) return; cerrar(); o.alPulsar(); };");
  });

  it("el teclado: ↓/↑ en el botón lo abren; dentro, `focoAlTeclear`; Tab lo cierra", () => {
    expect(src).toContain('if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;');
    expect(src).toContain('abrir(ev.key === "ArrowUp" ? "ultima" : "primera");');
    expect(src).toContain("const siguiente = focoAlTeclear(ev.key, lista.indexOf(document.activeElement as HTMLButtonElement), lista.length);");
    expect(src).toContain('if (ev.key === "Tab") { cerrar(); return; }');
    // Y al cerrar con el foco dentro, vuelve al botón.
    expect(src).toContain("if (menu.current?.contains(document.activeElement)) boton.current?.focus();");
  });

  it("se coloca con `colocacionDelMenu`, en un portal, y se cierra si la ficha se desplaza", () => {
    expect(src).toContain("setEstilo(colocacionDelMenu(");
    expect(src).toContain("altoDelMenu(opciones.length, rayas),");
    expect(src).toContain("document.body,");
    expect(src).toContain('document.addEventListener("scroll", alMoverse, true);');
  });

  it("las opciones miden 44 px y lo destructivo es rojo (CSS)", () => {
    const css = plano(leer("src/app/globals.css"));
    expect(css).toContain(".menu-accion { width: 100%; min-height: 44px;");
    expect(css).toContain(".menu-accion-peligro { color: var(--red);");
    expect(css).toContain('.menu-accion[aria-disabled="true"] { color: var(--gray);');
  });
});
