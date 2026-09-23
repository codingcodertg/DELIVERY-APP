import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tres cosas que solo se vieron al abrir la app en un navegador (D-NEXT). Las pruebas son de ESTRUCTURA: aquí no hay jsdom,
 * así que lo que se mide de verdad —píxeles, recortes, qué se ve sin desplazarse— está medido en Chrome y anotado en la
 * entrada. Esto fija que el arreglo siga en su sitio y no vuelva a irse en una refactorización.
 */

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const ficha = leer("src/components/OrderModal.tsx");
const tabla = leer("src/components/OrdersTable.tsx");
const css = leer("src/app/globals.css");

describe("1 · la ficha abierta lee la orden VIVA, no la foto que le pasaron", () => {
  it("la deriva de `deliveries` por id, con la foto como respaldo", () => {
    expect(plano(ficha)).toContain("const abierta = copia ?? abiertaPorLaLista; const existing = abierta ? deliveries.find((x) => x.id === abierta.id) ?? abierta : null;");
  });
  it("y NO se queda con la foto: `existing` no se iguala al parámetro ni a la copia a secas", () => {
    expect(ficha).not.toMatch(/const existing = copia \?\? abiertaPorLaLista;/);
    expect(ficha).not.toMatch(/const existing = abiertaPorLaLista;/);
  });
  it("la lista de la que lee es la misma que ya usaba la ficha, no una nueva lectura", () => {
    const cabecera = ficha.slice(ficha.indexOf("const {"), ficha.indexOf("const { lang, t }"));
    expect(cabecera).toContain("deliveries");
    expect(cabecera).toContain("useData()");
  });
  it("el respaldo importa: una orden que desaparece de la lista sigue enseñándose", () => {
    // `?? abierta` es lo que evita que la ficha se quede en blanco al borrar la orden o al salirse de la ventana de fechas.
    expect(plano(ficha)).toContain("deliveries.find((x) => x.id === abierta.id) ?? abierta");
  });
  it("el botón de D-361 ya no se llama igual que el verde del pie, que es otra cosa", () => {
    // El del pie abre la firma (POD); el de D-361 cierra la orden SIN firma. Se veían los dos a la vez en `picked_up`.
    expect(ficha).toContain('t("Mark delivered without signature", "Marcar entregada sin firma")');
    expect(ficha).toContain('t("Mark delivered", "Marcar entregado")');            // el del pie, intacto
    expect(ficha).not.toContain('showEntregarYa ? t("Mark delivered", "Marcar entregada")');
  });
});

describe("2 · una celda de pastillas no las parte", () => {
  it("las dos columnas que llevan pastillas están marcadas, y solo esas", () => {
    const marcadas = [...tabla.matchAll(/key: "([a-z_]+)", en: "[^"]*", es: "[^"]*", pastillas: true/g)].map((m) => m[1]);
    expect(marcadas.sort()).toEqual(["date", "stage"]);
  });
  it("la celda recibe la clase solo cuando la columna lo dice", () => {
    expect(plano(tabla)).toContain('c.pastillas ? "td-pastillas" : ""');
    expect(plano(tabla)).toContain('.filter(Boolean).join(" ") || undefined}>');   // sin clase, sin atributo vacío
  });
  it("la regla no depende del texto: deja bajar de línea y recorta la que no quepa", () => {
    const regla = css.slice(css.indexOf("table.orders td.td-pastillas"), css.indexOf(".col-menu {"));
    expect(regla).toContain("white-space: normal;");
    expect(regla).toContain("max-width: 100%;");
    expect(regla).toContain("text-overflow: ellipsis;");
    // `inline-flex` no recorta con puntos: el texto tiene que estar en una caja que sí lo haga.
    expect(regla).toContain("display: inline-block;");
    expect(regla).not.toContain("width: 140px");                                    // no se arregla ensanchando a mano
  });
  it("una pastilla recortada dice su texto entero al pasar el ratón", () => {
    expect(tabla).toContain('<span className="sema" title={stageLabel(d.stage, lang)}');
  });
  it("y los anchos por defecto siguen siendo los compactos de D-344", () => {
    const anchos = leer("src/lib/use-col-widths.ts");
    expect(anchos).toContain("stage: 108,");
    expect(anchos).toContain("date: 112,");
  });
});

describe("3 · en el menú de filtro solo se desplaza la lista de valores", () => {
  it("el menú de FILTRO lleva su clase; el de «⚙ Columnas» comparte `.col-menu` y no se toca", () => {
    expect(tabla).toContain('className="col-menu col-menu-filtro"');
    expect(leer("src/app/(app)/page.tsx")).toContain('className="col-menu"');
  });
  it("la lista es la que se desplaza, no la caja", () => {
    expect(tabla).toContain('<div className="col-menu-lista">');
    expect(tabla).not.toContain('<div style={{ maxHeight: 220, overflowY: "auto" }}>');
    const regla = css.slice(css.indexOf(".col-menu.col-menu-filtro {"));
    expect(regla.slice(0, 400)).toContain("display: flex; flex-direction: column; overflow: hidden;");
    expect(regla.slice(0, 400)).toContain(".col-menu-lista { flex: 1 1 auto; min-height: 60px; overflow-y: auto; }");
    expect(regla.slice(0, 400)).toContain(".col-menu-actions { flex: 0 0 auto; }");
  });
  it("los botones que tenían que quedar a la vista siguen siendo esos dos", () => {
    const acciones = tabla.slice(tabla.indexOf('<div className="col-menu-actions">'), tabla.indexOf("</div>", tabla.indexOf('<div className="col-menu-actions">')) + 6);
    expect(acciones).toContain('t("Clear", "Limpiar")');
    expect(acciones).toContain('t("Apply", "Aplicar")');
  });
});
