import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** La etiqueta de lugar compartido y el filtro «Posibles duplicados», en el código de la pantalla. */
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");

describe("parecidos en la pantalla", () => {
  const p = leer("src/app/leads/Leads.tsx");
  it("la tarjeta pinta data-parecido con su texto en los dos idiomas, y su título lista los otros", () => {
    expect(p).toContain('<span className="chip ld-parecido" data-parecido={parecido.clase} title={otrosTabs}>{texto}</span>');
    expect(p).toContain("⚠ Possible duplicate ×${n}");
    expect(p).toContain("⚠ Posible duplicado ×${n}");
    expect(p).toContain("📍 Same location ×${n}");
    expect(p).toContain("📍 Mismo lugar ×${n}");
    expect(p).toContain("{parecido && <EtiquetaDeParecido parecido={parecido} otrosTabs={otrosTabs ?? \"\"} />}");
  });
  it("el filtro «Posibles duplicados» existe, con su cuenta, y se reinicia con «Quitar filtros»", () => {
    expect(p).toContain("data-filtro-parecidos");
    expect(p).toContain('{t("Possible duplicates", "Posibles duplicados")} <span className="ld-cuenta">{posiblesCuenta}</span>');
    expect(p).toContain("setSoloPosibles(false); setVendedorElegido");
  });
  it("los parecidos se miran en todos los leads cargados, no en la semana ni en el banco", () => {
    expect(p).toContain("const parecidos = useMemo(() => parecidosDe(leads), [leads]);");
  });
});

describe("demo: dos STXP con el mismo lugar (uno idéntico) y un tercero solo con el lugar", () => {
  it("el demo deja el 02 como posible duplicado del 01 y el 03 como mismo lugar", () => {
    const d = leer("src/lib/leads/demo.ts");
    expect(d).toContain("const ancla = leads[i1];");
    expect(d).toContain("leads[i2] = { ...leads[i2], site_address: ancla.site_address");
    expect(d).toContain("leads[i3] = { ...leads[i3], site_address: ancla.site_address };");
  });
});
