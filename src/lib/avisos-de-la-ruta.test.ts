import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IconoDeAvisos, ListaDeAvisos, posicionDelAviso } from "@/components/IconoDeAvisos";

// Los avisos de la ruta (tarde, relevo, sin pin, solo ciudad, relevo entre rutas) ya no son tarjetas rosas entre la
// cabecera y la tabla: van en un «⚠ N» de la cabecera, con su panel flotante. Lo que se prueba aquí: el panel lleva
// cada aviso con su texto; el botón sale solo si hay avisos; y las tarjetas viejas ya no están en la página.

const t = (en: string, es: string) => es;
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
const pagina = leer("src/app/(app)/routes/page.tsx");

describe("IconoDeAvisos", () => {
  const avisos = [
    { clave: "tarde", titulo: "2 parada(s) no llegarán a tiempo a su ventana", detalle: "#FW579 (Venta al mostrador)" },
    { clave: "mismo_dia_otra_ruta", titulo: "⇄ Tr-FW583-a (Maximo Garza) y Tr-FW583-b (Julio Jijon) van el mismo día", detalle: null },
  ];

  it("sin avisos no pinta nada: el «⚠ N» sale solo cuando hay alguno", () => {
    expect(renderToStaticMarkup(createElement(IconoDeAvisos, { avisos: [], t }))).toBe("");
  });

  it("el botón lleva el número y su rótulo accesible, y cerrado no pinta el panel", () => {
    const h = renderToStaticMarkup(createElement(IconoDeAvisos, { avisos, t }));
    expect(h).toContain("avisos-de-ruta-boton");
    expect(h).toContain("aria-label=\"2 avisos de la ruta\"");
    expect(renderToStaticMarkup(createElement(IconoDeAvisos, { avisos: avisos.slice(0, 1), t }))).toContain("aria-label=\"1 aviso de la ruta\"");
    expect(h).toContain("aria-expanded=\"false\"");
    expect(h).toContain("⚠ 2");
    expect(h).not.toContain("avisos-de-ruta-panel");
  });

  it("el panel lista cada aviso con su título y su detalle (si lo tiene)", () => {
    const h = renderToStaticMarkup(createElement(ListaDeAvisos, { avisos }));
    expect(h).toContain("data-aviso-de-ruta=\"tarde\"");
    expect(h).toContain("2 parada(s) no llegarán a tiempo a su ventana");
    expect(h).toContain("#FW579 (Venta al mostrador)");
    expect(h).toContain("Tr-FW583-a (Maximo Garza) y Tr-FW583-b (Julio Jijon)");
    expect(h.split("avisos-de-ruta-detalle").length - 1).toBe(1);
  });

  it("el panel cae dentro de la ventana: debajo del botón, o encima si abajo no cabe, y a la derecha del botón", () => {
    const p = posicionDelAviso({ top: 100, bottom: 130, left: 300, right: 340 }, { width: 1500, height: 900 });
    expect(p.width).toBe(420);
    expect(p.left).toBe(340 - 420 < 8 ? 8 : 340 - 420);
    expect(p.top).toBe(136);
    expect(p.maxHeight).toBeGreaterThanOrEqual(80);
    // Teléfono: 390 px de ventana, botón en el extremo derecho: el panel no se sale por ningún lado.
    const m = posicionDelAviso({ top: 600, bottom: 628, left: 330, right: 370 }, { width: 390, height: 800 });
    expect(m.width).toBe(374);
    expect(m.left).toBeGreaterThanOrEqual(8);
    expect(m.left + m.width).toBeLessThanOrEqual(390 - 8);
    // Botón al pie de la pantalla: el panel va encima, con `bottom`.
    const pie = posicionDelAviso({ top: 760, bottom: 788, left: 100, right: 140 }, { width: 1500, height: 800 });
    expect(pie.top).toBeUndefined();
    expect(pie.bottom).toBe(800 - 760 + 6);
  });
});

describe("la página de la ruta: las tarjetas viejas se fueron, el icono va en la cabecera", () => {
  it("ya no hay bloques rosados entre la cabecera y la tabla (ni la caja naranja de relevo)", () => {
    expect(pagina).not.toContain("data-relevo-antes-de-tiempo");
    expect(pagina).not.toContain("data-solo-ciudad-ruta");
    expect(pagina).not.toContain("<AvisosDeRelevo");
    expect(pagina).not.toContain("<div className=\"card\" style={{ marginBottom: 8, background: \"var(--red-soft)\"");
  });
  it("cada tarjeta lleva su «⚠ N» en la cabecera, y la barra el de los avisos sin ruta a la vista", () => {
    expect(pagina).toContain("{!sinCuerpo && <IconoDeAvisos avisos={avisosDeLaCarta} t={t} />}");
    expect(pagina).toContain("{relevosSinCarta.length > 0 && <IconoDeAvisos");
    // Los avisos de cada ruta: los cuatro de siempre más los de relevo que la ruta lleva.
    for (const clave of ["\"tarde\"", "\"relevo-antes-de-tiempo\"", "\"sin-pin\"", "\"solo-ciudad\""]) expect(pagina).toContain(`clave: ${clave}`);
    expect(pagina).toContain("relevosDeLaCarta.get(u.key)");
  });
});
