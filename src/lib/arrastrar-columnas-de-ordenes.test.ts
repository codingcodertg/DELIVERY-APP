import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkDelivery } from "./__fixtures";

/** Arrastrar las cabeceras de Órdenes (D-661). El dueño: «i want to be able to rearrange the columns by dragging».
 *  La colocación (función pura) se prueba en `orden-de-columnas.test.ts`; aquí, qué cabeceras se arrastran y quién guarda. */

vi.mock("@/lib/data-provider", () => ({ useData: () => ({ me: { id: "u1", role: "admin" }, settings: {}, events: [], users: [] }) }));
vi.mock("@/lib/prefs", () => ({ usePrefs: () => ({ t: (en: string) => en, lang: "en" }) }));

const { OrdersTable } = await import("@/components/OrdersTable");
const pinta = (extra: Record<string, unknown>) => renderToStaticMarkup(createElement(OrdersTable, {
  rows: [mkDelivery({ id: "o1" })], onOpen: () => {}, visible: ["stage", "store", "date"], orden: ["date", "store", "stage"], ...extra,
}));
/** Cada cabecera: su texto, si su nombre se arrastra y si lleva algún `draggable`. */
const cabeceras = (html: string) => [...html.slice(html.indexOf("<thead>"), html.indexOf("</thead>")).matchAll(/<th[ >][\s\S]*?<\/th>/g)].map((m) => ({
  nombre: (m[0].match(/class="th-sort"[^>]*>([^<]*)/) ?? [])[1],
  arrastra: /<div[^>]*class="th-cell th-arrastrable"[^>]*draggable="true"/.test(m[0]),
  draggable: /draggable/.test(m[0]),
}));

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/^\s*\/\/.*$/, "")).join("\n").replace(/\s+/g, " ");

describe("qué cabeceras se arrastran", () => {
  it("con `onMoverColumna`, todas menos la `#`, en el orden de la persona", () => {
    const c = cabeceras(pinta({ onMoverColumna: () => {} }));
    expect(c.map((x) => x.nombre)).toEqual(["#", "Delivery Date", "Store", "Stage"]);
    expect(c.map((x) => x.arrastra)).toEqual([false, true, true, true]);
  });
  it("sin `onMoverColumna` (Almacén, chofer, Recepción…) ninguna: la tabla queda como estaba", () => {
    const html = pinta({});
    const c = cabeceras(html);
    expect(c.map((x) => x.nombre)).toEqual(["#", "Delivery Date", "Store", "Stage"]);
    expect(c.map((x) => x.draggable)).toEqual([false, false, false, false]);
    expect(html).not.toContain("th-arrastrable");
  });
});

describe("al soltar", () => {
  const tabla = leer("src/components/OrdersTable.tsx");
  it("la tabla avisa con la arrastrada y la de destino, y solo si son distintas y la de destino se puede mover", () => {
    expect(tabla).toContain('const seArrastra = (key: string) => !!onMoverColumna && key !== "__id";');
    expect(tabla).toContain("if (onMoverColumna && arrastrada && arrastrada !== destino && seArrastra(destino)) onMoverColumna(arrastrada, destino);");
    expect(tabla).toContain("onDrop={seArrastra(c.key) ? (e) => { e.preventDefault(); suelta(c.key); } : undefined}");
  });
  it("arrastra el NOMBRE y no la celda entera: el asa del ancho queda fuera del elemento que se arrastra", () => {
    const th = tabla.slice(tabla.indexOf('className={seArrastra(c.key) ? "th-cell th-arrastrable" : "th-cell"}'));
    const finDelNombre = th.indexOf("</div>");
    const arrastrable = th.indexOf("draggable={seArrastra(c.key) || undefined}");
    expect(arrastrable).toBeGreaterThan(0);
    expect(arrastrable).toBeLessThan(finDelNombre);
    expect(th.indexOf('className="col-resizer"')).toBeGreaterThan(finDelNombre);
  });
  it("la página guarda con la misma función y el mismo guardado que las flechas, y no a ventas ni al chofer", () => {
    const pagina = leer("src/app/(app)/page.tsx");
    expect(pagina).toContain('onMoverColumna={!["sales", "driver"].includes(me.role) ? (clave, destino) => guardaOrden(colocaColumna(ordenDelSelector, clave, destino)) : undefined}');
  });
  it("solo la página de Órdenes lo pasa: las demás tablas no se arrastran", () => {
    for (const r of ["src/app/(app)/driver/page.tsx", "src/app/(app)/warehouse/page.tsx"]) expect(leer(r), r).not.toContain("onMoverColumna");
  });
});
