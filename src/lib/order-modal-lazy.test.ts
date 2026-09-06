import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// G-20 (D-NEXT). La ficha del pedido se carga en diferido desde UN punto (OrderModalLazy.tsx).
// Este repo no dibuja pantallas en las pruebas, así que lo que se afirma es la forma: ninguna
// pantalla importa el componente pesado directo, todas pasan por el punto de carga, y la manera
// de montarla —`{open && <OrderModal …/>}`, con el pedido en el estado del padre— es la misma,
// que es lo que garantiza que el primer clic no se pierda mientras baja el trozo.

const raiz = process.cwd();
function tsx(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) tsx(p, out);
    else if (f.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("OrderModal se carga en diferido desde un solo punto", () => {
  // Sin comentarios: el propio fichero explica por qué NO lleva `ssr: false`.
  const lazy = readFileSync(join(raiz, "src/components/OrderModalLazy.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("el punto de carga usa next/dynamic sobre ./OrderModal y no apaga el SSR", () => {
    expect(lazy).toMatch(/from "next\/dynamic"/);
    expect(lazy).toMatch(/import\("\.\/OrderModal"\)/);
    expect(lazy).not.toMatch(/ssr:\s*false/);
  });

  it("ninguna pantalla importa el componente pesado directo; todas, el diferido", () => {
    const paginas = tsx(join(raiz, "src/app")).filter((p) => /OrderModal/.test(readFileSync(p, "utf8")));
    expect(paginas.length).toBe(8);
    for (const p of paginas) {
      const src = readFileSync(p, "utf8");
      expect(src, p).toMatch(/from "@\/components\/OrderModalLazy"/);
      expect(src, p).not.toMatch(/from "@\/components\/OrderModal"/);
    }
  });

  it("y la montan igual que antes: condicionada al pedido abierto en el estado del padre", () => {
    const paginas = tsx(join(raiz, "src/app")).filter((p) => /OrderModalLazy/.test(readFileSync(p, "utf8")));
    for (const p of paginas) {
      const src = readFileSync(p, "utf8");
      // Cada montaje va precedido de una condición `{algo && <OrderModal` — el pedido (o
      // `creating`) vive en el padre, así que el trozo diferido lo recibe intacto al llegar.
      const montajes = src.match(/<OrderModal\b/g) ?? [];
      const condicionados = src.match(/\{\w+ && <OrderModal\b/g) ?? [];
      expect(condicionados.length, p).toBe(montajes.length);
      expect(montajes.length, p).toBeGreaterThan(0);
    }
  });

  it("el único import del componente pesado en src/ es el del punto de carga", () => {
    const todos = tsx(join(raiz, "src")).filter((p) => !p.endsWith("OrderModal.tsx"));
    const directos = todos.filter((p) => /from "(@\/components\/OrderModal|\.\/OrderModal)"/.test(readFileSync(p, "utf8")));
    expect(directos.map((p) => p.replace(/\\/g, "/").split("src/")[1])).toEqual([]);
  });
});
