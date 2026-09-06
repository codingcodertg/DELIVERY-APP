import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { textoAPelo, fuenteSinTraducido } from "./i18n-guard";

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
  ];

  for (const ruta of ficheros) {
    it(`${ruta.split("/").pop()} — usa usePrefs y no deja texto fijo`, () => {
      const src = readFileSync(join(process.cwd(), ruta), "utf8");
      // De cliente: usePrefs(). Server component (5b): la hoja <Tx en es />.
      expect(src, `${ruta} no usa usePrefs() ni <Tx>`).toMatch(/usePrefs\(\)|<Tx /);
      const h = textoAPelo(src);
      expect(h.map((x) => `${ruta}:${x.linea} [${x.tipo}] ${x.texto}`)).toEqual([]);
    });
  }
});
