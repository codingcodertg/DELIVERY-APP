import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { choferDelMapa } from "./chofer-del-mapa";
import { ROLE_ORDER } from "@/lib/constants";
import type { UserRole } from "@/lib/types";

/**
 * D-508 · El mapa de `/my-route/mapa` es el del chofer que se pide, y solo si quien lo pide puede pedirlo.
 *
 * Los datos van a propósito con DOS choferes y el pedido apuntando al OTRO: si la función devolviera siempre el primero
 * de la lista, o siempre el propio, una de las dos pruebas caería.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

const admin = { id: "u-admin", full_name: "Ana Admin", role: "admin" as UserRole };
const chofer = { id: "u-drv1", full_name: "Diego Driver", role: "driver" as UserRole };
const otro = { id: "u-drv2", full_name: "Miguel Otro", role: "driver" as UserRole };
const USERS = [chofer, otro].map((u) => ({ id: u.id, full_name: u.full_name }));

describe("de quién es el mapa", () => {
  it("el admin pide el de un chofer y se lo lleva — el OTRO de la lista, no el primero", () => {
    expect(choferDelMapa(admin, "u-drv2", USERS)).toEqual({ id: "u-drv2", full_name: "Miguel Otro" });
    expect(choferDelMapa(admin, "u-drv1", USERS)).toEqual({ id: "u-drv1", full_name: "Diego Driver" });
  });

  it("un chofer que pide el de su compañero recibe EL SUYO, no el de su compañero", () => {
    expect(choferDelMapa(chofer, "u-drv2", USERS)).toEqual({ id: "u-drv1", full_name: "Diego Driver" });
  });

  it("ningún rol que no sea admin puede pedir el de otro — se recorre la lista, no se escribe a mano", () => {
    for (const rol of ROLE_ORDER.filter((r) => r !== "admin")) {
      const yo = { id: "yo", full_name: "Quien Mira", role: rol };
      expect([rol, choferDelMapa(yo, "u-drv2", USERS)!.id]).toEqual([rol, "yo"]);
    }
  });

  it("sin pedido, con el pedido vacío o pidiéndose a sí mismo: el suyo", () => {
    for (const p of [null, undefined, "", "   ", "u-drv1"]) {
      expect([String(p), choferDelMapa(chofer, p, USERS)!.id]).toEqual([String(p), "u-drv1"]);
    }
  });

  it("un id que no existe cae al propio, no a nada ni a otro", () => {
    expect(choferDelMapa(admin, "u-no-existe", USERS)).toEqual({ id: "u-admin", full_name: "Ana Admin" });
  });

  it("sin sesión no hay mapa", () => {
    expect(choferDelMapa(null, "u-drv2", USERS)).toBeNull();
  });
});

describe("la pantalla lo usa, y el enlace lleva el chofer", () => {
  it("el mapa resuelve el chofer con la función probada y acota con lo que devuelve", () => {
    const p = leer("src/app/(app)/my-route/mapa/page.tsx");
    const i = p.indexOf("choferDelMapa(");
    expect(i).toBeGreaterThan(-1);
    expect(p).toContain('searchParams.get("chofer")');
    expect(p).toContain("<SoloMisRutas chofer={delMapa.full_name}>");
  });

  // Nota D-NEXT: esta prueba fijaba que «Mi ruta» enseñaba el enlace «🗓 Ver la ruta completa» también al mirar la ruta de
  // otro, con SU id (D-508). El dueño lo quitó: «FULL ROUTE VIEW PLEASE QUITALO DEL DRIVER VIEW». Ahora fija que no está,
  // ni para el chofer ni en la pestaña «Chofer» del admin (que monta la misma página). `/my-route/mapa` sigue existiendo.
  it("«Mi ruta» ya no enlaza la vista completa, ni al mirar la de otro (D-NEXT)", () => {
    const p = leer("src/app/(app)/my-route/page.tsx");
    expect(p).not.toContain("data-mapa-de-mi-ruta");
    expect(p).not.toContain("href={ajeno ? `/my-route/mapa");
    expect(p).not.toContain("Full route view");
  });
});
