import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CAMPOS, COLUMNAS, filasDelLado, LADO_DE_JUNTAR, type Cliente } from "@/lib/customers/reglas";
import { CLIENTES_DEMO } from "@/lib/customers/demo";

// D-941 · Inventario en el demo (`NEXT_PUBLIC_LOCAL_MODE`). El dueño, 2026-11-09: «pero quiero que sea de todo, todas las
// appas y todos los procedimientos». Las páginas de servidor no ramifican una a una: todas toman `createClient()` de
// `lib/erp/supabase/*`, y ESA es la rama. Aquí se afirma que la rama va delante y que ninguna pantalla la salta.
const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const BANDERA = 'const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";';

const ordenado = (texto: string, antes: string, despues: string) => {
  const i = texto.indexOf(antes), j = texto.indexOf(despues);
  expect(i, antes).toBeGreaterThan(-1); expect(j, despues).toBeGreaterThan(-1);
  expect(i).toBeLessThan(j);
};

function recorre(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) recorre(f, out);
    else if (/\.tsx?$/.test(n) && !n.endsWith(".test.ts")) out.push(f);
  }
  return out;
}

describe("/erp/** en el demo, sin base ni sesión", () => {
  it("el layout ramifica antes de crear el cliente y de mirar la sesión", () => {
    const f = leer("src/app/erp/layout.tsx");
    expect(f).toContain(BANDERA);
    const rama = 'if (LOCAL_MODE) return <div data-app="erp">{children}</div>;';
    ordenado(f, rama, "await createClient()");
    ordenado(f, rama, "supabase.auth.getUser()");
    ordenado(f, rama, 'redirect("/login?next=/erp/catalog")');
  });

  it.each(["src/lib/erp/supabase/server.ts", "src/lib/erp/supabase/client.ts", "src/lib/erp/supabase/admin.ts"])(
    "%s contesta con la semilla antes de llegar al cliente real",
    (ruta) => {
      const f = leer(ruta);
      expect(f).toContain(BANDERA);
      ordenado(f.slice(f.indexOf("export ")), "if (LOCAL_MODE) return clienteDemoDelErp(new Date())", "return clienteReal();");
    },
  );

  it("ninguna pantalla ni acción de Inventario crea un cliente sin pasar por esos tres", () => {
    const rutas = [...recorre("src/app/erp"), ...recorre("src/components/erp"), ...recorre("src/lib/erp")]
      .map((r) => r.replace(/\\/g, "/"))
      .filter((r) => !r.includes("lib/erp/supabase/"));
    expect(rutas.length).toBeGreaterThan(60);
    const directos = rutas.filter((r) => /^import \{.*from "@supabase\/(ssr|supabase-js)"/m.test(leer(r)));
    expect(directos).toEqual([]);
    // El único que entra por el cliente del hub es el layout, y va detrás de su propia rama (prueba de arriba).
    const delHub = rutas.filter((r) => leer(r).includes('from "@/lib/supabase/server"') || leer(r).includes('from "@/lib/supabase/client"'));
    expect(delHub).toEqual(["src/app/erp/layout.tsx"]);
  });
});

describe("Daltile: un form action no puede enseñar el aviso lanzándolo", () => {
  it("en el demo los dos botones vuelven a la pantalla con el aviso, y la pantalla lo enseña", () => {
    const f = leer("src/app/erp/review/daltile/page.tsx");
    expect(f).toContain("LOCAL_MODE ? avisoDaltileDelDemo : confirmDaltileMatch.bind(null, r.id)");
    expect(f).toContain("LOCAL_MODE ? avisoDaltileDelDemo : rejectDaltileMatch.bind(null, r.id)");
    expect(f).toContain('LOCAL_MODE && aviso === "demo"');
    expect(leer("src/lib/erp/daltile-actions.ts")).toContain('redirect("/erp/review/daltile?aviso=demo")');
  });
});

describe("el cliente del navegador según la bandera", () => {
  async function cargar(bandera: string) {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", bandera);
    const real = { soy: "real" };
    const createBrowserClient = vi.fn(() => real);
    vi.doMock("@supabase/ssr", () => ({ createBrowserClient }));
    const { createClient } = await import("./supabase/client");
    const cliente = createClient() as unknown;
    vi.doUnmock("@supabase/ssr");
    vi.unstubAllEnvs();
    return { cliente, real, createBrowserClient };
  }

  it("apagada es el real, con Supabase", async () => {
    const { cliente, real, createBrowserClient } = await cargar("false");
    expect(cliente).toBe(real);
    expect(createBrowserClient).toHaveBeenCalledTimes(1);
  });

  it("puesta es la semilla y no toca @supabase/ssr", async () => {
    const { cliente, createBrowserClient } = await cargar("true");
    expect((await (cliente as { rpc: (n: string) => Promise<{ data: unknown }> }).rpc("catalog_facets")).data).toMatchObject({ total: 21 });
    expect(createBrowserClient).not.toHaveBeenCalled();
  });
});

describe("«Decidir si se juntan» pinta un lado sin caerse", () => {
  it("cada campo del lado tiene etiqueta en las columnas (de CAMPOS salieron el contacto, el teléfono y el correo)", () => {
    for (const k of LADO_DE_JUNTAR) expect(COLUMNAS.find((c) => c.key === k), k).toBeDefined();
    expect(CAMPOS.find((c) => c.key === "phone")).toBeUndefined();
  });

  it("la pantalla pinta filasDelLado y ya no busca en CAMPOS", () => {
    const f = leer("src/app/customers/juntar/DecidirJuntar.tsx");
    expect(f).toContain("filasDelLado(c).map(");
    expect(f).not.toContain("CAMPOS.find");
  });

  it("los valores salen de las columnas: el contacto del primer contacto y el teléfono ya separado", () => {
    const c: Cliente = CLIENTES_DEMO[0];
    const filas = Object.fromEntries(filasDelLado(c).map((x) => [x.key, x]));
    expect(filas.contact_name).toMatchObject({ en: "Contact", es: "Contacto", valor: "ANA DEMO" });
    expect(filas.phone.valor).toBeTruthy();
    expect(filas.credit_limit.valor).toBe(c.credit_limit);
  });
});
