import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { canEditFields, ROLE_ORDER, STAGES } from "./constants";
import { borrarOrden, ordenDeMisTiendas, puedeBorrar } from "./deshacer-y-borrar";
import type { NamedLocation, Stage, UserRole } from "./types";

/**
 * La pantalla de la 142 (D-383): almacén deshace en SUS órdenes, borrar es del borrador, y un borrado
 * que la base no deja pasar no se da por hecho.
 *
 * Lo que decide acaba en la base, así que las pruebas **leen el `.sql` de la 142** y comparan: la política
 * de borrar se interpreta rama por rama, y la función de tiendas se compara por lo que mira. Las tiendas
 * de aquí son inventadas a propósito: los nombres reales viven en Ajustes y no se clavan en el repo.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const sql = leer("supabase/migrations/142_deshacer_almacen_y_borrar_borradores.sql");
const sinComentarios = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
/**
 * El GUARD vigente ya no es el de la 142: la 145 (D-397) lo redefine entero para que el gerente haga bodega.
 * La política de borrar y `orden_de_mis_tiendas` siguen siendo de la 142 (la 145 no las toca); lo que se lee
 * del guard —el tramo de misma etapa, el candado de autor y la llamada con OLD— se lee de la vigente.
 */
const guardVigente = leer("supabase/migrations/145_gerente_hace_bodega.sql")
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ").trim();

const TIENDAS: Pick<NamedLocation, "name" | "address" | "group">[] = [
  { name: "Tienda A", address: "100 Calle A", group: "Norte" },
  { name: "Tienda A2", address: "200 Calle A2", group: " norte " },
  { name: "Tienda B", address: "300 Calle B", group: "" },
  { name: "Tienda C", address: "400 Calle C", group: null },
];

// ---------------------------------------------------------------------------------------------------
// La política de borrar, leída del `.sql` e interpretada rama por rama
// ---------------------------------------------------------------------------------------------------

/** El `using (...)` de `alter policy "deliveries delete"`, en una línea. */
const politica = (() => {
  const i = sinComentarios.indexOf('alter policy "deliveries delete" on public.deliveries');
  const fin = sinComentarios.indexOf(");", i);
  return plano(sinComentarios.slice(i, fin + 2));
})();

/** Parte `texto` por `sep` solo al nivel de paréntesis 0. */
function partePorArriba(texto: string, sep: string): string[] {
  const trozos: string[] = [];
  let hondo = 0, desde = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === "(") hondo++;
    else if (c === ")") hondo--;
    else if (hondo === 0 && texto.startsWith(sep, i)) { trozos.push(texto.slice(desde, i)); desde = i + sep.length; i += sep.length - 1; }
  }
  trozos.push(texto.slice(desde));
  return trozos.map((t) => t.trim());
}

/** Quita UN par de paréntesis que envuelva el texto entero. */
function sinParentesis(t: string): string {
  const s = t.trim();
  if (!s.startsWith("(") || !s.endsWith(")")) return s;
  let hondo = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") hondo++;
    else if (s[i] === ")") hondo--;
    if (hondo === 0 && i < s.length - 1) return s;   // el primer paréntesis cierra antes del final
  }
  return s.slice(1, -1).trim();
}

interface Caso { rol: UserRole; etapa: Stage; esMio: boolean; deMiTienda: boolean }

/** Un átomo de la política, traducido. Uno que no se reconozca tumba la prueba: la política cambió. */
function atomo(a: string): (c: Caso) => boolean {
  if (a === "(select public.is_admin())") return (c) => c.rol === "admin";
  if (a === "created_by = (select auth.uid())") return (c) => c.esMio;
  if (a === "public.orden_de_mis_tiendas(store, pickup_name, delivery_name, pickup_address)") return (c) => c.deMiTienda;
  const etapa = /^stage = '(\w+)'$/.exec(a);
  if (etapa) return (c) => c.etapa === etapa[1];
  const roles = /^\(select public\.current_user_role\(\)\) in \(([^)]*)\)$/.exec(a);
  if (roles) {
    const lista = roles[1].split(",").map((x) => x.trim().replace(/'/g, ""));
    return (c) => lista.includes(c.rol);
  }
  throw new Error(`átomo de la política que la prueba no sabe leer: ${a}`);
}

const ramas = (() => {
  const cuerpo = /^alter policy "deliveries delete" on public\.deliveries using \( \(select public\.has_deliveries_access\(\)\) and \((.*)\) \);$/.exec(politica);
  if (!cuerpo) return null;
  return partePorArriba(cuerpo[1].trim(), " or ").map((r) => {
    // Una rama de un solo átomo, `(select public.is_admin())`, lleva sus paréntesis como parte del átomo.
    const partes = partePorArriba(sinParentesis(r), " and ");
    return (partes.length === 1 ? [r] : partes).map(atomo);
  });
})();

function laPoliticaDejaBorrar(c: Caso): boolean {
  return ramas!.some((conds) => conds.every((f) => f(c)));
}

describe("la política de borrar se leyó de verdad (control)", () => {
  it("tiene la forma de la 142: el módulo, y tres ramas", () => {
    expect(politica).toContain("(select public.has_deliveries_access())");
    expect(ramas).not.toBeNull();
    expect(ramas!.length).toBe(3);
  });

  it("el intérprete no es de goma: la política de la 131, sin ramas, no se deja leer", () => {
    // Si el regex aceptara cualquier cosa, un `.sql` distinto pasaría igual. La de antes (todo el módulo
    // borra todo) no tiene el `and (...)`, y tiene que dar null.
    const vieja = 'alter policy "deliveries delete" on public.deliveries using ( (select public.has_deliveries_access()) );';
    expect(/^alter policy "deliveries delete" on public\.deliveries using \( \(select public\.has_deliveries_access\(\)\) and \((.*)\) \);$/.exec(vieja)).toBeNull();
    expect(() => atomo("stage <> 'draft'")).toThrow();
  });
});

describe("puedeBorrar dice lo mismo que la política, caso por caso", () => {
  const yo = (rol: UserRole, store: string | null = "Tienda A") => ({ id: "yo", role: rol, store });
  const orden = (etapa: Stage, esMio: boolean, deMiTienda: boolean) => ({
    stage: etapa, created_by: esMio ? "yo" : "otro",
    store: deMiTienda ? "Tienda A" : "Tienda B", pickup_name: null, delivery_name: null, pickup_address: null,
  });

  it("rol por rol, etapa por etapa, mío o ajeno, de mi tienda o de otra", () => {
    for (const rol of ROLE_ORDER) {
      for (const etapa of STAGES.map((s) => s.key)) {
        for (const esMio of [true, false]) {
          for (const deMiTienda of [true, false]) {
            const o = orden(etapa, esMio, deMiTienda);
            // El caso de la política se construye con la función espejo, sobre la MISMA orden.
            expect(ordenDeMisTiendas(o, "Tienda A", TIENDAS)).toBe(deMiTienda);
            const base = laPoliticaDejaBorrar({ rol, etapa, esMio, deMiTienda });
            expect([rol, etapa, esMio, deMiTienda, puedeBorrar(yo(rol), o, TIENDAS)]).toEqual([rol, etapa, esMio, deMiTienda, base]);
          }
        }
      }
    }
  });

  it("en concreto: office y gerente borran el borrador AJENO de su tienda; ventas, solo el suyo", () => {
    expect(puedeBorrar(yo("accounting"), orden("draft", false, true), TIENDAS)).toBe(true);
    expect(puedeBorrar(yo("manager"), orden("draft", false, true), TIENDAS)).toBe(true);
    expect(puedeBorrar(yo("accounting"), orden("draft", false, false), TIENDAS)).toBe(false);
    expect(puedeBorrar(yo("sales"), orden("draft", true, false), TIENDAS)).toBe(true);
    expect(puedeBorrar(yo("sales"), orden("draft", false, true), TIENDAS)).toBe(false);
  });

  it("una pendiente, aprobada o entregada solo la borra el admin, aunque sea tuya y de tu tienda", () => {
    for (const etapa of ["pending", "approved", "delivered", "rejected", "canceled"] as Stage[]) {
      for (const rol of ROLE_ORDER.filter((r) => r !== "admin")) {
        expect([etapa, rol, puedeBorrar(yo(rol), orden(etapa, true, true), TIENDAS)]).toEqual([etapa, rol, false]);
      }
      expect(puedeBorrar(yo("admin"), orden(etapa, false, false), TIENDAS)).toBe(true);
    }
  });

  it("office sin tienda solo borra sus propios borradores (falla cerrado, como la base)", () => {
    expect(puedeBorrar(yo("accounting", null), orden("draft", false, true), TIENDAS)).toBe(false);
    expect(puedeBorrar(yo("accounting", ""), orden("draft", false, true), TIENDAS)).toBe(false);
    expect(puedeBorrar(yo("accounting", null), orden("draft", true, false), TIENDAS)).toBe(true);
  });

  it("un borrador sin autor no es «mío» para nadie que no tenga id nulo", () => {
    expect(puedeBorrar({ id: "", role: "sales", store: null }, { ...orden("draft", false, false), created_by: null }, TIENDAS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
// Las tiendas de la orden contra las mías: espejo de `orden_de_mis_tiendas`
// ---------------------------------------------------------------------------------------------------

describe("ordenDeMisTiendas mira lo mismo que la función de la 142", () => {
  const fn = plano(sinComentarios.slice(
    sinComentarios.indexOf("create or replace function public.orden_de_mis_tiendas("),
    sinComentarios.indexOf("revoke execute on function public.orden_de_mis_tiendas"),
  ));

  it("la función del `.sql`: tres columnas de nombre, la dirección de recogida, y sin tienda no hay nada (control)", () => {
    expect(fn).toContain("p_store text, p_pickup_name text, p_delivery_name text, p_pickup_address text");
    expect(fn).toContain("coalesce(p_store, '')");
    expect(fn).toContain("coalesce(p_pickup_name, '')");
    expect(fn).toContain("coalesce(p_delivery_name, '')");
    expect(fn).toContain("m.direccion = btrim(coalesce(p_pickup_address, ''))");
    // La dirección se compara solo recortada, sin minúsculas: la función de la app hace lo mismo (abajo).
    expect(fn).not.toContain("lower(btrim(coalesce(p_pickup_address");
    // La propia tienda cuenta aunque no esté en Ajustes, y sin tienda propia no hay «mías».
    expect(fn).toContain("select yo.tienda as nombre, ''::text as direccion from yo where yo.tienda <> ''");
    // El grupo, por el catálogo de Ajustes.
    expect(fn).toContain("c.grupo = (select g.grupo from mi_grupo g)");
  });

  it("el guard y la política la llaman con las columnas en el mismo orden que la app", () => {
    expect(guardVigente).toContain("public.orden_de_mis_tiendas(OLD.store, OLD.pickup_name, OLD.delivery_name, OLD.pickup_address)");
    expect(politica).toContain("public.orden_de_mis_tiendas(store, pickup_name, delivery_name, pickup_address)");
  });

  const o = (x: Partial<{ store: string; pickup_name: string; delivery_name: string; pickup_address: string }>) =>
    ({ store: null, pickup_name: null, delivery_name: null, pickup_address: null, ...x });

  it("sin tienda propia, nada es mío — ni siquiera una orden sin tienda", () => {
    expect(ordenDeMisTiendas(o({ store: "Tienda A" }), null, TIENDAS)).toBe(false);
    expect(ordenDeMisTiendas(o({ store: "Tienda A" }), "   ", TIENDAS)).toBe(false);
    expect(ordenDeMisTiendas(o({}), "", TIENDAS)).toBe(false);
    expect(ordenDeMisTiendas(o({ pickup_address: "" }), "", [{ name: "", address: "", group: "" }])).toBe(false);
  });

  it("cualquiera de las tres columnas de nombre, sin mirar el tipo, y normalizada", () => {
    expect(ordenDeMisTiendas(o({ store: "  tienda   a " }), "Tienda A", TIENDAS)).toBe(true);
    expect(ordenDeMisTiendas(o({ store: "Tienda B", pickup_name: "Tienda A" }), "Tienda A", TIENDAS)).toBe(true);
    expect(ordenDeMisTiendas(o({ store: "Tienda B", delivery_name: "TIENDA A" }), "Tienda A", TIENDAS)).toBe(true);
    expect(ordenDeMisTiendas(o({ store: "Tienda B", pickup_name: "Tienda C" }), "Tienda A", TIENDAS)).toBe(false);
  });

  it("el grupo cuenta (D-293), y una tienda sin grupo va sola", () => {
    expect(ordenDeMisTiendas(o({ store: "Tienda A2" }), "Tienda A", TIENDAS)).toBe(true);
    expect(ordenDeMisTiendas(o({ store: "Tienda A" }), "Tienda A2", TIENDAS)).toBe(true);
    // B tiene grupo vacío y C nulo: un grupo vacío no empareja con otro vacío.
    expect(ordenDeMisTiendas(o({ store: "Tienda C" }), "Tienda B", TIENDAS)).toBe(false);
  });

  it("la dirección de recogida de una de mis tiendas, recortada pero sin cambiar mayúsculas", () => {
    expect(ordenDeMisTiendas(o({ store: "Tienda B", pickup_address: " 100 Calle A " }), "Tienda A", TIENDAS)).toBe(true);
    expect(ordenDeMisTiendas(o({ store: "Tienda B", pickup_address: "200 Calle A2" }), "Tienda A", TIENDAS)).toBe(true);
    expect(ordenDeMisTiendas(o({ store: "Tienda B", pickup_address: "100 CALLE A" }), "Tienda A", TIENDAS)).toBe(false);
    expect(ordenDeMisTiendas(o({ store: "Tienda B", pickup_address: "300 Calle B" }), "Tienda A", TIENDAS)).toBe(false);
  });

  it("la propia tienda cuenta aunque ya no esté en Ajustes", () => {
    expect(ordenDeMisTiendas(o({ store: "Tienda Vieja" }), "Tienda Vieja", TIENDAS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
// Un DELETE de cero filas no es un borrado
// ---------------------------------------------------------------------------------------------------

describe("borrarOrden solo quita la fila si la base la devolvió", () => {
  const prueba = async (respuesta: { data: { id: string }[] | null; error: { message: string } | null }) => {
    const quitar = vi.fn();
    const avisar = vi.fn();
    const ok = await borrarOrden({ borrar: async () => respuesta, quitarDeLaLista: quitar, avisar, lang: "es" });
    return { ok, quitar, avisar };
  };

  it("cero filas y sin error (la política dijo que no): se avisa y la orden se queda", async () => {
    const r = await prueba({ data: [], error: null });
    expect(r.ok).toBe(false);
    expect(r.quitar).not.toHaveBeenCalled();
    expect(r.avisar).toHaveBeenCalledTimes(1);
    expect(r.avisar.mock.calls[0][0]).toContain("No se borró");
  });

  it("`data` nulo cuenta como cero filas", async () => {
    const r = await prueba({ data: null, error: null });
    expect([r.ok, r.quitar.mock.calls.length]).toEqual([false, 0]);
  });

  it("con error: se dice el error y la orden se queda", async () => {
    const r = await prueba({ data: null, error: { message: "boom" } });
    expect([r.ok, r.quitar.mock.calls.length]).toEqual([false, 0]);
    expect(r.avisar).toHaveBeenCalledWith("Error: boom");
  });

  it("una fila: se quita de la lista, una vez, y no se avisa de nada", async () => {
    const r = await prueba({ data: [{ id: "x" }], error: null });
    expect([r.ok, r.quitar.mock.calls.length, r.avisar.mock.calls.length]).toEqual([true, 1, 0]);
  });
});

describe("los dos proveedores y la ficha usan lo probado", () => {
  const tramo = (fichero: string, desde: string, hasta: string) => {
    const s = leer(fichero);
    const i = s.indexOf(desde);
    expect(i).toBeGreaterThan(-1);
    return s.slice(i, s.indexOf(hasta, i));
  };

  it("el proveedor real pide `.select(\"id\")` y solo quita la fila dentro de `borrarOrden`", () => {
    const t = tramo("src/lib/data-provider.tsx", "const deleteDelivery = useCallback", "const setStage = useCallback");
    expect(t).toContain('borrar: async () => await supabase.from("deliveries").delete().eq("id", id).select("id"),');
    expect(t).toContain("quitarDeLaLista: () => setDeliveries((prev) => prev.filter((c) => c.id !== id)),");
    // Una sola vez: un `setDeliveries` suelto antes de `borrarOrden` volvería a quitarla sin mirar.
    expect(t.split("setDeliveries(").length - 1).toBe(1);
  });

  it("el demo simula la política con `puedeBorrar` y pasa por el mismo `borrarOrden`", () => {
    const t = tramo("src/lib/local-data-provider.tsx", "const deleteDelivery = useCallback", "const setStage = useCallback");
    expect(t).toContain("data: orden && puedeBorrar(me, orden, s.settings.stores) ? [{ id }] : []");
    expect(t).toContain("return borrarOrden({");
    expect(t.split("persist(").length - 1).toBe(1);
  });

  it("«Eliminar» sale con `puedeBorrar`, pregunta antes, y solo cierra si se borró", () => {
    const modal = leer("src/components/OrderModal.tsx");
    expect(modal).toContain("const borraAqui = !!existing && puedeBorrar(me, existing, settings.stores);");
    expect(modal).toContain("{existing && borraAqui && (");
    expect(modal).not.toContain('{existing && me.role === "admin" && (');
    const remove = tramo("src/components/OrderModal.tsx", "const remove = async () => {", "const deshaceAqui");
    expect(remove).toMatch(/if \(!\(await confirmAction\(/);
    expect(remove).toContain("const borrada = await deleteDelivery(existing.id);");
    expect(remove).toContain("if (!borrada) return;");
    expect(remove.indexOf("if (!borrada) return;")).toBeLessThan(remove.indexOf('notify(t("Order deleted"'));
  });
});

// ---------------------------------------------------------------------------------------------------
// «Seguir editando» un borrador o un duplicado (D-286), contra el guard VIGENTE
// ---------------------------------------------------------------------------------------------------

describe("seguir editando un borrador: el guard vigente (145) sigue dejando a quien la app se lo ofrece", () => {
  const mismaEtapa = guardVigente.slice(
    guardVigente.indexOf("if new_stage is not distinct from old_stage then"),
    guardVigente.indexOf("if r in ('sales','driver','manager','accounting') then"),
  );

  function laBaseDejaEditarBorrador(rol: UserRole): boolean {
    if (rol === "admin") return guardVigente.includes("if r = 'admin' then return NEW; end if;");
    const lineas = mismaEtapa.split("\n").filter((l) => l.includes("return NEW") && l.includes("old_stage"));
    return lineas.some((l) => l.includes(`'${rol}'`) && l.includes("'draft'"))
      || (["manager", "accounting"].includes(rol) && mismaEtapa.includes("if r in ('manager','accounting') then return NEW; end if;"));
  }

  it("rol por rol, `canEditFields` en `draft` es lo que deja el tramo de misma etapa de la 142", () => {
    expect(mismaEtapa.length).toBeGreaterThan(200);
    for (const rol of ROLE_ORDER) expect([rol, canEditFields(rol, "draft")]).toEqual([rol, laBaseDejaEditarBorrador(rol)]);
  });

  it("y el candado de autor de la 142 no lo toca: editar no reescribe `created_by`", () => {
    // La 142 rechaza un UPDATE que cambie `created_by`. La ficha guarda la orden con el autor que ya tenía;
    // si algún día lo pusiera a `me.id` al guardar, editar el borrador de otro fallaría en la base.
    expect(guardVigente).toContain("elsif NEW.created_by is distinct from OLD.created_by then");
    const modal = leer("src/components/OrderModal.tsx");
    expect(modal).not.toMatch(/created_by:\s*me\.id/);
  });
});
