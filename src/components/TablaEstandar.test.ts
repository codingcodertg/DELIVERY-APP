import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrefsProvider } from "@/lib/prefs";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { alternaTodas } from "@/lib/tabla-estandar";

// Renderizado en Node (sin navegador): SSR de React. Las props nuevas (`virtual`, `seleccion`, `filtrosIniciales`) son
// opcionales; sin ellas la tabla debe salir IGUAL que antes de existir (ver BASE_ANTES_DEL_CAMBIO).

type F = { id: number; nombre: string; total: number | null; notas: string };
type Props = Parameters<typeof TablaEstandar<F>>[0];

const columnas: ColumnaEstandar<F>[] = [
  { key: "nombre", en: "Name", es: "Nombre", ancho: 200, fija: true, valor: (f) => f.nombre },
  { key: "total", en: "Total", es: "Total", ancho: 110, numerico: true, valor: (f) => f.total, celda: (f) => `$${f.total ?? 0}` },
  { key: "notas", en: "Notes", es: "Notas", ancho: 260, oculta: true, envuelve: true, valor: (f) => f.notas },
];
const filas: F[] = [1, 2, 3].map((i) => ({ id: i, nombre: `Fila ${i}`, total: i * 10, notas: i === 2 ? "" : `nota ${i}` }));

const base: Props = {
  id: "prueba-base",
  columnas,
  filas,
  claveDe: (f) => String(f.id),
  onFila: () => {},
  barra: createElement("span", null, "barra"),
  acciones: () => createElement("button", null, "x"),
  ordenInicial: { clave: "total", direccion: "desc" },
  totales: { total: "60" },
};

function pinta(extra: Partial<Props> = {}): string {
  return renderToStaticMarkup(createElement(PrefsProvider, null, createElement(TablaEstandar<F>, { ...base, ...extra } as Props)));
}

// Lista larga: 5.000 filas con nombres ordenables y un total que recorre 0..4999 en desorden.
const grande: F[] = Array.from({ length: 5000 }, (_, i) => ({
  id: i + 1,
  nombre: `Producto ${String(i + 1).padStart(5, "0")}`,
  total: (i * 7919) % 5000,
  notas: "",
}));
const filasPintadas = (html: string) => [...html.matchAll(/<tr data-fila="([^"]+)"/g)].map((m) => m[1]);

// Salida de la tabla ANTES de añadir las props nuevas (capturada del código de origin/main con `base`).
const BASE_ANTES_DEL_CAMBIO = `<div class="tabla-estandar" data-tabla-estandar="prueba-base"><div class="tabla-estandar-barra"><div class="tabla-estandar-barra-izq"><span>barra</span></div><div style="position:relative;display:inline-block;text-align:left"><button class="btn btn-ghost btn-sm" aria-expanded="false" title="Columns of this table">⚙ <span class="rotulo-del-boton">Columns</span></button></div></div><div class="tbl-scroll tbl-fit tbl-caja"><table class="orders tbl-resize" style="width:max(100%, 430px)" data-tabla="prueba-base"><colgroup><col style="width:200px"/><col style="width:110px"/><col style="width:120px"/></colgroup><thead><tr><th data-col="nombre" class="th-arrastrable" draggable="true" title="Drag to move the column"><div class="th-cell"><button class="th-sort" title="Sort and filter">Name</button><button class="th-filter-btn " title="Sort and filter">▾</button></div><span class="col-resizer" draggable="true" title="Drag to change the width; double-click to reset" data-asa-de="nombre"></span></th><th data-col="total" class="th-arrastrable" draggable="true" title="Drag to move the column"><div class="th-cell"><button class="th-sort" title="Sort and filter">Total ▼</button><button class="th-filter-btn " title="Sort and filter">▾</button></div><span class="col-resizer" draggable="true" title="Drag to change the width; double-click to reset" data-asa-de="total"></span></th><th></th></tr></thead><tbody><tr data-fila="3" class="fila-abre" tabindex="0"><td data-col="nombre" title="Fila 3">Fila 3</td><td data-col="total" class="num">$30</td><td class="celda-suelta"><button>x</button></td></tr><tr data-fila="2" class="fila-abre" tabindex="0"><td data-col="nombre" title="Fila 2">Fila 2</td><td data-col="total" class="num">$20</td><td class="celda-suelta"><button>x</button></td></tr><tr data-fila="1" class="fila-abre" tabindex="0"><td data-col="nombre" title="Fila 1">Fila 1</td><td data-col="total" class="num">$10</td><td class="celda-suelta"><button>x</button></td></tr></tbody><tfoot><tr class="tabla-estandar-totales" data-totales="prueba-base" style="border-top:2px solid var(--line);font-weight:700"><td data-col="nombre"></td><td data-col="total" class="num">60</td><td></td></tr></tfoot></table></div></div>`;

describe("TablaEstandar: sin las props nuevas, la tabla sale igual que antes", () => {
  it("el marcado de una tabla existente no cambia", () => {
    expect(pinta()).toBe(BASE_ANTES_DEL_CAMBIO);
  });
});

describe("TablaEstandar: virtual (listas largas, PRF-06)", () => {
  const virtual = { alto: 56, sobra: 10 };

  it("pinta un número acotado de filas aunque haya 5.000, con relleno para la barra", () => {
    const html = pinta({ filas: grande, virtual, ordenInicial: undefined, onFila: undefined, acciones: undefined, totales: undefined, barra: undefined });
    const pintadas = filasPintadas(html);
    expect(pintadas.length).toBeGreaterThan(0);
    expect(pintadas.length).toBeLessThanOrEqual(30);
    // relleno de abajo: el alto de todas las filas que no se pintan (5.000 × 56 px menos lo pintado)
    const relleno = html.match(/<tr aria-hidden="true" style="height:(\d+)px"/g) ?? [];
    expect(relleno.length).toBeGreaterThanOrEqual(1);
    expect(Number(/height:(\d+)px/.exec(relleno[relleno.length - 1])![1])).toBeGreaterThan(200_000);
    // cada fila lleva su índice, para que la medición de altura sepa cuál es
    expect(html).toMatch(/<tr data-fila="\d+" data-index="0"/);
  });

  it("sin virtual, las 5.000 filas se pintan (como siempre)", () => {
    const html = pinta({ filas: grande, ordenInicial: undefined, onFila: undefined, acciones: undefined, totales: undefined, barra: undefined });
    expect(filasPintadas(html).length).toBe(5000);
    expect(html).not.toContain('data-index="');
    expect(html).not.toContain('aria-hidden="true"');
  });

  it("ordenar actúa sobre TODAS las filas antes de virtualizar: la primera pintada es la de mayor total", () => {
    const top = grande.find((f) => f.total === 4999)!;
    const html = pinta({ filas: grande, virtual, ordenInicial: { clave: "total", direccion: "desc" }, onFila: undefined, acciones: undefined, totales: undefined, barra: undefined });
    expect(filasPintadas(html)[0]).toBe(String(top.id));
  });

  it("filtrar actúa sobre TODAS las filas antes de virtualizar: aparece la única que cumple", () => {
    const html = pinta({
      filas: grande, virtual, ordenInicial: undefined, onFila: undefined, acciones: undefined, totales: undefined, barra: undefined,
      filtrosIniciales: { nombre: new Set(["Producto 03210"]) },
    });
    expect(filasPintadas(html)).toEqual(["3210"]);
  });
});

describe("TablaEstandar: selección (casillas) con la regla de «todas» de siempre", () => {
  it("alternaTodas: marca las listadas si no todas están marcadas; quita todo si lo estaban", () => {
    expect([...alternaTodas(["1", "2"], new Set())].sort()).toEqual(["1", "2"]);
    expect([...alternaTodas(["1", "2"], new Set(["1"]))].sort()).toEqual(["1", "2"]);
    // todas las listadas marcadas → se vacía (también lo que estaba marcado fuera de la lista)
    expect([...alternaTodas(["1", "2"], new Set(["1", "2", "9"]))]).toEqual([]);
    // sin filas listadas: no marca nada, y quita lo marcado (igual que la cola de revisión de antes)
    expect([...alternaTodas([], new Set(["9"]))]).toEqual([]);
  });

  it("la casilla de la cabecera sale marcada solo si todas las filas listadas lo están", () => {
    const cabecera = (html: string) => /<th class="tabla-estandar-sel"><input[^>]*>/.exec(html)![0];
    const todas = pinta({ seleccion: { marcadas: new Set(["1", "2", "3"]), onCambia: () => {} } });
    expect(cabecera(todas)).toContain("checked");
    const algunas = pinta({ seleccion: { marcadas: new Set(["1", "2"]), onCambia: () => {} } });
    expect(cabecera(algunas)).not.toContain("checked");
  });

  it("con selección, la casilla de la cabecera marca lo que la tabla lista (filtrado incluido)", () => {
    const html = pinta({
      filas: grande, virtual: { alto: 56 }, onFila: undefined, acciones: undefined, totales: undefined, barra: undefined,
      filtrosIniciales: { nombre: new Set(["Producto 00007", "Producto 00008"]) },
      seleccion: { marcadas: new Set(), onCambia: () => {} },
    });
    expect(filasPintadas(html)).toEqual(["7", "8"]);
    expect(html).toContain('aria-label="Select all"');
    // las dos filas listadas aparecen con su casilla; el relleno no tiene casillas
    expect((html.match(/<td class="tabla-estandar-sel"><input/g) ?? []).length).toBe(2);
  });
});
