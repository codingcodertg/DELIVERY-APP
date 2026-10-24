import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { textoDelMotivo } from "./aprobacion-por-hora-y-cupo";
import { motivoApuntadoEnEspanol, notaDeEntradaEnPendiente, porQueEsperaAprobacion } from "./por-que-espera-aprobacion";
import type { AccountRecord } from "./types";

/* D-670. Roberto, 2026-10-24, con #FV220 en «Pending Approval»: «Need to know what needs review if it didn't pass the auto
 * approval». Medido ese día (solo lectura): las 5 pendientes vivas tenían su motivo en el evento `created` («The 8:30
 * am-12:00 pm window already has 1 of 1 orders that day»), y la ficha no lo enseñaba. Tiendas y cuentas inventadas. */
const tiendas = [{ name: "Tienda Sola", auto_approve: true }, { name: "Tienda Con Oficina", auto_approve: false }];
const cuentas = [{ name: "Cuenta Marcada", requires_approval: true }] as unknown as AccountRecord[];
const orden = (o: Partial<{ stage: string; store: string | null; account: string | null; order_type: string | null; po2: string | null }> = {}) =>
  ({ stage: "pending", store: "Tienda Sola", account: null, order_type: "Customer", po2: null, ...o }) as never;
const ev = (kind: string, note: string | null, created_at: string) => ({ kind, note, created_at });
const claves = (o: never, eventos: ReturnType<typeof ev>[] = []) => porQueEsperaAprobacion(o, { tiendas, cuentas, eventos }).map((m) => m.clave);

describe("por qué una orden espera aprobación", () => {
  it("el caso de #FV220: la tienda aprueba sola y el motivo quedó apuntado al crearla (el cupo de la mañana)", () => {
    const nota = textoDelMotivo({ tipo: "cupo", ventana: "0830-1200", ocupadas: 1, tope: 1 }, false);
    const m = porQueEsperaAprobacion(orden(), { tiendas, cuentas, eventos: [ev("created", nota, "2026-10-23T19:03:41Z")] });
    expect(m).toEqual([{ clave: "apuntado", en: nota, es: textoDelMotivo({ tipo: "cupo", ventana: "0830-1200", ocupadas: 1, tope: 1 }, true) }]);
  });
  it("las que se pueden volver a decir: cuenta marcada, Intertienda sin PO, tienda que no aprueba sola", () => {
    expect(claves(orden({ account: "cuenta marcada " }))).toEqual(["cuenta"]);
    expect(claves(orden({ order_type: "Intertienda" }))).toEqual(["intertienda_sin_po"]);
    expect(claves(orden({ order_type: "Intertienda", po2: "PO-1" }))).toEqual(["sin_motivo"]);
    expect(claves(orden({ store: "Tienda Con Oficina" }))).toEqual(["tienda"]);
    expect(claves(orden({ store: "Tienda Que No Está" }))).toEqual(["tienda"]);
  });
  it("varios motivos apuntados («; ») salen uno por uno, cada uno en su idioma", () => {
    const hoy = textoDelMotivo({ tipo: "corte_hoy", corte: "16:30" }, false);
    const manana = textoDelMotivo({ tipo: "corte_manana", corte: "16:30" }, false);
    const m = porQueEsperaAprobacion(orden({ store: "Tienda Con Oficina" }), { tiendas, cuentas, eventos: [ev("pending", `${hoy}; ${manana}`, "2026-10-24T10:00:00Z")] });
    expect(m.map((x) => x.clave)).toEqual(["tienda", "apuntado", "apuntado"]);
    expect(m.slice(1).map((x) => x.es)).toEqual([textoDelMotivo({ tipo: "corte_hoy", corte: "16:30" }, true), textoDelMotivo({ tipo: "corte_manana", corte: "16:30" }, true)]);
  });
  it("sin nada que decir, lo dice; y una orden que no está pendiente no lleva motivos", () => {
    expect(claves(orden())).toEqual(["sin_motivo"]);
    expect(claves(orden({ stage: "approved", store: "Tienda Con Oficina" }))).toEqual([]);
  });
  it("la nota es la del ÚLTIMO evento que la dejó pendiente (created o pending, por fecha), no la de una edición posterior", () => {
    expect(notaDeEntradaEnPendiente([ev("pending", "vieja", "2026-10-20T10:00:00Z"), ev("edited", "Delivery Date: a → b", "2026-10-22T10:00:00Z"), ev("created", "nueva", "2026-10-21T10:00:00Z")])).toBe("nueva");
    expect(notaDeEntradaEnPendiente([ev("created", "al crear", "2026-10-20T10:00:00Z"), ev("pending", "al enviar", "2026-10-21T10:00:00Z")])).toBe("al enviar");
    expect(notaDeEntradaEnPendiente([ev("created", "  ", "2026-10-20T10:00:00Z")])).toBeNull();
    expect(notaDeEntradaEnPendiente([])).toBeNull();
  });
  it("una nota que no es de las tres formas se deja tal cual en español", () => {
    expect(motivoApuntadoEnEspanol("Algo escrito a mano")).toBe("Algo escrito a mano");
  });
  it("la ficha lo pinta: arriba, para todos menos el chofer, con un renglón por motivo", () => {
    const ficha = readFileSync("src/components/OrderModal.tsx", "utf8");
    expect(ficha).toContain("const motivosDePendiente = existing ? porQueEsperaAprobacion(existing, { tiendas: settings.stores, cuentas: settings.accounts, eventos: events }) : [];");
    expect(ficha).toContain('{!editing && existing && me.role !== "driver" && motivosDePendiente.length > 0 && (');
    expect(ficha).toContain("{motivosDePendiente.map((m, i) => <li key={i} data-motivo-de-pendiente={m.clave}>{lang === \"es\" ? m.es : m.en}</li>)}");
  });
});
