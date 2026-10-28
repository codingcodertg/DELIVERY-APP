import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// El banner de «entrar como» tapaba la barra superior entera: era `position: fixed` en el borde
// de arriba y nada compensaba su alto, así que ningún botón de la barra era alcanzable. Lo vio el
// dueño la primera vez que usó la función, en producción.
//
// Lo que se fija aquí es la forma del arreglo, no el aspecto: que el banner esté EN EL FLUJO del
// documento —así empuja lo que viene detrás y no hay altura que sincronizar— y que el único sitio
// donde sí hace falta un desplazamiento, la barra lateral `fixed` del ERP, lo tome de una medida
// que el propio banner publica y borra al desmontarse.

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");
const BANNER = "src/components/ImpersonationBanner.tsx";
const SIDE_NAV = "src/components/erp/side-nav.tsx";
const LAYOUT = "src/app/layout.tsx";
const VARIABLE = "--banner-impersonacion";

describe("el banner de «entrar como» no se pone encima de nada", () => {
  it("el fichero se lee y trae el banner (control)", () => {
    const src = leer(BANNER);
    expect(src.length).toBeGreaterThan(500);
    expect(src).toContain("role=\"alert\"");
  });

  it("no es `fixed`: eso es lo que tapaba la barra", () => {
    const src = leer(BANNER);
    expect(src).not.toMatch(/position:\s*"fixed"/);
  });

  it("es `sticky` en el borde de arriba, para seguir viéndose al bajar", () => {
    const src = leer(BANNER);
    expect(src).toMatch(/position:\s*"sticky"/);
    expect(src).toMatch(/top:\s*0/);
  });

  it("va delante del contenido en el layout raíz, que es lo que hace que lo empuje", () => {
    const src = leer(LAYOUT);
    const banner = src.indexOf("<ImpersonationBanner />");
    const hijos = src.indexOf("{children}");
    expect(banner).toBeGreaterThan(-1);
    expect(hijos).toBeGreaterThan(-1);
    expect(banner).toBeLessThan(hijos);
  });
});

describe("la medida que usa el ERP existe solo mientras el banner está puesto", () => {
  it("el banner la publica midiendo, no con un número escrito", () => {
    const src = leer(BANNER);
    expect(src).toContain(`setProperty("${VARIABLE}"`);
    expect(src).toContain("offsetHeight");
  });

  it("y la borra al desmontarse, para que fuera de una impersonación no exista", () => {
    const src = leer(BANNER);
    expect(src).toContain(`removeProperty("${VARIABLE}")`);
  });

  it("la barra de Inventario va en el flujo del documento (D-622): nada suyo se pega a la ventana, así que no usa la medida", () => {
    const src = leer(SIDE_NAV);
    // Hasta D-622 eran tres usos: la barra lateral `fixed inset-y-0`, el botón de desplegarla y la cabecera de
    // móvil `sticky`. Desde D-622 la barra es la superior de Entregas, `.topbar` en el flujo, y el banner la
    // empuja como a las otras tres barras del hub: ni `fixed` ni `sticky` ni la variable.
    expect(src.split(`var(${VARIABLE}, 0px)`).length - 1).toBe(0);
    expect(src).not.toMatch(/\b(fixed|sticky)\b/);
    // La `.topbar` la pone `BarraDeApp` desde D-643, la misma de todas las apps.
    expect(src).toContain("<BarraDeApp ");
    expect(leer("src/components/BarraDeApp.tsx")).not.toMatch(/\b(fixed|sticky)\b/);
  });
});

describe("nadie más se cuelga del borde de arriba a lo ancho", () => {
  // Recorre en vez de enumerar: el fallo no fue que el banner estuviera mal escrito, fue que
  // NADIE comprobaba si algo se ponía encima de la barra. Y el recorrido mira los tres sitios
  // donde se puede escribir eso —estilo suelto, clase de Tailwind y regla CSS—, porque la
  // primera versión de esta prueba solo miraba el primero y dejó fuera tres elementos reales.

  const ficheros = (raiz: string, ext: string) => {
    const out: string[] = [];
    const recorre = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) recorre(p);
        else if (f.endsWith(ext)) out.push(p.split("\\").join("/"));
      }
    };
    recorre(join(process.cwd(), raiz).split("\\").join("/"));
    return out;
  };

  const RAIZ = process.cwd().split("\\").join("/") + "/";
  const rel = (p: string) => p.replace(RAIZ, "");

  // Los que se pegan arriba pero DENTRO de un contenedor con scroll propio: ahí el borde de
  // arriba es el de su caja, no el de la ventana, así que el banner no los alcanza. Cada uno con
  // el contenedor que lo salva, y la cuenta exacta — si un fichero deja de tener el suyo, la
  // prueba lo pide igual que si fuera nuevo.
  const EXENTOS: Record<string, number> = {
    // `h-[calc(100vh-340px)] overflow-auto` en la tabla del catálogo.
    "src/components/erp/catalog-table.tsx": 1,
    // `max-h-[28rem] overflow-auto`.
    "src/components/erp/decisions-upload.tsx": 1,
    // `max-h-[32rem] overflow-auto`.
    "src/components/erp/master-round-trip.tsx": 1,
    // El cajón lateral entero es `overflow-y-auto`.
    "src/components/erp/product-drawer.tsx": 1,
    // Nota D-553: el cajón de «Request» del catálogo copia esa forma: panel `overflow-y-auto` y su
    // cabecera `sticky top-0` dentro.
    "src/components/erp/request-drawer.tsx": 1,
    // La cabecera de la tabla de Clientes (D-649, cabecera bloqueada como Órdenes): se pega al borde de su caja
    // `max-h-[calc(100dvh-150px)] overflow-auto`, no al de la ventana. (Su cajón lateral, que también tenía una, ya no
    // existe: la ficha es una ventana centrada, D-654.)
    "src/app/customers/Clientes.tsx": 1,
    // `max-h-[70vh] overflow-auto` en la cola de revisión.
    "src/components/erp/review-queue.tsx": 1,
    // `table.orders th` dentro de `.tbl-scroll`, que es caja de scroll en los dos ejes porque
    // `overflow-x: auto` hace que el otro eje deje de ser `visible`.
    // Y la cabecera de tienda del panel de «Switch usuario» (D-254), que se pega al borde del
    // propio panel, que tiene su `overflow-y: auto`: el banner queda fuera de esa caja.
    "src/app/globals.css": 2,
    // La cabecera del expediente de RR. HH. (D-NEXT, `.ficha-cabecera`): se pega al borde de su ventana `.modal`, que
    // es la caja de scroll (`max-height: 88vh; overflow: auto`), no al de la pantalla; el banner queda fuera.
    "src/app/recruiting/recruiting.css": 1,
    // El propio banner: es EL elemento que se pega arriba, y de ahí sale la medida que usan
    // los demás. Si algún día dejara de aparecer aquí, es que dejó de estar en el borde.
    "src/components/ImpersonationBanner.tsx": 1,
  };

  const CLASE = /className=\{?\s*["`][^"`]*\b(?:sticky|fixed)\b[^"`]*\btop-0\b/g;
  const ESTILO = /position:\s*["']?(?:sticky|fixed)["']?[^}]{0,200}?top:\s*0\b/g;
  const REGLA = /position:\s*(?:sticky|fixed)[^}]{0,300}?top:\s*0(?![.\d])/g;

  const candidatos = new Map<string, number>();
  for (const p of ficheros("src", ".tsx")) {
    const src = readFileSync(p, "utf8");
    const n = (src.match(CLASE) ?? []).length + (src.match(ESTILO) ?? []).length;
    if (n) candidatos.set(rel(p), n);
  }
  for (const p of ficheros("src", ".css")) {
    const src = readFileSync(p, "utf8");
    const n = (src.match(REGLA) ?? []).length;
    if (n) candidatos.set(rel(p), n);
  }

  it("recorre los ficheros de verdad (control)", () => {
    expect(ficheros("src", ".tsx").length).toBeGreaterThanOrEqual(60);
    expect(ficheros("src", ".css").length).toBeGreaterThanOrEqual(3);
    // Y encuentra algo: un recorrido que no ve ni un `sticky top-0` está roto, no limpio.
    expect(candidatos.size).toBeGreaterThanOrEqual(5);
  });

  it("todo lo que se pega al borde de arriba, o usa la medida del banner, o está exento", () => {
    const culpables: string[] = [];
    for (const [ruta, n] of candidatos) {
      if (EXENTOS[ruta] === n) continue;
      culpables.push(`${ruta}: ${n} pegado(s) arriba, exentos ${EXENTOS[ruta] ?? 0}`);
    }
    expect(culpables, culpables.join(" · ")).toEqual([]);
  });

  it("la tabla de exentos no lleva de más: cada uno sigue existiendo, con su cuenta", () => {
    for (const [ruta, n] of Object.entries(EXENTOS)) {
      expect(candidatos.get(ruta), ruta).toBe(n);
    }
  });
});
