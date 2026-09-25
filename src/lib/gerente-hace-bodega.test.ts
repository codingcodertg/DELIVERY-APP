import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { canTransition, gerenteHaceBodega, preparaEnLaFicha, puedeEntregarYa, recogeEnLaFicha, ROLE_ORDER } from "./constants";
import type { Stage, UserRole } from "./types";

/**
 * El gerente hace el proceso de bodega (D-397, migración 145).
 *
 * El dueño (2026-09-25): «Como gerente quiero poder hacer el proceso de bodega cuando necesario. Ahorita solo
 * permite brincar a Delivered pero no me deja poner Prepare, Ready, Pickup, etc. Esto es de office manager».
 *
 * Quién avanza lo dicen la ficha (`preparaEnLaFicha`, `recogeEnLaFicha`) y el guard de la base. Estas pruebas
 * **leen el `.sql` de la 145** y comparan rol por rol: si la ficha ofrece un paso que la base rechaza, el botón
 * falla al pulsarlo (D-044); si la base lo deja y la ficha no, el gerente sigue sin poder hacerlo.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const sql145 = leer("supabase/migrations/145_gerente_hace_bodega.sql");
const sql142 = leer("supabase/migrations/142_deshacer_almacen_y_borrar_borradores.sql");
const modal = leer("src/components/OrderModal.tsx");

/** El `create or replace function public.guard_delivery_stage()` entero, de principio a `end $function$`. */
function guardDe(sql: string): string {
  const i = sql.indexOf("create or replace function public.guard_delivery_stage()");
  const f = sql.indexOf("end $function$", i);
  expect(i).toBeGreaterThan(-1);
  expect(f).toBeGreaterThan(i);
  return sql.slice(i, f + "end $function$".length);
}
const sinComentarios = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
/** Como la autocomprobación de la 145: sin líneas de comentario y con los espacios colapsados. */
const codigo = (s: string) => sinComentarios(s).replace(/\s+/g, " ");

const guard145 = guardDe(sql145);
const guard142 = guardDe(sql142);

/** La rama que trae la 145, desde su comentario hasta su `end if;`. */
const inicioRama = guard145.indexOf("      -- 145:");
const finRama = guard145.indexOf("then return NEW; end if;\n", inicioRama) + "then return NEW; end if;\n".length;
const rama145 = guard145.slice(inicioRama, finRama);

const pares = (texto: string) => sinComentarios(texto).split("\n")
  .filter((l) => /old_stage = '\w+'\s+and new_stage = '\w+'/.test(l))
  .map((l) => ({ de: /old_stage = '(\w+)'/.exec(l)![1], a: /new_stage = '(\w+)'/.exec(l)![1] }));

/** Quién da la rama 145: el rol de su `if r = '…'`. */
const rolesDeLaRama = (/if r = '(\w+)'/.exec(sinComentarios(rama145)) ?? [])[1];
const pasosDeLaRama = pares(rama145);

/** La rama de almacén hacia delante (el primer `if … then return NEW; end if;` tras `elsif r = 'warehouse'`). */
const bloqueAlmacen = guard145.slice(guard145.indexOf("elsif r = 'warehouse' then"), guard145.indexOf("raise exception 'Warehouse cannot move"));
const almacenLibre = pares(bloqueAlmacen.slice(0, bloqueAlmacen.indexOf("then return NEW; end if;")));

/** Los saltos del chofer, en la lista de la rama común: `or (r = 'driver' and old_stage = … and new_stage = …)`. */
const pasosChofer = sinComentarios(guard145).split("\n")
  .filter((l) => l.includes("r = 'driver' and old_stage ="))
  .map((l) => ({ de: /old_stage = '(\w+)'/.exec(l)![1], a: /new_stage = '(\w+)'/.exec(l)![1] }));

/** ¿Deja la base (145) a este rol avanzar de `de` a `a`? Leído del `.sql`, no copiado. */
function laBaseDejaAvanzar(rol: UserRole, de: Stage, a: Stage): boolean {
  if (rol === "admin") return true;   // `if r = 'admin' then return NEW`
  const p = { de, a };
  const esta = (lista: { de: string; a: string }[]) => lista.some((x) => x.de === p.de && x.a === p.a);
  if (rol === "warehouse") return esta(almacenLibre);
  if (rol === "driver") return esta(pasosChofer);
  if (rol === rolesDeLaRama && esta(pasosDeLaRama)) return true;
  return false;
}

describe("la 145 se leyó de verdad (control)", () => {
  it("la rama del gerente existe, es solo del gerente, y trae los tres pasos hacia delante", () => {
    expect(inicioRama).toBeGreaterThan(-1);
    expect(rolesDeLaRama).toBe("manager");
    expect(pasosDeLaRama).toEqual([
      { de: "approved", a: "fulfilling" }, { de: "fulfilling", a: "ready" }, { de: "ready", a: "picked_up" },
    ]);
    // Y los puntos de apoyo del modelo de arriba: sin ellos compararía `false` con `false`.
    expect(almacenLibre).toContainEqual({ de: "approved", a: "fulfilling" });
    expect(almacenLibre).toContainEqual({ de: "ready", a: "picked_up" });
    expect(pasosChofer).toContainEqual({ de: "ready", a: "picked_up" });
  });
});

describe("la 145 parte de la definición VIGENTE (la 142) y solo añade su rama", () => {
  it("quitando la rama 145, el guard es el de la 142 letra por letra", () => {
    expect(guard145.replace(rama145, "")).toBe(guard142);
  });

  it("la rama va dentro del sub-bloque de gerente y office, después de su deshacer y antes de almacén", () => {
    const office = guard145.indexOf("if r in ('manager','accounting') then\n      if (old_stage = 'pending'");
    const deshacerOffice = guard145.indexOf("or (old_stage = 'fulfilling' and new_stage = 'approved') then return NEW; end if;", office);
    const almacen = guard145.indexOf("elsif r = 'warehouse' then");
    expect(office).toBeGreaterThan(-1);
    expect(deshacerOffice).toBeGreaterThan(office);
    expect(inicioRama).toBeGreaterThan(deshacerOffice);
    expect(almacen).toBeGreaterThan(inicioRama);
  });

  it("no acota por tienda: ni la rama nueva ni el «entregar ya» que ya tenía el gerente miran `orden_de_mis_tiendas`", () => {
    // La decisión (D-397): el gerente ya lleva una orden de `approved` a `delivered` en cualquier tienda (139).
    // Acotar los pasos de en medio sería un límite que no limita. Si un día se acota, esta prueba lo dice.
    expect(sinComentarios(rama145)).not.toContain("orden_de_mis_tiendas");
    const entregarYa = sinComentarios(guard145).split("\n").find((l) => l.includes("new_stage = 'delivered' and old_stage in ("));
    expect(entregarYa).toBeDefined();
    expect(entregarYa).not.toContain("orden_de_mis_tiendas");
  });

  it("sin begin/commit propios, con reversión escrita y con su fila del registro", () => {
    const vivo = sinComentarios(sql145);
    expect(vivo).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(sql145).toContain("-- Reversion (para pegar A MANO");
    expect(sql145).toMatch(/-- @ledger-below\ninsert into public\.schema_migrations \(name, checksum\) values \('145_gerente_hace_bodega\.sql', '[0-9a-f]{64}'\)/);
  });
});

describe("la autocomprobación de la 145 pasa sobre su propio guard", () => {
  // La 144 se tumbó a sí misma con un comentario dentro de la función. Aquí se reconstruye lo que busca el
  // `do $chk$` —desde el propio `.sql`— y se mira contra el código SIN comentarios, como hará Postgres.
  const chk = sql145.slice(sql145.indexOf("do $chk$"), sql145.indexOf("end $chk$;"));
  const literal = /bodega text := ((?:'(?:[^']|'')*'\s*(?:\|\|\s*)?)+);/.exec(chk);
  const buscado = literal
    ? [...literal[1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'")).join("")
    : "";

  it("la cadena que busca está en el código, y solo en el código", () => {
    expect(buscado.length).toBeGreaterThan(100);
    expect(codigo(guard145)).toContain(buscado);
    // Y en la 142 no: la comprobación distingue una de otra.
    expect(codigo(guard142)).not.toContain(buscado);
  });

  it("«Preparar» sale exactamente dos veces en el código: almacén y gerente", () => {
    const n = (s: string) => s.split("old_stage = 'approved' and new_stage = 'fulfilling'").length - 1;
    expect(chk).toContain("if n_prep <> 2 then");
    expect(n(codigo(guard145))).toBe(2);
    expect(n(codigo(guard142))).toBe(1);
  });
});

describe("la ficha y la base dicen lo mismo, rol por rol", () => {
  const u = (role: UserRole) => ({ role, permissions: [] as string[] });

  it("«Comenzar preparación» y «Marcar listo»: la ficha no ofrece nada que la base rechace", () => {
    for (const rol of ROLE_ORDER) {
      if (!preparaEnLaFicha(u(rol))) continue;
      expect([rol, laBaseDejaAvanzar(rol, "approved", "fulfilling")]).toEqual([rol, true]);
      expect([rol, laBaseDejaAvanzar(rol, "fulfilling", "ready")]).toEqual([rol, true]);
    }
  });

  it("«Recoger»: la ficha no ofrece nada que la base rechace", () => {
    for (const rol of ROLE_ORDER) {
      if (!recogeEnLaFicha(u(rol))) continue;
      expect([rol, laBaseDejaAvanzar(rol, "ready", "picked_up")]).toEqual([rol, true]);
    }
  });

  it("y al revés: a quien la 145 se lo abre (el gerente), la ficha se lo enseña", () => {
    for (const rol of ROLE_ORDER.filter((r) => r !== "admin")) {
      if (laBaseDejaAvanzar(rol, "approved", "fulfilling") && laBaseDejaAvanzar(rol, "fulfilling", "ready")) {
        expect([rol, preparaEnLaFicha(u(rol))]).toEqual([rol, true]);
      }
      if (laBaseDejaAvanzar(rol, "ready", "picked_up")) expect([rol, recogeEnLaFicha(u(rol))]).toEqual([rol, true]);
    }
  });

  it("en concreto: el gerente sí, office (`accounting`) no", () => {
    expect(gerenteHaceBodega("manager")).toBe(true);
    expect(preparaEnLaFicha(u("manager"))).toBe(true);
    expect(recogeEnLaFicha(u("manager"))).toBe(true);
    for (const rol of ["accounting", "sales", "logistics"] as UserRole[]) {
      expect([rol, gerenteHaceBodega(rol), preparaEnLaFicha(u(rol)), recogeEnLaFicha(u(rol))]).toEqual([rol, false, false, false]);
    }
    // La base dice lo mismo de office: ni preparar, ni listo, ni recoger.
    expect(laBaseDejaAvanzar("accounting", "approved", "fulfilling")).toBe(false);
    expect(laBaseDejaAvanzar("accounting", "fulfilling", "ready")).toBe(false);
    expect(laBaseDejaAvanzar("accounting", "ready", "picked_up")).toBe(false);
  });

  it("la entrega del gerente sigue siendo «Marcar entregada ya» (139), que cubre `picked_up`", () => {
    expect(puedeEntregarYa("manager", "picked_up")).toBe(true);
  });

  it("los pasos de bodega existen en la lista del cliente (si no, los dos proveedores los rechazan antes de salir)", () => {
    for (const p of pasosDeLaRama) expect([p.de, p.a, canTransition(p.de as Stage, p.a as Stage)]).toEqual([p.de, p.a, true]);
    expect(canTransition("picked_up", "delivered")).toBe(true);
  });
});

describe("la ficha pinta los botones con las funciones probadas", () => {
  const acciones = sinComentarios(modal.slice(modal.indexOf("function StageActions(")));

  it("preparar y listo salen con `preparaEnLaFicha`, y recoger con `recogeEnLaFicha`", () => {
    expect(acciones).toContain("if (preparaEnLaFicha(me)) {");
    expect(acciones).toContain('if (recogeEnLaFicha(me) && stage === "ready") {');
    // Ya no queda la puerta vieja: una segunda condición con `canFulfill` volvería a dejar fuera al gerente.
    expect(sinComentarios(modal)).not.toContain("canFulfill(");
  });

  it("«Iniciar viaje» y «En camino» siguen siendo de quien entrega, no del gerente", () => {
    expect(acciones).toContain("if (canDeliver(me) && !departedAt) {");
    expect(acciones).toContain("} else if (canDeliver(me) && departedAt) {");
    // Y el gerente recoge con el recuento en dos pasos, no con el toque único del chofer.
    expect(acciones).toContain('onClick={me.role === "driver" ? onQuickPickup : onRequestPickup}');
  });

  it("«Marcar entregado» (con su prueba de entrega) sigue siendo solo de quien entrega", () => {
    expect(acciones).toContain('if (canDeliver(me) && stage === "picked_up" && !podOpen) {');
  });
});
