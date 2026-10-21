import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ASOMO_EN_LA_LISTA, asomoDelMensaje, asomoEnLaLista } from "./help-requests";

// D-624 (2026-10-21) · Roberto (admin): «Was better when the requests showed a bit of the sentence to know what each was
// talking about without having to open 1 by 1».

const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("lo que la fila enseña del mensaje", () => {
  it("el principio, en una línea, cortado con «…» al tope de la lista", () => {
    expect(asomoEnLaLista("No carga\n\nel   mapa")).toBe("No carga el mapa");
    const largo = "palabra ".repeat(60);
    const corte = asomoEnLaLista(largo)!;
    expect(corte.length).toBe(ASOMO_EN_LA_LISTA);
    expect(corte.endsWith("…")).toBe(true);
    expect(ASOMO_EN_LA_LISTA).toBeGreaterThan(60);
  });

  it("sin las líneas de recuadros sin describir; los descritos se quedan, en su orden", () => {
    const m = "El botón no guarda\n\n1) (no description)\n2) aquí sale el error\n3) (sin descripción)";
    expect(asomoEnLaLista(m)).toBe("El botón no guarda 2) aquí sale el error");
  });

  it("si solo había capturas sin describir, `null` (la pantalla dice «solo captura»)", () => {
    expect(asomoEnLaLista("1) (no description)")).toBeNull();
    expect(asomoEnLaLista("1) (No Description)\n2) (sin descripción)\n")).toBeNull();
    expect(asomoEnLaLista("")).toBeNull();
    expect(asomoEnLaLista(null)).toBeNull();
  });

  it("no toca el asomo del aviso al remitente (60, con las líneas tal cual)", () => {
    expect(asomoDelMensaje("1) (no description)")).toBe("1) (no description)");
  });
});

describe("puerta: la bandeja pinta la línea en cada solicitud cerrada, y pulsarla la abre", () => {
  const pagina = leer("src/app/home/solicitudes-de-ayuda/page.tsx");
  it("usa asomoEnLaLista, solo cerrada, con el respaldo de «solo captura», y abre al pulsar", () => {
    expect(pagina).toContain("const asomo = asomoEnLaLista(s.message);");
    expect(pagina).toContain("{!abiertaEsta && (");
    expect(pagina).toContain('<button type="button" className="asomo-solicitud" data-asomo-solicitud');
    expect(pagina).toContain("onClick={() => { setAbierta(s.id);");
    expect(pagina).toContain('{asomo ?? <span className="hint" style={{ margin: 0 }}>📷 {t("Screenshot only, no text", "Solo captura, sin texto")}</span>}');
  });
  it("una sola línea con «…» en globals.css", () => {
    const css = leer("src/app/globals.css");
    const regla = css.slice(css.indexOf(".asomo-solicitud {"), css.indexOf("}", css.indexOf(".asomo-solicitud {")));
    expect(regla).toContain("white-space: nowrap; overflow: hidden; text-overflow: ellipsis;");
  });
});
