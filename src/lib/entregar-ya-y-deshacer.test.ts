import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  canTransition, etapaAnterior, ETAPAS_QUE_ENTREGAN_YA, puedeDeshacer, puedeEntregarYa,
  ROLE_ORDER, STAGES,
} from "./constants";
import type { Stage, UserRole } from "./types";

/**
 * Office y el gerente entregan de inmediato y deshacen un paso (D-361, migración 139).
 *
 * Quién puede dar cada salto lo dicen DOS sitios —la app y el guard de la base—, así que estas pruebas no copian
 * la tabla: **la leen del `.sql`** y comparan rol por rol y etapa por etapa. Si un día se separan, cae aquí y no
 * cuando alguien pulse un botón que la base rechaza, que es el fallo de D-044 y el que cazó la prueba espejo de
 * la 122.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const sql = leer("supabase/migrations/139_office_entrega_y_deshace.sql");
const modal = leer("src/components/OrderModal.tsx");

/** El tramo del guard que decide los cambios de etapa de ventas, chofer, gerente y office. */
const bloqueEtapas = sql.slice(
  sql.indexOf("if r in ('sales','driver','manager','accounting') then"),
  sql.indexOf("elsif r = 'warehouse' then"),
);
/** Dentro de ese tramo, el sub-bloque que la 139 añade para gerente y office. */
const bloqueOffice = bloqueEtapas.slice(bloqueEtapas.indexOf("if r in ('manager','accounting') then"));

/** ¿La base deja a este rol ENTREGAR YA desde esta etapa? Leído del `.sql`, no copiado. */
function laBaseDejaEntregarYa(rol: UserRole, etapa: Stage): boolean {
  if (rol === "admin") return true;                       // `if r = 'admin' then return NEW`
  if (rol !== "manager" && rol !== "accounting") return false;
  const linea = bloqueOffice.split("\n").find((l) => l.includes("new_stage = 'delivered' and old_stage in ("));
  if (!linea) return false;
  const etapas = /old_stage in \(([^)]*)\)/.exec(linea);
  return !!etapas && etapas[1].split(",").map((x) => x.trim().replace(/'/g, "")).includes(etapa);
}

/** Los pasos atrás que el `.sql` nombra para gerente y office, como pares. */
const pasosAtrasDelSql = bloqueOffice
  .split("\n")
  .filter((l) => /old_stage = '\w+'\s+and new_stage = '\w+'/.test(l))
  .map((l) => {
    const de = /old_stage = '(\w+)'/.exec(l)![1];
    const a = /new_stage = '(\w+)'/.exec(l)![1];
    return { de, a };
  });

function laBaseDejaDeshacer(rol: UserRole, etapa: Stage): boolean {
  if (rol === "admin") return true;
  if (rol !== "manager" && rol !== "accounting") return false;
  const destino = etapaAnterior(etapa);
  return !!destino && pasosAtrasDelSql.some((p) => p.de === etapa && p.a === destino);
}

describe("el tramo del guard se leyó de verdad (control)", () => {
  it("el sub-bloque de office existe y trae los saltos nuevos", () => {
    expect(bloqueEtapas.length).toBeGreaterThan(400);
    expect(bloqueOffice).toContain("new_stage = 'delivered' and old_stage in (");
    // Los cuatro pasos atrás de la 139, más los dos que ya venían de la 118/127 en el mismo bloque.
    expect(pasosAtrasDelSql.length).toBeGreaterThanOrEqual(4);
    expect(pasosAtrasDelSql).toContainEqual({ de: "delivered", a: "picked_up" });
    expect(pasosAtrasDelSql).toContainEqual({ de: "fulfilling", a: "approved" });
  });
});

describe("entregar ya: la app y la base dicen lo mismo", () => {
  it("rol por rol y etapa por etapa, sin copiar la tabla", () => {
    for (const rol of ROLE_ORDER) {
      for (const s of STAGES.map((x) => x.key)) {
        // Igualdad para todos menos el admin: él se salta el guard, así que la base le deja todo y la app le
        // ofrece a propósito solo los saltos que significan algo. Para él, la invariante es la de siempre: la
        // app no ofrece NADA que la base rechace.
        if (rol === "admin") expect([rol, s, puedeEntregarYa(rol, s) && !laBaseDejaEntregarYa(rol, s)]).toEqual([rol, s, false]);
        else expect([rol, s, puedeEntregarYa(rol, s)]).toEqual([rol, s, laBaseDejaEntregarYa(rol, s)]);
      }
    }
  });

  it("las cuatro etapas que entregan ya, y las que no", () => {
    expect([...ETAPAS_QUE_ENTREGAN_YA].sort()).toEqual(["approved", "fulfilling", "picked_up", "ready"]);
    for (const s of ["draft", "pending", "rejected", "delivered", "canceled"] as Stage[]) {
      expect([s, puedeEntregarYa("accounting", s)]).toEqual([s, false]);
    }
  });

  it("ventas, chofer, almacén y logística NO entregan por esta vía", () => {
    for (const rol of ["sales", "driver", "warehouse", "logistics"] as UserRole[]) {
      for (const s of ETAPAS_QUE_ENTREGAN_YA) expect([rol, s, puedeEntregarYa(rol, s)]).toEqual([rol, s, false]);
    }
  });
});

describe("deshacer un paso: uno solo, y el inmediato", () => {
  it("rol por rol y etapa por etapa, contra el `.sql`", () => {
    for (const rol of ROLE_ORDER) {
      for (const s of STAGES.map((x) => x.key)) {
        if (rol === "admin") expect([rol, s, puedeDeshacer(rol, s) && !laBaseDejaDeshacer(rol, s)]).toEqual([rol, s, false]);
        else expect([rol, s, puedeDeshacer(rol, s)]).toEqual([rol, s, laBaseDejaDeshacer(rol, s)]);
      }
    }
  });

  it("la cadena de vuelta va de una en una, y `draft`/`rejected`/`canceled` no vuelven a ningún sitio", () => {
    expect(etapaAnterior("delivered")).toBe("picked_up");
    expect(etapaAnterior("picked_up")).toBe("ready");
    expect(etapaAnterior("ready")).toBe("fulfilling");
    expect(etapaAnterior("fulfilling")).toBe("approved");
    expect(etapaAnterior("approved")).toBe("pending");
    for (const s of ["draft", "pending", "rejected", "canceled"] as Stage[]) expect([s, etapaAnterior(s)]).toEqual([s, null]);
  });

  it("el salto existe también en la lista del cliente, o los dos proveedores lo rechazan antes de salir", () => {
    // `delivered: []` era el caso: sin esto, el botón fallaba en el navegador sin llegar a la base.
    expect(canTransition("delivered", "picked_up")).toBe(true);
    expect(canTransition("picked_up", "ready")).toBe(true);
    expect(canTransition("ready", "fulfilling")).toBe(true);
    expect(canTransition("fulfilling", "approved")).toBe(true);
    // Y lo que NO se abrió: dos pasos de golpe sigue sin existir.
    expect(canTransition("delivered", "ready")).toBe(false);
  });
});

describe("la ficha de la orden pide motivo y avisa de lo que se pierde", () => {
  it("los dos botones se pintan con las funciones probadas, no con una lista de roles a mano", () => {
    const i = modal.indexOf("ENTREGAR YA / DESHACER UN PASO");
    expect(i).toBeGreaterThan(-1);
    const tramo = modal.slice(i, modal.indexOf("{!editing && existing && existing.stage === \"delivered\"", i));
    expect(tramo).toContain("puedeEntregarYa(me.role, existing.stage)");
    expect(tramo).toContain("puedeDeshacer(me.role, existing.stage)");
    expect(tramo).toContain("etapaAnterior(existing.stage)!");
  });

  it("sin motivo no se puede confirmar, y la nota del historial lo lleva dentro", () => {
    const i = modal.indexOf("ENTREGAR YA / DESHACER UN PASO");
    const tramo = modal.slice(i, modal.indexOf("{!editing && existing && existing.stage === \"delivered\"", i));
    expect(tramo).toContain("disabled={busy || !motivoDeSalto.trim()}");
    expect(modal).toContain("Entregada por oficina (sin firma): ${motivoDeSalto.trim()}");
    expect(modal).toContain("Etapa deshecha (fue un error): ${motivoDeSalto.trim()}");
    // Y el aviso de que no hay firma: cerrar una orden sin POD no puede pasar en silencio.
    expect(tramo).toContain("No se registra firma ni GPS");
  });
});
