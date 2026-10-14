import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BORRAR_BUSQUEDA, BUSQUEDA_VACIA, hayTextoQueBorrar } from "./buscador";

// D-546. «when i search orders it would be easier to have an x to clear instead of having to backspace».
const leer = (ruta: string) => readFileSync(ruta, "utf8").split("\r\n").join("\n");

describe("la «✕» del buscador", () => {
  it("se enseña con cualquier texto, también solo espacios, y no con el campo vacío", () => {
    expect(hayTextoQueBorrar("abc")).toBe(true);
    expect(hayTextoQueBorrar(" ")).toBe(true);
    expect(hayTextoQueBorrar("")).toBe(false);
    expect(hayTextoQueBorrar(null)).toBe(false);
  });

  it("deja la búsqueda vacía, y su etiqueta accesible está en los dos idiomas", () => {
    expect(BUSQUEDA_VACIA).toBe("");
    expect(BORRAR_BUSQUEDA).toEqual({ en: "Clear search", es: "Borrar búsqueda" });
  });
});

describe("el componente (anclas de fuente)", () => {
  const comp = leer("src/components/BuscadorConBorrar.tsx");

  it("pinta la «✕» solo cuando `hayTextoQueBorrar`, con su etiqueta, y al pulsarla vacía y devuelve el foco", () => {
    expect(comp).toContain("{hayTextoQueBorrar(valor) && (");
    expect(comp).toContain("aria-label={t(BORRAR_BUSQUEDA.en, BORRAR_BUSQUEDA.es)}");
    expect(comp).toContain("onClick={() => { onValor(BUSQUEDA_VACIA); propio.current?.focus(); }}");
    expect(comp).toContain("onMouseDown={(e) => e.preventDefault()}");
    // Sin colores en `style`: los pone la clase de globals.css.
    expect(comp).not.toMatch(/style=\{\{[^}]*(#|rgb|var\(--)/);
  });

  it("las tres búsquedas de órdenes lo usan: Órdenes, las tablas del Gestor y Almacén", () => {
    expect(leer("src/app/(app)/page.tsx")).toContain("<BuscadorConBorrar\n          ref={searchRef}");
    expect(leer("src/app/(app)/routes/page.tsx")).toContain("<BuscadorConBorrar\n            valor={vista.busqueda}\n            onValor={vista.onBusqueda}");
    expect(leer("src/components/FiltrosDeAlmacen.tsx")).toContain("valor={filtro.q}\n        onValor={(q) => onCambio({ ...filtro, q })}");
  });
});
