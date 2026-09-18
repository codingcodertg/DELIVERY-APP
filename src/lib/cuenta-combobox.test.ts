import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decisionAlConfirmar, hayQueAvisar, siguienteIndice, sugerenciasPara } from "./account-combobox";
import { cuentasQueCoinciden } from "./account-search";

/**
 * El campo de cuenta es UN solo control que busca y sugiere (D-NEXT).
 *
 * El dueño, con captura: «a search bar that autopopulates automatically when you start typing, so it
 * will be a search and dropdown in the same field». D-299 tenía dos controles y se veían los dos.
 *
 * Lo que decide algo —qué se elige al confirmar, cuándo se avisa al formulario— se prueba importado.
 * Lo que solo pinta, con el fichero.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const modal = leer("src/components/OrderModal.tsx");
const combo = modal.slice(modal.indexOf("function AccountCombo"), modal.indexOf("/** Delivery Time Windows"));
const CUENTAS = ["Acme Tile", "Ángel Construcción", "Bravo Homes", "Elite Floors", "Elite Stone"];

describe("qué se elige al confirmar", () => {
  it("la sugerencia resaltada con las flechas manda sobre lo escrito", () => {
    expect(decisionAlConfirmar({ texto: "eli", sugerencias: ["Elite Floors", "Elite Stone"], activo: 1 }))
      .toEqual({ origen: "lista", valor: "Elite Stone" });
  });

  it("sin resaltado, teclear el nombre completo cuenta como elegirlo, sin importar mayúsculas ni espacios", () => {
    expect(decisionAlConfirmar({ texto: "  elite floors ", sugerencias: ["Elite Floors", "Elite Stone"], activo: -1 }))
      .toEqual({ origen: "lista", valor: "Elite Floors" });
  });

  it("un texto que no está en la lista es una cuenta manual con ese nombre, sin botón aparte", () => {
    expect(decisionAlConfirmar({ texto: "Cliente Nuevo", sugerencias: [], activo: -1 }))
      .toEqual({ origen: "manual", valor: "Cliente Nuevo" });
    // Un prefijo que coincide con varias NO se elige solo: sería adivinar cuál.
    expect(decisionAlConfirmar({ texto: "eli", sugerencias: ["Elite Floors", "Elite Stone"], activo: -1 }))
      .toEqual({ origen: "manual", valor: "eli" });
  });

  it("borrar todo deja la orden sin cuenta", () => {
    expect(decisionAlConfirmar({ texto: "   ", sugerencias: CUENTAS, activo: -1 })).toEqual({ origen: "vacio", valor: "" });
  });

  it("un índice fuera de rango no elige nada de la lista", () => {
    expect(decisionAlConfirmar({ texto: "x", sugerencias: ["A"], activo: 5 })).toEqual({ origen: "manual", valor: "x" });
  });
});

describe("las flechas", () => {
  it("bajan desde «ninguna» a la primera, suben a la última, y dan la vuelta", () => {
    expect(siguienteIndice(-1, 3, 1)).toBe(0);
    expect(siguienteIndice(-1, 3, -1)).toBe(2);
    expect(siguienteIndice(2, 3, 1)).toBe(0);
    expect(siguienteIndice(0, 3, -1)).toBe(2);
  });

  it("sin sugerencias no hay a dónde ir", () => {
    expect(siguienteIndice(-1, 0, 1)).toBe(-1);
    expect(siguienteIndice(3, 0, -1)).toBe(-1);
  });
});

describe("cuándo se avisa al formulario", () => {
  it("solo si el valor cambió: confirmar lo que ya estaba no reescribe contacto ni tipo", () => {
    expect(hayQueAvisar("Acme Tile", "Acme Tile")).toBe(false);
    expect(hayQueAvisar("Acme Tile", "Bravo Homes")).toBe(true);
    expect(hayQueAvisar(null, "")).toBe(false);
    expect(hayQueAvisar("Acme Tile", "")).toBe(true);
  });
});

describe("las sugerencias", () => {
  it("son el mismo filtro de D-299, y con el campo vacío salen todas", () => {
    expect(sugerenciasPara(CUENTAS, "elite")).toEqual(cuentasQueCoinciden(CUENTAS, "elite"));
    expect(sugerenciasPara(CUENTAS, "")).toEqual(CUENTAS);
  });

  it("y la cuenta ya puesta no desaparece aunque no coincida", () => {
    expect(sugerenciasPara(CUENTAS, "zzz", "Bravo Homes")).toEqual(["Bravo Homes"]);
  });
});

describe("el formulario", () => {
  it("es un solo control: un input combobox con su listbox, sin el select ni el filtro de D-299", () => {
    expect(combo).toContain('role="combobox"');
    expect(combo).toContain('role="listbox"');
    expect(combo).not.toContain("<select");
    expect(combo).not.toContain("NEW_ACCOUNT");
    expect(combo).not.toContain('"Type to filter…"');
    expect(modal).not.toContain('const NEW_ACCOUNT = "__new__";');
  });

  it("`on` se dispara al confirmar o al elegir, nunca en el onChange del input", () => {
    const onChange = combo.slice(combo.indexOf("onChange={(e) =>"), combo.indexOf("onBlur="));
    expect(onChange).not.toContain("on(");
    expect(combo).toContain("if (hayQueAvisar(current, d.valor)) on(d.valor);");
    expect(combo).toContain("if (hayQueAvisar(current, v)) on(v);");
    expect(combo).toContain('else if (e.key === "Enter") { e.preventDefault(); confirmar(); }');
    expect(combo).toContain("onBlur={() => { if (abierto) confirmar(); }}");
  });

  it("elegir con el ratón va en mousedown, que llega antes del blur", () => {
    expect(combo).toContain("onMouseDown={(e) => { e.preventDefault(); elegir(o); }}");
  });

  it("se cierra al hacer clic fuera con el mismo hook que el menú de columnas", () => {
    expect(combo).toContain("useCierraAlSalir(abierto, () => { setAbierto(false); setActivo(-1); }, () => [caja.current]);");
  });

  it("si la orden cambia de cuenta por fuera, el campo la sigue", () => {
    expect(combo).toContain("useEffect(() => { setTexto(current); }, [current]);");
  });
});
