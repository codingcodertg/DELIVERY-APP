import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { alcanceDeEdicion, parcheSoloFecha } from "./edicion-de-ventas";
import { canEditFields, STAGES } from "./constants";
import type { Stage, UserRole } from "./types";

/**
 * Ventas solo cambia la FECHA de sus órdenes (D-480). El dueño, 2026-10-06: «sales people cna edit only the
 * date of their orders».
 *
 * La regla vive en `alcanceDeEdicion`; que la ficha la USA —botón, campos y lo que guarda— se comprueba leyendo
 * el fuente, porque vitest corre sin DOM. Lo medido en el navegador está en la entrada de DECISIONS.md.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const ficha = sinComentarios(leer("src/components/OrderModal.tsx"));

const YO = "u-sales";
const orden = (stage: Stage, extra: Partial<{ created_by: string | null; assigned_sales_rep: string | null }> = {}) =>
  ({ stage, created_by: YO, assigned_sales_rep: null, ...extra });
const ventas = (o: ReturnType<typeof orden> | null) => alcanceDeEdicion({ rol: "sales", miId: YO, orden: o });

describe("alcanceDeEdicion: ventas", () => {
  it("en una orden suya pendiente o rechazada: solo la fecha", () => {
    expect(ventas(orden("pending"))).toBe("solo_fecha");
    expect(ventas(orden("rejected"))).toBe("solo_fecha");
  });

  it("suya por asignación cuenta igual que suya por creación (orderOwner): el asignado manda", () => {
    expect(ventas(orden("pending", { created_by: "otro", assigned_sales_rep: YO }))).toBe("solo_fecha");
    // Creada por mí pero asignada a otro: es de ese otro, no mía.
    expect(ventas(orden("pending", { created_by: YO, assigned_sales_rep: "otro" }))).toBe("nada");
  });

  it("una orden ajena no se toca, ni la fecha", () => {
    expect(ventas(orden("pending", { created_by: "otro" }))).toBe("nada");
    expect(ventas(orden("rejected", { created_by: "otro", assigned_sales_rep: null }))).toBe("nada");
  });

  it("un borrador se sigue editando entero (D-286): un borrador que solo deja cambiar la fecha no se puede terminar", () => {
    expect(ventas(orden("draft"))).toBe("todo");
    expect(ventas(orden("draft", { created_by: "otro" }))).toBe("todo");
  });

  it("aprobada y después: nada, ni la fecha — el guard de la base rechaza cualquier escritura de ventas ahí (medido 2026-10-06)", () => {
    for (const s of ["approved", "fulfilling", "ready", "picked_up", "delivered", "canceled"] as Stage[]) {
      expect([s, ventas(orden(s))]).toEqual([s, "nada"]);
    }
  });

  it("una orden nueva se rellena entera", () => {
    expect(ventas(null)).toBe("todo");
  });
});

describe("alcanceDeEdicion: los demás roles no cambian", () => {
  it("responden lo que ya decía canEditFields, etapa por etapa: todo o nada, nunca «solo la fecha»", () => {
    const roles: UserRole[] = ["admin", "manager", "accounting", "logistics", "warehouse", "driver"];
    for (const rol of roles) {
      for (const s of STAGES) {
        const esperado = canEditFields(rol, s.key) ? "todo" : "nada";
        expect([rol, s.key, alcanceDeEdicion({ rol, miId: "x", orden: orden(s.key, { created_by: "otro" }) })]).toEqual([rol, s.key, esperado]);
      }
    }
  });
});

describe("parcheSoloFecha: lo único que viaja a la base", () => {
  it("es la fecha y nada más, aunque el formulario lleve la orden entera", () => {
    const d = { delivery_date: "2026-10-09", contact: "Rosa", delivery_fee: 75, stage: "pending" } as never;
    expect(parcheSoloFecha(d)).toEqual({ delivery_date: "2026-10-09" });
    expect(Object.keys(parcheSoloFecha(d))).toEqual(["delivery_date"]);
  });
});

describe("la ficha (OrderModal) usa la regla, no canEditFields a secas", () => {
  it("una sola respuesta, calculada de la orden abierta y de quien mira", () => {
    expect(ficha).toContain("const alcance: AlcanceDeEdicion = alcanceDeEdicion({ rol: me.role, miId: me.id, orden: existing });");
    expect(ficha).toContain('const editable = isNew || (startEditing && alcance !== "nada");');
  });

  it("los campos de ventas solo con el formulario entero; «solo fecha» es su propio modo", () => {
    expect(ficha).toContain('const salesFields = editing && alcance === "todo" && (');
    expect(ficha).toContain('const soloFecha = editing && !isNew && alcance === "solo_fecha";');
    // El formulario entero (los dos pasos y la lista de faltantes) se apaga en ese modo…
    expect(ficha).toContain('{editing && !soloFecha && paso === "inicial" && (');
    expect(ficha).toContain('{editing && !soloFecha && paso === "completo" && (');
    expect(ficha).toContain('{editing && !soloFecha && paso === "completo" && missing.length > 0 && (');
    // …y en su lugar hay UN campo: la fecha, habilitado.
    const bloque = ficha.slice(ficha.indexOf("{soloFecha && ("), ficha.indexOf('{editing && !soloFecha && paso === "completo" && ('));
    expect(bloque).toContain('<Txt label={t("New delivery date", "Nueva fecha de entrega")} type="date" val={d.delivery_date} on={(v) => set("delivery_date", v)}');
    expect(bloque).not.toContain("disabled=");
    expect(bloque).toContain("Solo puede cambiar la fecha de entrega de esta orden");
  });

  it("al guardar viaja solo la fecha, por parcheSoloFecha, y sin fecha no se guarda", () => {
    expect(ficha).toContain('if (!isNew && alcance === "solo_fecha") {');
    expect(ficha).toContain("const ok = await updateDelivery(existing!.id, parcheSoloFecha(d));");
    expect(ficha).toContain('if (!d.delivery_date) { notify(t("Pick a delivery date.", "Elija una fecha de entrega.")); return; }');
  });

  it("el botón «Editar» y «Cancelar edición» salen del alcance, y el botón dice «Editar fecha» cuando es solo eso", () => {
    // Nota D-497: «Editar» es una opción del menú «Acciones ▾»; su condición y su texto viven en
    // `lib/acciones-de-la-ficha.ts`, que la ficha llama con `edicion`. Allí se buscan.
    const acciones = sinComentarios(leer("src/lib/acciones-de-la-ficha.ts"));
    expect(acciones).toContain('if (e.edicion !== "nada") {');
    expect(acciones).toContain('texto: e.edicion === "solo_fecha" ? { en: "Edit date", es: "Editar fecha" } : { en: "Edit", es: "Editar" },');
    expect(ficha).toContain("editar: onEdit,");
    expect(ficha).toContain("edicion={alcance}");
    expect(ficha).toContain('{!isNew && alcance !== "nada" && (');
    expect(ficha).toContain('{soloFecha ? t("Save date", "Guardar fecha") : t("Save changes", "Guardar cambios")}');
    // Ya no queda ningún «Editar» decidido por canEditFields a secas (el de «Continuar la orden» es de borrador y sigue).
    expect(ficha).not.toContain("if (canEditFields(me.role, stage)) {");
  });
});
