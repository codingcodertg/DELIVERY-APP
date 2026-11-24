import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").replace(/\r\n/g, "\n");
const css = leer("src/app/leads/leads.css");
const tsx = leer("src/app/leads/Leads.tsx");

const ETAPAS = ["new", "made_contact", "no_answer", "appointment", "quote", "negotiation", "closed", "lost", "bad_lead"] as const;

describe("Leads.tsx: la franja solo en las tarjetas ya trabajadas", () => {
  it("la franja (data-franja-vendedor) se pinta solo cuando el lead tiene quién lo trabajó y cuándo", () => {
    expect(tsx).toContain("const trabajado = !!l.last_by && !!l.last_at;");
    expect(tsx).toMatch(/\{trabajado && \(\s*<div className="ld-franja" data-franja-vendedor data-etapa-franja=\{etapa\}>/);
    expect(tsx).toContain('<b data-ultimo-contacto>👤 {l.last_by_name ?? "—"}</b>');
    expect(tsx).toContain("<span data-pildora-etapa-texto={etapa}>{etapaIcono(etapa)} {etapaLabel(etapa, lang)}</span>");
  });

  it("sin trabajar, la cabecera de siempre: la píldora de etapa y, si la hay, el último contacto", () => {
    expect(tsx).toMatch(/\{!trabajado && \(\s*<div className="ld-cabeza-der">\s*<PildoraEtapa e=\{etapa\} \/>/);
  });
});

describe("leads.css: la franja se pinta con el color de su etapa", () => {
  it("los nueve tokens --etapa-<etapa> y su tinta existen con color hex", () => {
    for (const e of ETAPAS) {
      expect(css).toMatch(new RegExp(`--etapa-${e}:\\s*#[0-9a-fA-F]{6};`));
      expect(css).toMatch(new RegExp(`--etapa-${e}-tinta:\\s*#[0-9a-fA-F]{6};`));
    }
  });

  it("cada una de las nueve etapas fija --e y --e-tinta para la franja, desde sus tokens", () => {
    for (const e of ETAPAS) {
      expect(css, e).toMatch(new RegExp(
        `\\.leads-app \\.ld-franja\\[data-etapa-franja="${e}"\\][^{]*\\{ --e: var\\(--etapa-${e}\\); --e-tinta: var\\(--etapa-${e}-tinta\\); \\}`,
      ));
    }
  });

  it("una sola regla pinta la franja con --e y --e-tinta", () => {
    expect(css).toMatch(/\.leads-app \.ld-franja\[data-etapa-franja\] \{ background: var\(--e\); color: var\(--e-tinta\); \}/);
  });

  it("la base de la franja (la que se ve antes de la etapa) tiene su fondo y tinta neutros", () => {
    expect(css).toMatch(/\.leads-app \.ld-franja \{[^}]*background:\s*var\(--accent\);\s*color:\s*var\(--card\);/);
  });

  it("ya no hay atributo data-color-vendedor ni tokens --vendedor-", () => {
    expect(css).not.toContain("data-color-vendedor");
    expect(css).not.toContain("--vendedor-");
  });
});

describe("sin rastro del color de vendedor en src/app/leads ni src/lib/leads", () => {
  const PROHIBIDO = [
    "data-color-vendedor",
    "--vendedor-",
    "colorDeVendedor",
    "COLORES_DE_VENDEDOR",
    "puestosDeVendedores",
    'rpc("leads_colores_de_vendedores")',
    "colorVendedor",
  ];
  const ESTE = "src/lib/leads/franja-del-vendedor.test.ts";

  const archivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((nombre) => {
      const ruta = join(dir, nombre);
      return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
    });

  it("ni el atributo, ni los tokens, ni la llamada a la base, ni la función del color", () => {
    const fuentes = [...archivos(join(process.cwd(), "src/app/leads")), ...archivos(join(process.cwd(), "src/lib/leads"))]
      .filter((ruta) => /\.(ts|tsx|css)$/.test(ruta))
      .filter((ruta) => relative(process.cwd(), ruta).replace(/\\/g, "/") !== ESTE);
    expect(fuentes.length).toBeGreaterThan(5);
    for (const ruta of fuentes) {
      const texto = readFileSync(ruta, "utf8");
      for (const token of PROHIBIDO) expect(texto, `${ruta}: ${token}`).not.toContain(token);
    }
  });
});
