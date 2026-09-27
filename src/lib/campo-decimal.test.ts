import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aTexto, leeDecimal, limpiaDecimal, textoAPintar } from "./campo-decimal";

/** Lo que hace el campo con cada tecla: limpia, guarda lo tecleado, sube el número y pinta. */
function teclea(teclas: string, inicial: number | null = null): { pintado: string; valor: number | null } {
  let tecleado = aTexto(inicial);
  let valor = inicial;
  for (const tecla of teclas) {
    const t = limpiaDecimal(textoAPintar(tecleado, valor) + tecla);
    tecleado = t;
    valor = leeDecimal(t);
  }
  return { pintado: textoAPintar(tecleado, valor), valor };
}

describe("campo decimal (D-NEXT): el punto no se pierde al teclear", () => {
  it("se teclea 23.80 tecla a tecla y queda 23.8, pintado tal cual", () => {
    expect(teclea("23.80")).toEqual({ pintado: "23.80", valor: 23.8 });
  });
  it("1.89, 0.5 y .5", () => {
    expect(teclea("1.89").valor).toBe(1.89);
    expect(teclea("0.5").valor).toBe(0.5);
    expect(teclea(".5")).toEqual({ pintado: ".5", valor: 0.5 });
  });
  it("con el punto recién tecleado, el punto sigue en pantalla", () => {
    expect(teclea("23.")).toEqual({ pintado: "23.", valor: 23 });
  });
  it("lo que no es número no entra; un segundo punto tampoco", () => {
    expect(teclea("1a2.3.4$")).toEqual({ pintado: "12.34", valor: 12.34 });
  });
  it("comas de miles: 1,250 es 1250", () => {
    expect(teclea("1,250")).toEqual({ pintado: "1,250", valor: 1250 });
  });
  it("vacío es null", () => {
    expect(leeDecimal("")).toBeNull();
    expect(leeDecimal(".")).toBeNull();
    expect(leeDecimal("-")).toBeNull();
  });
  it("si el valor cambia desde fuera (el catálogo rellena el precio), se pinta el valor nuevo", () => {
    expect(textoAPintar("1.", 2.35)).toBe("2.35");
    expect(textoAPintar("4.5", null)).toBe("");
  });
});

describe("las pantallas lo usan", () => {
  const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\s+/g, " ");
  it("el Estimador: los 7 campos de número van por `CampoDecimal` y ninguno pinta `String(n)` a mano", () => {
    const f = leer("src/app/estimator/Estimador.tsx");
    expect(f.match(/<CampoDecimal /g)?.length).toBe(7);
    for (const campo of ["requested_sf", "sf_per_box", "boxes", "price_per_sf", "quantity", "unit_price"]) {
      expect(f).toContain(`onValor={(n) => setLinea(l.id, { ${campo}: n })}`);
    }
    expect(f).toContain("onValor={(n) => setEntrega({ charge: n })}");
    expect(f).not.toMatch(/value=\{num\(/);
  });
  it("el campo pinta lo tecleado mientras diga el mismo número", () => {
    const c = leer("src/components/CampoDecimal.tsx");
    expect(c).toContain("value={textoAPintar(tecleado, value)}");
    expect(c).toContain('type="text"');
  });
  it("la ficha de la orden: los campos de número (cargo, pallets) aceptan decimales", () => {
    const m = leer("src/components/OrderModal.tsx");
    expect(m).toContain('step={type === "number" ? "any" : undefined}');
    expect(m).toContain('<input type="number" min={1} step="any" value={pickupPallets}');
    expect(m).toContain('<input type="number" min={1} step="any" autoFocus value={readyPallets}');
  });
});
