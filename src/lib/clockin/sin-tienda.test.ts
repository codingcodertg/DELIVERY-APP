import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
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
    // El texto vive en `SIN_TIENDA`, una constante exportada, porque `reports.ts` lo usa
    // también y dos mensajes distintos para lo mismo serían dos verdades a medias.
    expect(bloque).toContain("SIN_TIENDA");
  });

  it("va después de resolver el rol efectivo, o dejaría fuera a un admin del hub", () => {
    // Un admin del hub entra como `owner` aunque no tenga fila de fichaje ni tienda.
    expect(ctx.indexOf("const effectiveRole")).toBeLessThan(ctx.indexOf('effectiveRole === "manager" && !me.store_id'));
    expect(ctx).toMatch(/effectiveRole = viaHubAdmin \? "owner"/);
  });
});

describe("ningún contexto de gerente ACOTADO se queda sin la regla", () => {
  // El duplicado se notó en cuanto la regla existió: `reports.ts` tiene su propio `mgrCtx()`
  // y no pasa por `clockinManagerCtx`, así que a un gerente sin tienda la nómina le salía
  // vacía y muda — el mismo agujero, por la puerta de al lado. La prueba busca CUALQUIER ctx
  // propio en `actions/`, no solo el que ya conocemos.
  //
  // Y separa los que acotan por tienda de los que no: la regla es para el alcance por
  // tienda, no para «ser gerente». Exigirla donde no hay tienda de por medio sería ruido, y
  // no exigirla en los que sí acotan fue justo el fallo.
  const dir = join(process.cwd(), "src/app/timetracker/clock-in/actions");
  const conCtxPropio = readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => /async function \w*[Cc]tx\s*\(/.test(leer(`src/app/timetracker/clock-in/actions/${f}`)));
  const acota = (f: string) => /visibleStores|storeScope|canManageEmployee/.test(leer(`src/app/timetracker/clock-in/actions/${f}`));

  it("encuentra los que tienen ctx propio", () => {
    expect(conCtxPropio.length).toBeGreaterThanOrEqual(2);
  });

  for (const f of conCtxPropio) {
    it(`${f} — ${acota(f) ? "acota por tienda: lleva la regla" : "no acota por tienda: no le toca"}`, () => {
      const src = sinComentarios(leer(`src/app/timetracker/clock-in/actions/${f}`));
      if (acota(f)) {
        expect(src).toMatch(/role === "manager" && !\w*\.?store_id/);
        // Y con el MISMO mensaje que el ctx compartido, no con uno parecido.
        expect(src).toContain("SIN_TIENDA");
      } else {
        // Que no acote hoy es lo que le exime; si mañana acota, esta prueba se lo pide.
        expect(src).not.toMatch(/visibleStores|storeScope|canManageEmployee/);
      }
    });
  }

  it("el mensaje vive en un solo sitio", () => {
    const ctx = leer("src/lib/clockin/managerCtx.ts");
    expect(ctx).toMatch(/export const SIN_TIENDA/);
    expect(ctx).toMatch(/no store assigned/i);
  });
});

describe("la pantalla en vivo dice por qué no hay nada", () => {
  const src = sinComentarios(leer("src/app/timetracker/(timetracker)/live/page.tsx"));

  it("no se traga un `ok:false`", () => {
    // Antes: `if (vivo && r.ok) setCrew(r)` — con false no pasaba nada y la pantalla se
    // quedaba esperando, que es exactamente lo que D-127 temía.
    expect(src).toMatch(/if \(r\.ok\)/);
    expect(src).toMatch(/setAviso\(r\.message\)/);
    expect(src).toMatch(/if \(aviso\) return/);
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
