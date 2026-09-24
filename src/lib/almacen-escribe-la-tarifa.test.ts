import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canEditFields } from "./constants";
import type { Stage, UserRole } from "./types";

/**
 * Almacén vuelve a poder escribir la tarifa (D-NEXT), que es el efecto colateral que dejó D-340 al quitar el diálogo.
 * Sin jsdom no se puede montar la ficha, así que esto fija el GATE y que no abra nada más; lo que se ve en pantalla está
 * medido en el navegador y anotado en la entrada.
 */

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const ficha = leer("src/components/OrderModal.tsx");

describe("el gate de la tarifa es propio, no el de ventas ni el de almacén", () => {
  it("es la unión de los dos, escrita una vez", () => {
    expect(ficha).toContain("const tarifaEditable = salesFields || whFields;");
  });
  it("almacén NO se mete dentro de `salesFields`, que sigue siendo el de ventas", () => {
    expect(ficha).toContain('const salesFields = editing && (isNew || me.role === "sales" || me.role === "admin" || ordersLikeOfficeManager(me.role));');
    expect(ficha).not.toMatch(/const salesFields = [^;]*warehouse/);
  });
  it("ni ventas dentro del de almacén", () => {
    expect(ficha).toContain('const whFields = editing && (me.role === "warehouse" || me.role === "admin");');
  });
  it("el campo de la tarifa cuelga del gate nuevo", () => {
    expect(ficha).toContain('on={(v) => set("delivery_fee", v === "" ? null : Number(v))} disabled={!tarifaEditable}');
  });
  it("y los botones de Lista y Descuento, del mismo: teclear la tarifa a ciegas es peor", () => {
    expect(plano(ficha)).toContain("{tarifaEditable && (d.delivery_address || \"\").trim() && (");
    const tarjeta = ficha.slice(ficha.indexOf("{tarifaEditable && (d.delivery_address"), ficha.indexOf("Calculate the route below"));
    expect(tarjeta).toContain('t("List", "Lista")');
    expect(tarjeta).toContain('t("Discount", "Descuento")');
  });
});

describe("no se abre de rebote ningún otro campo de ventas", () => {
  it("los demás controles siguen colgando de `salesFields`, uno por uno", () => {
    // Si alguien «arregla» esto cambiando `salesFields` en vez de usar el gate, este número se mueve y la prueba cae.
    expect((ficha.match(/disabled=\{!salesFields\}/g) ?? []).length).toBe(21);
    expect((ficha.match(/disabled=\{!tarifaEditable\}/g) ?? []).length).toBe(1);
  });
  it("los campos que son de ventas y NO de la tarifa siguen cerrados para almacén", () => {
    // Por LÍNEA del control, no por recorte alrededor del texto: el nombre suelto aparece en sitios que no son el campo.
    const lineas = ficha.split(String.fromCharCode(10));
    for (const etiqueta of ["Order Type", "Est. Pallets (sales)", "Delivery Date", "Invoice #", "Contact name", "Phone number"]) {
      const control = lineas.filter((l) => l.includes(`label={t("${etiqueta}"`) && /<(Txt|Sel|WindowSel)/.test(l));
      expect(control.length, `${etiqueta}: controles encontrados`).toBeGreaterThan(0);
      for (const l of control) {
        expect(l, etiqueta).toContain("disabled={!salesFields}");
        expect(l, etiqueta).not.toContain("tarifaEditable");
      }
    }
  });
  it("y el campo de almacén sigue siendo el suyo", () => {
    expect(ficha).toMatch(/Actual Pallets \(warehouse\)[\s\S]{0,400}disabled=\{!whFields\}/);
  });
});

describe("las etapas en las que almacén llega a editar", () => {
  it("son las que ya decía `canEditFields`, y esto no las cambia", () => {
    const abiertas: Stage[] = ["approved", "fulfilling", "ready", "picked_up", "delivered"];
    const cerradas: Stage[] = ["draft", "pending", "rejected", "canceled"];
    for (const s of abiertas) expect(canEditFields("warehouse", s), s).toBe(true);
    for (const s of cerradas) expect(canEditFields("warehouse", s), s).toBe(false);
  });
  it("un chofer o un vendedor no ganan nada con esto", () => {
    for (const r of ["driver", "sales"] as UserRole[]) {
      expect(canEditFields(r, "fulfilling"), r).toBe(false);          // ni entran en modo edición ahí
    }
    // Y ventas, donde sí edita, ya tenía la tarifa por `salesFields`: para ella no cambia nada.
    expect(canEditFields("sales", "pending")).toBe(true);
  });
});

describe("los dos sitios que el cambio NO toca, dichos para que no parezcan olvido", () => {
  it("la otra pareja de Lista y Descuento es la del pedido nuevo, y esa ya la abría `isNew`", () => {
    // OrderModal tiene DOS veces los botones (D-303 y D-249). La de arriba vive dentro de
    // `{editing && paso === "inicial"}`, que es el alta paso a paso: ahí `salesFields` ya es true por `isNew`,
    // así que meterle el gate no cambiaría nada y sí haría pensar que almacén crea órdenes.
    const inicial = ficha.slice(ficha.indexOf('{editing && paso === "inicial" && ('), ficha.indexOf('{editing && paso === "completo" && ('));
    expect(inicial).toContain('t("Discount", "Descuento")');
    expect(inicial).not.toContain("tarifaEditable");
    expect(ficha).toContain("const salesFields = editing && (isNew ||");
  });
  it("el comentario de D-340 ya no dice lo que había dejado de ser verdad", () => {
    // Se corrige con una nota dentro, no borrando: la frase vieja se cita para que se entienda qué se arregla.
    const bloque = ficha.slice(ficha.indexOf("Aquí vivían `startSinTarifa`"), ficha.indexOf("Guardar «agregar material»"));
    expect(bloque).not.toContain("**nadie que no sea ventas escribe ya");
    expect(bloque).toContain("describía el agujero, no la intención");
  });
});

describe("y el historial dice QUIEN la cambio, que es lo que se fue a mirar", () => {
  const demo = leer("src/lib/local-data-provider.tsx");
  it("todo callback que escribe un evento lleva `me` en sus dependencias", () => {
    // Medido en el navegador el 2026-09-23: almacén cambió la tarifa de 126 a 80 y el evento salió firmado por
    // `u-admin`. `addEvent` firma con `me.id`, y `updateDelivery` era el único de los cuatro que lo dejaba fuera del
    // array de dependencias, así que se quedó con el `me` del primer render. Viene de antes de D-372; la nota con
    // valores solo lo hizo visible. Esto es del DEMO: en la app de verdad firma la base, no este fichero.
    const trozos = demo.split("addEvent(").slice(1);
    expect(trozos.length).toBeGreaterThanOrEqual(4);
    for (const trozo of trozos) {
      const cierre = trozo.match(/\}, \[([^\]]*)\]\);/);
      if (!cierre) continue;                                    // el propio `const addEvent = ...`, que no es un callback
      expect(cierre[1].split(",").map((s) => s.trim()), cierre[1]).toContain("me");
    }
  });
  it("y el de editar en concreto, que es el que escribe la línea de la tarifa", () => {
    expect(demo).toContain("  }, [me, persist, notify]);   // `me` en las dependencias: `addEvent` firma con `me.id`");
  });
});
