import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NINGUNA_TIENDA, visibleStores } from "./scope";

// El quinto y último de la familia: un gerente de fichaje SIN tienda veía la compañía entera
// en tres pantallas y podía actuar sobre cualquiera (`mgrScope`). D-236 le cerró el export;
// esto le cierra el resto. Es PREVENTIVO: hoy hay cero `manager` en `clockin.profiles`.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("la falta de un dato acota, nunca amplía", () => {
  it("un gerente sin tienda no ve ninguna tienda", () => {
    expect(visibleStores("manager", null, [])).toEqual(NINGUNA_TIENDA);
    expect(visibleStores("manager", "", [B])).toEqual(NINGUNA_TIENDA);
  });

  it("y lo hace con una tienda imposible, no con una lista vacía", () => {
    // `.in("store_id", [])` puede leerse como «sin filtro», que es justo lo contrario. Este
    // fichero ya llevaba el mismo truco para los ids de empleado (`NO_MATCH`).
    expect(NINGUNA_TIENDA).toHaveLength(1);
    expect(NINGUNA_TIENDA[0]).toMatch(/^0{8}-0{4}-0{4}-0{4}-0{12}$/);
    expect(NINGUNA_TIENDA.includes(A)).toBe(false);
  });

  it("el dueño no cambia en nada: sigue sin acotar", () => {
    expect(visibleStores("owner", null, [])).toBeNull();
    expect(visibleStores("owner", A, [B])).toBeNull();
    expect(visibleStores("employee", A, null)).toBeNull();
  });

  it("un gerente CON tienda no cambia en nada", () => {
    expect(visibleStores("manager", A, [B])).toEqual([A, B]);
    expect(visibleStores("manager", A, [A, B])).toEqual([A, B]);
    expect(visibleStores("manager", A, null)).toEqual([A]);
  });

  it("los cuatro sitios acotan sin tocarlos, que es el motivo de hacerlo en el helper", () => {
    // Los tres de lista hacen `if (suyas) …in("store_id", suyas)`: con la tienda imposible,
    // `suyas` es verdadero y el filtro se aplica, así que no encaja nadie. Con una lista
    // vacía el `if` también pasaría, pero el `.in` sería el que no es de fiar.
    const suyas = visibleStores("manager", null, []);
    expect(Boolean(suyas)).toBe(true);
    // Y el de autorizar sobre una persona: `suyas.includes(su_tienda)` es falso para
    // cualquiera, así que deniega en vez de permitir.
    expect(suyas!.includes(A)).toBe(false);
    expect(suyas!.includes(B)).toBe(false);
  });
});

describe("y se entera de por qué", () => {
  const ctx = sinComentarios(leer("src/lib/clockin/managerCtx.ts"));

  it("un gerente sin tienda no entra al contexto de gerente, con un motivo escrito", () => {
    // Una lista vacía sin explicación se lee como «no hay nadie fichando», no como «te
    // falta un dato». Era la objeción de D-127 y es la que había que atender.
    const i = ctx.indexOf('effectiveRole === "manager" && !me.store_id');
    expect(i, "falta el corte del gerente sin tienda").toBeGreaterThan(0);
    const bloque = ctx.slice(i, i + 400);
    expect(bloque).toContain("ok: false");
    expect(bloque).toMatch(/no store assigned/i);
  });

  it("va después de resolver el rol efectivo, o dejaría fuera a un admin del hub", () => {
    // Un admin del hub entra como `owner` aunque no tenga fila de fichaje ni tienda.
    expect(ctx.indexOf("const effectiveRole")).toBeLessThan(ctx.indexOf('effectiveRole === "manager" && !me.store_id'));
    expect(ctx).toMatch(/effectiveRole = viaHubAdmin \? "owner"/);
  });
});

describe("la regla está escrita donde se lee", () => {
  it("el comentario de scope.ts ya no dice lo contrario que el código", () => {
    // La trampa de siempre: la cabecera decía «un gerente sin tienda ve todo» y esa frase
    // era la que había que cambiar además del `return`.
    const src = leer("src/lib/clockin/scope.ts");
    const cabecera = src.slice(0, src.indexOf("export type StoreScope"));
    expect(cabecera).toMatch(/sin tienda NO VE A NADIE/i);
    // Y cita la decisión que invierte, con su motivo: D-127 eligió lo contrario a propósito,
    // así que esto no puede leerse como si nadie lo hubiera pensado antes.
    expect(cabecera).toContain("D-127");
  });
});
