import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALTO_PREVISTO, cierraElMenu, posicionDelMenu, type Contenedor } from "./menu-desplegable";

// Un nodo falso: contiene exactamente los objetivos que se le dan.
const nodo = (...dentro: unknown[]): Contenedor => ({ contains: (o) => dentro.includes(o) });
const objetivo = (nombre: string) => ({ nombre }) as unknown as EventTarget;

describe("cierraElMenu: Escape y clic fuera", () => {
  const casilla = objetivo("casilla del menú");
  const boton = objetivo("botón que lo abre");
  const otraCosa = objetivo("la tabla");
  const dentro = [nodo(casilla), nodo(boton)];

  it("Escape lo cierra", () => {
    expect(cierraElMenu({ type: "keydown", key: "Escape" }, dentro)).toBe(true);
  });

  it("otra tecla no lo cierra: se está escribiendo en el buscador", () => {
    for (const key of ["Enter", "a", "ArrowDown", " "]) {
      expect(cierraElMenu({ type: "keydown", key }, dentro)).toBe(false);
    }
  });

  it("un clic fuera de todo lo cierra", () => {
    expect(cierraElMenu({ type: "mousedown", target: otraCosa }, dentro)).toBe(true);
  });

  it("un clic dentro del menú no lo cierra", () => {
    expect(cierraElMenu({ type: "mousedown", target: casilla }, dentro)).toBe(false);
  });

  it("un clic en el botón que lo abre tampoco: lo cierra el botón, no el mousedown", () => {
    // El botón va SEGUNDO en la lista: comprobar solo el primero no basta.
    expect(cierraElMenu({ type: "mousedown", target: boton }, dentro)).toBe(false);
  });

  it("un nodo que aún no existe (null) no cuenta como dentro, ni revienta", () => {
    expect(cierraElMenu({ type: "mousedown", target: casilla }, [null, undefined, nodo(casilla)])).toBe(false);
    expect(cierraElMenu({ type: "mousedown", target: otraCosa }, [null, undefined])).toBe(true);
  });

  it("otros eventos no deciden nada, aunque traigan Escape o caigan fuera", () => {
    expect(cierraElMenu({ type: "keyup", key: "Escape" }, dentro)).toBe(false);
    expect(cierraElMenu({ type: "click", target: otraCosa }, dentro)).toBe(false);
    expect(cierraElMenu({ type: "mouseup", target: otraCosa }, dentro)).toBe(false);
  });
});

describe("posicionDelMenu: dónde se pinta el menú de una cabecera", () => {
  const ventana = { ancho: 1366, alto: 673 };

  it("con sitio debajo, abre debajo de la cabecera", () => {
    const s = posicionDelMenu({ top: 200, bottom: 230, right: 500 }, ventana);
    expect([s.top, s.bottom]).toEqual([236, "auto"]);
  });

  it("sin sitio debajo y con más arriba, abre encima", () => {
    // Debajo quedan 673 - 453 = 220; arriba, 423.
    const s = posicionDelMenu({ top: 423, bottom: 453, right: 500 }, ventana);
    expect([s.top, s.bottom]).toEqual(["auto", 673 - 423 + 6]);
  });

  it("escribe SIEMPRE top y bottom: un lado sin escribir hereda el `top` de .col-menu y se va fuera", () => {
    for (const ancla of [{ top: 200, bottom: 230, right: 500 }, { top: 423, bottom: 453, right: 500 }]) {
      const s = posicionDelMenu(ancla, ventana);
      expect(s.top).not.toBeUndefined();
      expect(s.bottom).not.toBeUndefined();
      expect([s.top, s.bottom]).toContain("auto");
    }
  });

  it("con poco sitio debajo pero aún menos arriba, abre debajo", () => {
    // Debajo 500 - 180 = 320 (menos de lo previsto), arriba 150.
    expect(posicionDelMenu({ top: 150, bottom: 180, right: 500 }, { ancho: 1366, alto: 500 }).top).toBe(186);
  });

  it("el límite: con justo lo previsto debajo, abre debajo aunque arriba haya más", () => {
    const alto = 1200;
    const bottom = alto - ALTO_PREVISTO;
    expect(posicionDelMenu({ top: bottom - 30, bottom, right: 500 }, { ancho: 1366, alto }).top).toBe(bottom + 6);
    expect(posicionDelMenu({ top: bottom - 29, bottom: bottom + 1, right: 500 }, { ancho: 1366, alto }).top).toBe("auto");
  });

  it("alineado al borde derecho de la cabecera, sin salirse de la ventana", () => {
    expect(posicionDelMenu({ top: 200, bottom: 230, right: 500 }, ventana).left).toBe(290);
    // Cabecera pegada a la izquierda: el menú no empieza fuera.
    expect(posicionDelMenu({ top: 200, bottom: 230, right: 100 }, ventana).left).toBe(8);
    // Cabecera más allá del borde derecho (tabla desplazada): el menú no acaba fuera.
    expect(posicionDelMenu({ top: 200, bottom: 230, right: 2000 }, { ancho: 800, alto: 673 }).left).toBe(800 - 210 - 8);
  });
});

// El cableado: las pruebas corren sin navegador, así que se lee el fichero. Espacios normalizados,
// para que un cambio de formato no tumbe nada.
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
function corta(texto: string, desde: string, hasta: string): string {
  const i = texto.indexOf(desde);
  if (i < 0) throw new Error(`falta el ancla: ${desde}`);
  const j = texto.indexOf(hasta, i + desde.length);
  if (j < 0) throw new Error(`falta el ancla: ${hasta}`);
  return texto.slice(i, j + hasta.length);
}

describe("OrdersTable: ordenar y filtrar al primer clic en la cabecera", () => {
  const tabla = plano(leer("src/components/OrdersTable.tsx"));

  it("el nombre de la columna abre el menú, ya no ordena directamente", () => {
    const nombre = corta(tabla, 'className="th-sort"', "</button>");
    expect(nombre).toContain("openFilterMenu(c.key)");
    expect(nombre).not.toMatch(/ordenar\(|setSort/);
  });

  it("el ▾ abre el mismo menú", () => {
    expect(corta(tabla, 'className={"th-filter-btn "', "</button>")).toContain("openFilterMenu(c.key)");
  });

  it("el menú trae ordenar ascendente, descendente y quitar el orden", () => {
    const menu = corta(tabla, 'className="col-menu-orden"', 'className="col-menu-search"');
    for (const dir of ['onOrdenar("asc")', 'onOrdenar("desc")', "onOrdenar(null)"]) expect(menu).toContain(dir);
  });

  it("el menú sabe cómo está ordenada SU columna, y ordena esa", () => {
    expect(tabla).toContain("orden={sortKey === openFilter ? sortDir : null}");
    expect(tabla).toContain("onOrdenar={(dir) => ordenar(openFilter, dir)}");
  });

  it("ordenar cierra el menú, y quitar el orden no deja la columna marcada", () => {
    const ordenar = corta(tabla, "const ordenar = (", "};");
    expect(ordenar).toContain("setOpenFilter(null)");
    expect(ordenar).toContain("setSortKey(dir ? key : null)");
  });

  it("se cierra con clic fuera o Escape, y la cabecera abierta cuenta como dentro", () => {
    const cierre = corta(tabla, "useCierraAlSalir(", "]);");
    expect(cierre).toContain("!!openFilter");
    expect(cierre).toContain("menuRef.current");
    expect(cierre).toContain("celdaRefs.current.get(openFilter)");
    // Un solo mecanismo: el oyente propio que había se fue.
    expect(tabla).not.toContain('addEventListener("mousedown"');
  });

  it("el hook va antes del return temprano (reglas de los hooks)", () => {
    expect(tabla.indexOf("useCierraAlSalir(")).toBeGreaterThan(-1);
    expect(tabla.indexOf("useCierraAlSalir(")).toBeLessThan(tabla.indexOf("if (!rows.length) return"));
  });

  it("la posición la decide posicionDelMenu, no un top sin escribir", () => {
    expect(tabla).toContain("style={posicionDelMenu(menuAnchor, { ancho: window.innerWidth, alto: window.innerHeight })}");
    expect(tabla).not.toMatch(/top: \w+ \? undefined/);
  });
});

describe("«⚙ Columnas» en Órdenes: clic fuera y Escape", () => {
  const pagina = plano(leer("src/app/(app)/page.tsx"));

  it("usa el mismo cierre, sobre el contenedor", () => {
    expect(corta(pagina, "useCierraAlSalir(", ");")).toBe("useCierraAlSalir(showCols, () => setShowCols(false), () => [colsRef.current]);");
  });

  it("el contenedor envuelve el botón Y el menú: el botón cierra su menú en vez de reabrirlo", () => {
    const bloque = corta(pagina, "<div ref={colsRef}", 'className="col-menu"');
    expect(bloque).toContain("setShowCols((s) => !s)");
  });

  it("el hook va antes del return temprano", () => {
    expect(pagina.indexOf("useCierraAlSalir(")).toBeGreaterThan(-1);
    expect(pagina.indexOf("useCierraAlSalir(")).toBeLessThan(pagina.indexOf("if (!me) return null;"));
  });
});
