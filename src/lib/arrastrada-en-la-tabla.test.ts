import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Lo que va en el código, leído como texto: la recogida arrastrada sale en rojo claro en la tabla de paradas. */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");

describe("la tabla de paradas: la recogida de una orden arrastrada sale en rojo claro", () => {
  const pagina = plano(leer("src/app/(app)/routes/page.tsx"));

  it("lee los eventos de cada orden y pregunta de qué día viene (la regla pura)", () => {
    expect(pagina).toContain('import { arrastradaDesde } from "@/lib/arrastrada-de-otro-dia";');
    expect(pagina).toContain("const eventosPorOrden = useMemo(");
    expect(pagina).toContain("const de = arrastradaDesde(x, eventosPorOrden.get(x.id) ?? []);");
  });

  it("la recogida pendiente lleva data-arrastrada y su aviso en el title; la ya hecha, data-arrastrada", () => {
    expect(pagina).toContain("const arrastradaDeLaRecogida = arrastreDeLaFila(suyas);");
    expect(pagina).toContain("data-arrastrada={arrastradaDeLaRecogida?.fechas}");
    expect(pagina).toContain("title={arrastradaDeLaRecogida ? `${arrastradaDeLaRecogida.texto} — ${t(\"Show this stop on the map\"");
    expect(pagina).toContain('data-arrastrada={fp.tipo === "P" ? arrastreDeLaFila([d])?.fechas : undefined}');
  });

  it("el aviso dice «Viene arrastrada del <fecha>: <códigos>» y «Carried over from»", () => {
    expect(pagina).toContain('t("Carried over from", "Viene arrastrada del")');
    expect(pagina).toContain("${de}: ${codigos.join(\", \")}");
  });
});

describe("globals.css: el rojo claro de la recogida arrastrada", () => {
  const css = plano(leer("src/app/globals.css"));

  it("tiene su token en el bloque claro (junto al verde) y su par oscuro en el oscuro", () => {
    const claro = css.indexOf("--plan-recoger-arrastrada-bg: #fbe9e9;");
    const verdeClaro = css.indexOf("--plan-recoger-bg: #eef9f2;");
    const amarilloClaro = css.indexOf("--plan-entregar-bg: #fff9e0;");
    expect(claro).toBeGreaterThan(verdeClaro);
    expect(claro).toBeLessThan(amarilloClaro);
    const oscuro = css.indexOf("--plan-recoger-arrastrada-bg: #3a1f22;");
    expect(oscuro).toBeGreaterThan(css.indexOf("--plan-recoger-bg: #172a21;"));
  });

  it("la regla pinta el fondo de la fila con el token, después de las verdes", () => {
    const regla = "table.orders tr[data-arrastrada] td { background: var(--plan-recoger-arrastrada-bg); }";
    expect(css).toContain(regla);
    expect(css.indexOf(regla)).toBeGreaterThan(css.indexOf("table.orders tr.fila-grupo-recoger td { background: var(--plan-recoger-bg); }"));
  });
});
