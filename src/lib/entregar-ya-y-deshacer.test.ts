import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  canTransition, etapaAnterior, ETAPAS_QUE_ALMACEN_DESHACE, ETAPAS_QUE_ENTREGAN_YA, puedeDeshacer, puedeEntregarYa,
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
 *
 * **Desde D-383 lee la 142**, que es la definición vigente del guard, y modela almacén de verdad. Hasta entonces
 * leía la 139 y trataba a almacén como «la base no le deja deshacer nada», lo cual ya era falso con la 139 (le
 * dejaba tres pasos en cualquier tienda): la prueba pasaba porque comparaba `false` con `false`.
 *
 * **Desde D-NEXT lee la 145**, que es la definición vigente: la 142 más la rama del gerente que hace bodega
 * (avanzar hacia delante). Esa rama vive dentro del sub-bloque de gerente y office, así que se corta aquí para
 * que sus pasos hacia delante no se lean como pasos atrás de office; se prueba en `gerente-hace-bodega.test.ts`.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const sql = leer("supabase/migrations/145_gerente_hace_bodega.sql");
const modal = leer("src/components/OrderModal.tsx");

/** El tramo del guard que decide los cambios de etapa de ventas, chofer, gerente y office. */
const bloqueEtapas = sql.slice(
  sql.indexOf("if r in ('sales','driver','manager','accounting') then"),
  sql.indexOf("elsif r = 'warehouse' then"),
);
/** Dentro de ese tramo, el sub-bloque que la 139 añade para gerente y office, hasta donde empieza la rama de la 145. */
const inicioOffice = bloqueEtapas.indexOf("if r in ('manager','accounting') then");
const inicio145 = bloqueEtapas.indexOf("-- 145:", inicioOffice);
const bloqueOffice = bloqueEtapas.slice(inicioOffice, inicio145);

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

/**
 * La rama de almacén del guard (142), partida en dos: los saltos que pasan en cualquier tienda (el primer
 * `if … then return NEW; end if;`) y los que solo pasan si `orden_de_mis_tiendas(OLD…)` dice que sí.
 */
const bloqueAlmacen = sql.slice(sql.indexOf("elsif r = 'warehouse' then"), sql.indexOf("raise exception 'Warehouse cannot move"));
const corteAlmacen = bloqueAlmacen.indexOf("then return NEW; end if;");
const pares = (texto: string) => texto.split("\n")
  .filter((l) => !l.trim().startsWith("--") && /old_stage = '\w+'\s+and new_stage = '\w+'/.test(l))
  .map((l) => ({ de: /old_stage = '(\w+)'/.exec(l)![1], a: /new_stage = '(\w+)'/.exec(l)![1] }));
const almacenLibre = pares(bloqueAlmacen.slice(0, corteAlmacen));
const tramoConTienda = bloqueAlmacen.slice(corteAlmacen);
const almacenConTienda = pares(tramoConTienda);

function laBaseDejaDeshacer(rol: UserRole, etapa: Stage, deMiTienda: boolean): boolean {
  if (rol === "admin") return true;
  const destino = etapaAnterior(etapa);
  if (!destino) return false;
  if (rol === "warehouse") {
    if (almacenLibre.some((p) => p.de === etapa && p.a === destino)) return true;
    return deMiTienda && almacenConTienda.some((p) => p.de === etapa && p.a === destino);
  }
  if (rol !== "manager" && rol !== "accounting") return false;
  return pasosAtrasDelSql.some((p) => p.de === etapa && p.a === destino);
}

describe("el tramo del guard se leyó de verdad (control)", () => {
  it("el sub-bloque de office existe y trae los saltos nuevos", () => {
    expect(bloqueEtapas.length).toBeGreaterThan(400);
    expect(bloqueOffice).toContain("new_stage = 'delivered' and old_stage in (");
    // Los cuatro pasos atrás de la 139, más los dos que ya venían de la 118/127 en el mismo bloque.
    expect(pasosAtrasDelSql.length).toBeGreaterThanOrEqual(4);
    expect(pasosAtrasDelSql).toContainEqual({ de: "delivered", a: "picked_up" });
    expect(pasosAtrasDelSql).toContainEqual({ de: "fulfilling", a: "approved" });
    // El corte de la 145 existe y va DESPUÉS del sub-bloque, y ningún paso hacia delante se leyó como paso atrás.
    expect(inicioOffice).toBeGreaterThan(-1);
    expect(inicio145).toBeGreaterThan(inicioOffice);
    for (const adelante of [{ de: "approved", a: "fulfilling" }, { de: "fulfilling", a: "ready" }, { de: "ready", a: "picked_up" }]) {
      expect(pasosAtrasDelSql).not.toContainEqual(adelante);
    }
  });

  it("la rama de almacén se partió donde la 142 pone el límite de tienda", () => {
    // Hacia delante y picked_up -> ready (D-224), en cualquier tienda.
    expect(almacenLibre).toContainEqual({ de: "approved", a: "fulfilling" });
    expect(almacenLibre).toContainEqual({ de: "picked_up", a: "ready" });
    // Los tres pasos atrás, y solo esos, detrás de `orden_de_mis_tiendas` de la orden COMO ESTABA.
    expect(tramoConTienda).toContain("public.orden_de_mis_tiendas(OLD.store, OLD.pickup_name, OLD.delivery_name, OLD.pickup_address)");
    expect(almacenConTienda).toEqual([
      { de: "delivered", a: "picked_up" }, { de: "ready", a: "fulfilling" }, { de: "fulfilling", a: "approved" },
    ]);
    // Y ninguno de los tres se coló también en el tramo libre.
    for (const p of almacenConTienda) expect(almacenLibre).not.toContainEqual(p);
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

  it("cada etapa desde la que la ficha ofrece «entregar ya» existe en la lista del cliente", () => {
    // Faltaba desde D-361 y lo cazó el demo (D-NEXT, 2026-09-25): `LEGAL_TRANSITIONS` no tenía `delivered` desde
    // approved, fulfilling ni ready, y los dos proveedores rechazaban el salto antes de llegar a la base con
    // «This order must be approved by a manager first.». La prueba de arriba comparaba la ficha con el `.sql` y
    // pasaba: el hueco estaba en la tercera pieza, la que ninguna de las dos miraba.
    for (const rol of ROLE_ORDER) {
      for (const s of STAGES.map((x) => x.key)) {
        if (puedeEntregarYa(rol, s)) expect([rol, s, canTransition(s, "delivered")]).toEqual([rol, s, true]);
        for (const deMiTienda of [true, false]) {
          const atras = etapaAnterior(s);
          if (puedeDeshacer(rol, s, deMiTienda) && atras) expect([rol, s, atras, canTransition(s, atras)]).toEqual([rol, s, atras, true]);
        }
      }
    }
  });

  it("ventas, chofer, almacén y logística NO entregan por esta vía", () => {
    for (const rol of ["sales", "driver", "warehouse", "logistics"] as UserRole[]) {
      for (const s of ETAPAS_QUE_ENTREGAN_YA) expect([rol, s, puedeEntregarYa(rol, s)]).toEqual([rol, s, false]);
    }
  });
});

describe("deshacer un paso: uno solo, y el inmediato", () => {
  it("rol por rol, etapa por etapa y en mi tienda o en otra, contra el `.sql`", () => {
    for (const rol of ROLE_ORDER) {
      for (const s of STAGES.map((x) => x.key)) {
        for (const deMiTienda of [true, false]) {
          const app = puedeDeshacer(rol, s, deMiTienda);
          const base = laBaseDejaDeshacer(rol, s, deMiTienda);
          // El admin se salta el guard: la invariante para él es que la app no ofrece nada que la base rechace.
          if (rol === "admin") expect([rol, s, deMiTienda, app && !base]).toEqual([rol, s, deMiTienda, false]);
          // Almacén en `picked_up`: la base le deja `picked_up -> ready` en cualquier tienda, y la ficha NO lo
          // ofrece como «Deshacer», a propósito: ese salto ya es «Dejar en tienda» (D-224). Más estrecha que la
          // base no produce errores; lo que no puede pasar es lo contrario.
          else if (rol === "warehouse" && s === "picked_up") expect([rol, s, deMiTienda, app]).toEqual([rol, s, deMiTienda, false]);
          else expect([rol, s, deMiTienda, app]).toEqual([rol, s, deMiTienda, base]);
        }
      }
    }
  });

  it("almacén deshace delivered, ready y fulfilling SOLO en sus tiendas, y nunca approved -> pending", () => {
    expect([...ETAPAS_QUE_ALMACEN_DESHACE].sort()).toEqual(["delivered", "fulfilling", "ready"]);
    for (const s of ETAPAS_QUE_ALMACEN_DESHACE) {
      expect([s, puedeDeshacer("warehouse", s, true)]).toEqual([s, true]);
      expect([s, puedeDeshacer("warehouse", s, false)]).toEqual([s, false]);
      // Quien no pasa la tienda no le da nada a almacén: el valor por defecto falla cerrado.
      expect([s, puedeDeshacer("warehouse", s)]).toEqual([s, false]);
    }
    expect(puedeDeshacer("warehouse", "approved", true)).toBe(false);
    expect(puedeDeshacer("warehouse", "picked_up", true)).toBe(false);
  });

  it("office y gerente, igual que en D-361: los cinco pasos, sin mirar la tienda", () => {
    for (const rol of ["manager", "accounting"] as UserRole[]) {
      for (const s of ["delivered", "picked_up", "ready", "fulfilling", "approved"] as Stage[]) {
        expect([rol, s, puedeDeshacer(rol, s, false)]).toEqual([rol, s, true]);
      }
    }
  });

  it("ventas, chofer y logística siguen sin deshacer, ni en su tienda", () => {
    for (const rol of ["sales", "driver", "logistics"] as UserRole[]) {
      for (const s of STAGES.map((x) => x.key)) expect([rol, s, puedeDeshacer(rol, s, true)]).toEqual([rol, s, false]);
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
    expect(tramo).toContain("deshaceAqui");
    expect(tramo).toContain("etapaAnterior(existing.stage)!");
    // Y `deshaceAqui` es la función probada, con la tienda de la ORDEN contra la MÍA (D-383, 142).
    expect(modal).toContain("const deshaceAqui = !!existing && puedeDeshacer(me.role, existing.stage, ordenDeMisTiendas(existing, me.store, settings.stores));");
  });

  it("«Volver a preparando» (D-287) ya no es un botón aparte, sin motivo", () => {
    // Almacén deshace `ready` con el diálogo general. El botón viejo escribía una nota fija y no pedía motivo.
    expect(modal).not.toContain("onBackToPreparing");
    expect(modal).not.toContain("const volverAPreparar");
    expect(modal).not.toContain("Vuelve a preparación (se marcó listo por error)");
  });

  it("sin motivo no se puede confirmar, y la nota del historial lo lleva dentro", () => {
    const i = modal.indexOf("ENTREGAR YA / DESHACER UN PASO");
    const tramo = modal.slice(i, modal.indexOf("{!editing && existing && existing.stage === \"delivered\"", i));
    expect(tramo).toContain("disabled={busy || !motivoDeSalto.trim()}");
    // Y la función que escribe tampoco sigue sin motivo: el botón deshabilitado no es la única puerta.
    const deshacer = modal.slice(modal.indexOf("const deshacerEtapa"), modal.indexOf("const deshacerEtapa") + 400);
    expect(deshacer).toContain("if (!existing || !atras || !motivoDeSalto.trim()) return;");
    expect(modal).toContain("Entregada por oficina (sin firma): ${motivoDeSalto.trim()}");
    expect(modal).toContain("Etapa deshecha (fue un error): ${motivoDeSalto.trim()}");
    // Y el aviso de que no hay firma: cerrar una orden sin POD no puede pasar en silencio.
    expect(tramo).toContain("No se registra firma ni GPS");
  });
});
