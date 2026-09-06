import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { textoAPelo, fuenteSinTraducido } from "./i18n-guard";
import { ERP_MESSAGES, failText, mensajeTexto, rellenar, type ErpCode } from "./messages";

// G-10 (D-203). El ERP se traduce con pares inline (usePrefs().t(en, es)), no con claves, así que
// la red automática no puede ser "cada clave existe en los dos idiomas" (D-187). Es la contraria:
// en cada fichero YA traducido no queda texto de pantalla a pelo. Lo mide una regex sobre el fuente
// (i18n-guard.ts), que primero se prueba a sí misma con dos fixtures.

const A_PELO = `
export function Demo({ busy, n }: { busy: boolean; n: number }) {
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const parentRef = useRef<HTMLDivElement>(null);
  const ok = n > 0 ? "+" : "";
  return (
    <div>
      <h2 className="text-sm">Needs review</h2>
      <input placeholder="Search name, SKU, vendor…" aria-label="Select all" />
      <button onClick={() => setRows([])}>{busy ? "Saving…" : "Save changes"}</button>
      <span>{ok}</span>
      <span>SKU</span>
      <span>—</span>
      <p>
        Nothing flagged here.
      </p>
    </div>
  );
}
`;

const LIMPIO = `
export function Demo({ busy, n }: { busy: boolean; n: number }) {
  const { t } = usePrefs();
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const parentRef = useRef<HTMLDivElement>(null);
  const ok = n > 0 ? "+" : "";
  const headers = ["SKU", "Needs review", "SEO title"];
  return (
    <div>
      <h2 className="text-sm">{t("Needs review", "Requiere revisión")}</h2>
      <input placeholder={t("Search name, SKU, vendor…", "Buscar nombre, SKU, proveedor…")} aria-label={t("Select all", "Seleccionar todo")} />
      <button onClick={() => setRows([])}>{busy ? t("Saving…", "Guardando…") : t("Save changes", "Guardar cambios")}</button>
      <span>{ok}</span>
      <span>SKU</span>
      <span>—</span>
      <p>
        {t(\`Nothing flagged here. \${n}\`, \`Nada marcado aquí. \${n}\`)}
      </p>
      <h3><Tx en="Needs review" es="Requiere revisión" /></h3>
    </div>
  );
}
`;

describe("el guardián se prueba a sí mismo", () => {
  it("en el fixture a pelo encuentra los cinco textos, y ninguno de los que no son texto", () => {
    const h = textoAPelo(A_PELO);
    const textos = h.map((x) => x.texto).sort();
    expect(textos).toEqual([
      "Needs review", "Nothing flagged here.", "Save changes", "Saving…", "Search name, SKU, vendor…", "Select all",
    ].sort());
    // Ni el genérico useState<CatalogRow[]>, ni useRef<HTMLDivElement>(null), ni "n > 0", ni SKU, ni "—".
    expect(h.some((x) => /CatalogRow|HTMLDivElement|null\)|^0 \?/.test(x.texto))).toBe(false);
  });
  it("en el fixture limpio no encuentra nada: los t() se quitan antes de mirar", () => {
    expect(textoAPelo(LIMPIO)).toEqual([]);
    expect(fuenteSinTraducido(LIMPIO)).not.toContain("Requiere revisión");
  });
});

// Un fichero entra aquí cuando se traduce. La prueba exige (a) que use usePrefs, y (b) que el
// guardián no encuentre nada. Mutación: volver a poner un texto a pelo en cualquiera de ellos
// rompe la prueba nombrando fichero, línea y texto.
// product/[id]/page.tsx es un server component: no usa usePrefs porque ya no pinta texto (se fue a
// product-detail.tsx). Se mide igual, sin exigir usePrefs.
describe("los server components del ERP que ya no pintan texto", () => {
  for (const ruta of ["src/app/erp/product/[id]/page.tsx"]) {
    it(`${ruta} — 0 textos a pelo`, () => {
      const h = textoAPelo(readFileSync(join(process.cwd(), ruta), "utf8"));
      expect(h.map((x) => `${ruta}:${x.linea} [${x.tipo}] ${x.texto}`)).toEqual([]);
    });
  }
});

describe("los ficheros del ERP ya traducidos no tienen texto de pantalla a pelo", () => {
  const ficheros: string[] = [
    "src/components/erp/side-nav.tsx",
    "src/components/erp/catalog-table.tsx",
    "src/components/erp/review-queue.tsx",
    "src/components/erp/product-detail.tsx",
    "src/components/erp/inventory-console.tsx",
    "src/components/erp/po-ingest.tsx",
    "src/components/erp/po-reconcile.tsx",
    "src/components/erp/item/verified-badge.tsx",
    "src/components/erp/receiving.tsx",
    "src/components/erp/po-upload.tsx",
    "src/components/erp/request-form.tsx",
    "src/components/erp/master-round-trip.tsx",
    "src/app/erp/purchasing/orders/page.tsx",
    "src/components/erp/charts.tsx",
    "src/app/erp/dashboard/page.tsx",
    "src/app/erp/analytics/categories/page.tsx",
    "src/app/erp/analytics/vendors/page.tsx",
    "src/components/erp/purchasing-groups.tsx",
    "src/app/erp/analytics/stores/page.tsx",
    "src/components/erp/bulk-bar.tsx",
    "src/components/erp/product-drawer.tsx",
    "src/components/erp/uom-assistant.tsx",
    "src/components/erp/decisions-upload.tsx",
    "src/components/erp/request-review.tsx",
    "src/app/erp/analytics/salespeople/page.tsx",
    "src/components/erp/reorder-panel.tsx",
    "src/app/erp/review/daltile/page.tsx",
    "src/components/erp/item/qoh-panel.tsx",
    "src/components/erp/merge-tool.tsx",
    "src/components/erp/po-draft-panel.tsx",
    "src/components/erp/product-family.tsx",
    "src/components/erp/daltile-card.tsx",
    "src/components/erp/item/product-gallery.tsx",
    "src/components/erp/po-line-link.tsx",
    "src/components/erp/seo-editor.tsx",
    "src/app/erp/purchasing/orders/[id]/page.tsx",
    "src/app/erp/request/page.tsx",
    "src/app/erp/review/merge/page.tsx",
    "src/app/erp/decisions/page.tsx",
    "src/app/erp/purchasing/receiving/page.tsx",
    "src/components/erp/saved-views.tsx",
    "src/app/erp/purchasing/categories/page.tsx",
    "src/app/erp/purchasing/orders/new/page.tsx",
    "src/app/erp/purchasing/page.tsx",
    "src/components/erp/catalog-cards.tsx",
    "src/components/erp/item/suggest-fix-button.tsx",
    "src/app/erp/catalog/page.tsx",
    "src/app/erp/inventory/page.tsx",
    "src/app/erp/master/page.tsx",
    "src/app/erp/requests/page.tsx",
    "src/app/erp/review/page.tsx",
    "src/app/erp/po-upload/page.tsx",
    "src/components/erp/category-cards.tsx",
    "src/components/erp/item/pricing-bar.tsx",
    "src/components/erp/publish-button.tsx",
    "src/components/erp/analytics-nav.tsx",
    "src/components/erp/analytics-controls.tsx",
  ];

  // Excepciones EXPLÍCITAS, texto por texto: lo que <Tx> no puede pintar en un server component (un
  // atributo title/placeholder). Cada una está dicha en la decisión; añadir aquí es decidir, no callar.
  const excepciones: Record<string, string[]> = {
    "src/app/erp/purchasing/orders/page.tsx": [
      "merchandise vs PO (excl. tax &amp; freight)", // title de la cabecera Gap
      "merchandise vs PO (excl. tax & freight)", // title de la celda Gap
    ],
    "src/app/erp/purchasing/orders/[id]/page.tsx": [
      "Purchase order PDF", // title del iframe del documento
      "Acknowledgment PDF",
    ],
  };

  for (const ruta of ficheros) {
    it(`${ruta.split("/").pop()} — usa usePrefs y no deja texto fijo`, () => {
      const src = readFileSync(join(process.cwd(), ruta), "utf8");
      // De cliente: usePrefs(). Server component (5b): la hoja <Tx en es />.
      expect(src, `${ruta} no usa usePrefs() ni <Tx>`).toMatch(/usePrefs\(\)|<Tx /);
      const permitidos = new Set(excepciones[ruta] ?? []);
      const h = textoAPelo(src).filter((x) => !permitidos.has(x.texto));
      expect(h.map((x) => `${ruta}:${x.linea} [${x.tipo}] ${x.texto}`)).toEqual([]);
    });
  }
});

// ---- G-10b: los mensajes del servidor viajan como código y se traducen en el cliente ------------
//
// `lib/erp/actions.ts` y `lib/erp/domain/po-parse.ts` no fabrican texto de pantalla: devuelven
// `fail("CÓDIGO")` / `warnings.push({ code })`, y el par en/es vive en `lib/erp/messages.ts`. Esto
// mide las tres cosas que pueden romperse por separado: que el servidor no vuelva a escribir una
// frase; que cada código emitido tenga par (y ningún par sobre: §15, literal y construido); y que
// cada componente que pinta esos fallos pase por `failText` / `mensajeTexto`, no por `res.error`.

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");
const ACTIONS = "src/lib/erp/actions.ts";
const PO_PARSE = "src/lib/erp/domain/po-parse.ts";

/** Los códigos que emite el fuente, en su forma literal. */
function codigosEmitidos(): { codigo: string; donde: string }[] {
  const out: { codigo: string; donde: string }[] = [];
  const recoger = (ruta: string, re: RegExp) => {
    const src = leer(ruta);
    const lineas = src.split("\n");
    lineas.forEach((l, i) => {
      for (const m of l.matchAll(re)) out.push({ codigo: m[1], donde: `${ruta}:${i + 1}` });
    });
  };
  recoger(ACTIONS, /\bfail\("([A-Z_]+)"/g);
  recoger(PO_PARSE, /warnings\.push\(\{ code: "([A-Z_]+)"/g);
  return out;
}

/** Códigos sin par completo en un mapa: es lo que la prueba de mutación tiene que nombrar. */
function sinPar(codigos: string[], mapa: Record<string, { en?: string; es?: string } | undefined>): string[] {
  return [...new Set(codigos)].filter((c) => !mapa[c]?.en || !mapa[c]?.es);
}

const marcadores = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe("G-10b · lib/erp no fabrica texto de pantalla", () => {
  for (const ruta of [ACTIONS, PO_PARSE]) {
    it(`${ruta} — 0 textos a pelo y ningún t()`, () => {
      const src = leer(ruta);
      expect(textoAPelo(src).map((x) => `${ruta}:${x.linea} [${x.tipo}] ${x.texto}`)).toEqual([]);
      expect(src, "el servidor no traduce: no sabe el idioma").not.toMatch(/\bt\(\s*["'`]/);
    });
  }
  it("los códigos van siempre literales (§15: nada de fail(variable) ni push({ code: variable }))", () => {
    expect(leer(ACTIONS)).not.toMatch(/\bfail\((?!")/);
    expect(leer(PO_PARSE)).not.toMatch(/warnings\.push\((?!\{ code: ")/);
  });
});

describe("G-10b · cada código emitido tiene su par, y ningún par sobra", () => {
  const emitidos = codigosEmitidos();
  const codigos = [...new Set(emitidos.map((e) => e.codigo))];

  it("el inventario medido: 13 sitios en actions.ts (11 códigos) y 6 en po-parse.ts (5 códigos)", () => {
    const enActions = emitidos.filter((e) => e.donde.startsWith(ACTIONS));
    const enParse = emitidos.filter((e) => e.donde.startsWith(PO_PARSE));
    expect(enActions).toHaveLength(13);
    expect(new Set(enActions.map((e) => e.codigo)).size).toBe(11);
    expect(enParse).toHaveLength(6);
    expect(new Set(enParse.map((e) => e.codigo)).size).toBe(5);
  });

  for (const e of emitidos) {
    it(`${e.donde} → ${e.codigo} tiene en y es distintos, con los mismos {datos}`, () => {
      const par = ERP_MESSAGES[e.codigo as ErpCode];
      expect(par, `${e.codigo} no está en ERP_MESSAGES`).toBeDefined();
      expect(par.en.trim().length).toBeGreaterThan(0);
      expect(par.es.trim().length).toBeGreaterThan(0);
      expect(par.en).not.toBe(par.es);
      expect(marcadores(par.es)).toEqual(marcadores(par.en));
    });
  }

  it("ningún par sin emisor (un código que nadie devuelve es texto muerto)", () => {
    const sobran = Object.keys(ERP_MESSAGES).filter((k) => !codigos.includes(k));
    expect(sobran).toEqual([]);
  });

  it("los que llevan datos declaran los {marcadores} que el servidor manda", () => {
    expect(marcadores(ERP_MESSAGES.PDF_READ_FAILED.en)).toEqual(["{detail}"]);
    expect(marcadores(ERP_MESSAGES.TOTAL_MISMATCH.en)).toEqual(["{sum}", "{total}"]);
    expect(leer(ACTIONS)).toMatch(/fail\("PDF_READ_FAILED", \{ detail: /);
    expect(leer(PO_PARSE)).toMatch(/code: "TOTAL_MISMATCH", params: \{ sum: [^}]*, total: /);
  });

  it("mutación: quitar un par cae nombrando el código", () => {
    expect(sinPar(codigos, ERP_MESSAGES)).toEqual([]);
    const sinPdf = { ...ERP_MESSAGES, NO_PDF_FILE: undefined };
    expect(sinPar(codigos, sinPdf)).toEqual(["NO_PDF_FILE"]);
    const sinEs = { ...ERP_MESSAGES, TOTAL_MISMATCH: { en: ERP_MESSAGES.TOTAL_MISMATCH.en, es: "" } };
    expect(sinPar(codigos, sinEs)).toEqual(["TOTAL_MISMATCH"]);
  });
});

describe("G-10b · el texto se rellena en el cliente, y lo de Supabase pasa tal cual", () => {
  const es = (_en: string, es: string) => es;
  const en = (en: string) => en;
  it("rellenar: cada {clave} con su dato; sin dato, vacío y sin llaves", () => {
    expect(rellenar("a {x} b {y}", { x: "1", y: "2" })).toBe("a 1 b 2");
    expect(rellenar("a {x} b", undefined)).toBe("a  b");
  });
  it("mensajeTexto usa el par del código en el idioma de t", () => {
    expect(mensajeTexto({ code: "TOTAL_MISMATCH", params: { sum: "10.00", total: "12.00" } }, es))
      .toBe("Las líneas suman 10.00 pero el total del documento es 12.00 — revísalo.");
    expect(mensajeTexto({ code: "NOT_SIGNED_IN" }, en)).toBe("Not signed in");
  });
  it("failText: con código, el par; con error, el mensaje del servidor letra por letra", () => {
    expect(failText({ code: "PDF_READ_FAILED", params: { detail: "bad xref" } }, en)).toBe("Couldn't read the PDF: bad xref");
    expect(failText({ error: 'duplicate key value violates unique constraint "products_sku_key"' }, es))
      .toBe('duplicate key value violates unique constraint "products_sku_key"');
  });
});

describe("G-10b · los componentes que pintan esos fallos pasan por failText / mensajeTexto", () => {
  // Los 17 que consumen una acción que puede devolver un código. Los que consumen solo acciones
  // con `error.message` de Supabase (catalog-table, decisions-upload, master-round-trip) no están:
  // el tipo de esas acciones no lleva código y tsc no les exige nada.
  const pintores = [
    "src/components/erp/bulk-bar.tsx",
    "src/components/erp/inventory-console.tsx",
    "src/components/erp/item/suggest-fix-button.tsx",
    "src/components/erp/merge-tool.tsx",
    "src/components/erp/po-draft-panel.tsx",
    "src/components/erp/po-ingest.tsx",
    "src/components/erp/po-line-link.tsx",
    "src/components/erp/po-upload.tsx",
    "src/components/erp/product-drawer.tsx",
    "src/components/erp/product-family.tsx",
    "src/components/erp/publish-button.tsx",
    "src/components/erp/receiving.tsx",
    "src/components/erp/request-form.tsx",
    "src/components/erp/request-review.tsx",
    "src/components/erp/review-queue.tsx",
    "src/components/erp/seo-editor.tsx",
    "src/components/erp/uom-assistant.tsx",
  ];
  for (const ruta of pintores) {
    it(`${ruta.split("/").pop()} — importa de messages y no pinta res.error a pelo`, () => {
      const src = leer(ruta);
      expect(src).toMatch(/from "@\/lib\/erp\/messages"/);
      expect(src).toMatch(/\b(failText|mensajeTexto)\(/);
      expect(src).not.toMatch(/\b(setErr|setErrMsg|setMsg)\(res\.error\b|text: res\.error\b|res\.error \?\?/);
    });
  }
  it("po-ingest traduce los avisos del parser en el único sitio que los pinta", () => {
    expect(leer("src/components/erp/po-ingest.tsx")).toMatch(/doc\.warnings\.map\(\(w\) => mensajeTexto\(w, t\)\)/);
  });
});
