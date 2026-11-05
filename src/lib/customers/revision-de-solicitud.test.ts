import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { enEdicion, contactosDe } from "./contactos";
import { almacenDemoNuevo, CLIENTES_DEMO, SOLICITUDES_DEMO } from "./demo";
import { redesEnEdicion } from "./redes";
import { formDe } from "./reglas";
import {
  accionesDeSolicitud, cambiosContraLaFila, correccionesDelAdmin, cuentaPorEstado, estadosAVer, filaDeSolicitud, filtraPorEstado, mismoPayload,
  notaValida, payloadCorregido,
} from "./revision-de-solicitud";
import { solicitudDeLaBase, type SolicitudDeCliente } from "./solicitud-de-cliente";

const alta = (payload: Record<string, unknown>, extra: Record<string, unknown> = {}): SolicitudDeCliente =>
  solicitudDeLaBase({ id: 9, kind: "alta", requested_by: "u", stores: ["PHR"], status: "pending", created_at: "2026-11-04", payload, ...extra });
const cliente1 = CLIENTES_DEMO[0];
const edicion = (payload: Record<string, unknown>, before: Record<string, unknown>): SolicitudDeCliente =>
  solicitudDeLaBase({ id: 8, kind: "edicion", customer_id: cliente1.id, requested_by: "u", stores: [cliente1.store], status: "pending", created_at: "2026-11-04", payload, before });

/** El formulario que abre la tarjeta al corregir, como lo arma la pantalla. */
const abreCorreccion = (s: SolicitudDeCliente) => {
  const fila = filaDeSolicitud(s, s.kind === "edicion" ? cliente1 : null);
  return { form: formDe(fila), contactos: enEdicion(contactosDe(fila)), redes: redesEnEdicion({}) };
};

describe("la lista: estados y chips", () => {
  it("cuenta por estado y filtra; «Revisar» sale solo con la 242 o si ya hay alguna", () => {
    const l = [{ status: "pending" }, { status: "pending" }, { status: "review" }, { status: "rejected" }] as const;
    expect(cuentaPorEstado(l)).toEqual({ pending: 2, review: 1, approved: 0, rejected: 1 });
    expect(filtraPorEstado(l, "pending")).toHaveLength(2);
    expect(estadosAVer(false, { pending: 1, review: 0, approved: 0, rejected: 0 })).toEqual(["pending", "approved", "rejected"]);
    expect(estadosAVer(true, { pending: 1, review: 0, approved: 0, rejected: 0 })).toEqual(["pending", "review", "approved", "rejected"]);
  });
  it("solicitudDeLaBase lee 'review' y las columnas de la 242", () => {
    const s = solicitudDeLaBase({ id: 1, status: "review", review_note: " falta el W-9 ", payload: { account: "A" }, payload_original: { account: "a" } });
    expect(s.status).toBe("review");
    expect(s.review_note).toBe("falta el W-9");
    expect(s.payload_original).toEqual({ account: "a" });
  });
});

describe("las acciones por estado", () => {
  it("el admin: pendiente → todo (sin la 242, sin revisar ni corregir); revisar → decidir y corregir; decidida → nada", () => {
    expect(accionesDeSolicitud("pending", { esAdmin: true, revision: true })).toEqual({ aprobar: true, rechazar: true, revisar: true, corregir: true });
    expect(accionesDeSolicitud("pending", { esAdmin: true, revision: false })).toEqual({ aprobar: true, rechazar: true, revisar: false, corregir: false });
    expect(accionesDeSolicitud("review", { esAdmin: true, revision: true })).toEqual({ aprobar: true, rechazar: true, revisar: false, corregir: true });
    expect(accionesDeSolicitud("approved", { esAdmin: true, revision: true })).toEqual({ aprobar: false, rechazar: false, revisar: false, corregir: false });
    expect(accionesDeSolicitud("pending", { esAdmin: false, revision: true }).aprobar).toBe(false);
  });
  it("rechazar y revisar piden nota", () => {
    expect(notaValida("  ")).toBe(false);
    expect(notaValida("ya existe")).toBe(true);
  });
});

describe("el diff de una edición", () => {
  it("valor de HOY de la fila → lo pedido; marca lo que cambió desde que se pidió", () => {
    const s = edicion({ terms: "Net 15", credit_limit: 25000 }, { account: cliente1.account, terms: "Net 15 viejo", credit_limit: 20000 });
    const c = cambiosContraLaFila(s, cliente1);
    expect(c.map((x) => [x.key, x.antes, x.despues, x.desfasado])).toEqual([
      ["terms", "Net 30", "Net 15", true],
      ["credit_limit", "20000", "25000", false],
    ]);
  });
  it("sin la fila, lo que vio quien pidió", () => {
    const s = edicion({ terms: "Net 15" }, { account: "X", terms: "Net 30" });
    expect(cambiosContraLaFila(s, null).map((x) => [x.antes, x.despues, x.desfasado])).toEqual([["Net 30", "Net 15", false]]);
  });
  it("lo que corrigió el admin, sobre lo que mandó quien pidió", () => {
    expect(correccionesDelAdmin(alta({ account: "IDEA DONNA" }))).toEqual([]);
    const s = alta({ account: "IDEA DONNA", terms: "Net 30" }, { payload_original: { account: "IDEA DONA" } });
    expect(correccionesDelAdmin(s).map((x) => [x.key, x.antes, x.despues])).toEqual([["account", "IDEA DONA", "IDEA DONNA"], ["terms", "—", "Net 30"]]);
  });
});

describe("corregir antes de aprobar", () => {
  it("un alta: abrir sin tocar no cambia nada; corregir nombre, teléfono y términos los funde sobre lo pedido", () => {
    const s = SOLICITUDES_DEMO.find((x) => x.id === 3)!;
    const { form, contactos, redes } = abreCorreccion(s);
    const igual = payloadCorregido(s, null, form, contactos, redes);
    expect(igual.cambiado).toBe(false);
    expect(igual.errores).toEqual([]);
    expect(igual.faltan).toContain("terms");
    const c2 = contactos.map((c, i) => (i === 0 ? { ...c, phones: ["9565620132"] } : c));
    const r = payloadCorregido(s, null, { ...form, account: "idea donna llc", terms: "Net 30" }, c2, redes);
    expect(r.errores).toEqual([]);
    expect(r.cambiado).toBe(true);
    expect(r.payload).toMatchObject({ account: "IDEA DONNA LLC", terms: "Net 30", phone: "(956) 562-0132", rep_id: "demo-beto" });
    expect((r.payload.contacts as { phones: string[] }[])[0].phones).toEqual(["(956) 562-0132"]);
    expect(r.payload).not.toHaveProperty("store");
    expect(r.faltan).not.toContain("terms");
  });
  it("un alta: sin cuenta, o un teléfono a medias, o un término que no es de los tres, no se guarda", () => {
    const s = SOLICITUDES_DEMO.find((x) => x.id === 3)!;
    const { form, contactos, redes } = abreCorreccion(s);
    expect(payloadCorregido(s, null, { ...form, account: " " }, contactos, redes).errores).toContain("account");
    expect(payloadCorregido(s, null, form, [{ ...contactos[0], phones: ["956"] }], redes).errores).toContain("contacto.0.phones.0");
    expect(payloadCorregido(s, null, { ...form, terms: "25 Days" }, contactos, redes).errores).toContain("terms");
  });
  it("una edición: el payload es SOLO lo que difiere de la fila de hoy; deshacerlo todo es un error", () => {
    const s = edicion({ terms: "Net 15", credit_limit: 25000 }, { account: cliente1.account, terms: "Net 30", credit_limit: 20000 });
    const { form, contactos, redes } = abreCorreccion(s);
    const igual = payloadCorregido(s, cliente1, form, contactos, redes);
    expect(igual.payload).toEqual({ terms: "Net 15", credit_limit: 25000 });
    expect(igual.cambiado).toBe(false);
    const mas = payloadCorregido(s, cliente1, { ...form, credit_limit: "30000", notes: "ok" }, contactos, redes);
    expect(mas.payload).toEqual({ terms: "Net 15", credit_limit: 30000, notes: "ok" });
    const nada = payloadCorregido(s, cliente1, { ...form, terms: "Net 30", credit_limit: "20000" }, contactos, redes);
    expect(nada.errores).toContain("nada");
  });
  it("mismoPayload no mira el orden de las claves", () => {
    expect(mismoPayload({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(mismoPayload({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe("el demo hace lo mismo que la 242", () => {
  it("revisar pide nota y saca de Pendiente; corregir guarda lo original y aprobar aplica lo corregido", async () => {
    const a = almacenDemoNuevo(SOLICITUDES_DEMO);
    expect((await a.revisarSolicitud(3, " ")).ok).toBe(false);
    expect((await a.revisarSolicitud(3, "confirmar teléfono")).ok).toBe(true);
    let l = await a.solicitudes();
    const s = l.ok ? l.valor.find((x) => x.id === 3)! : null;
    expect(s).toMatchObject({ status: "review", review_note: "confirmar teléfono" });
    expect((await a.corregirSolicitud(3, { ...s!.payload, account: "IDEA DONNA LLC", terms: "Net 30" })).ok).toBe(true);
    l = await a.solicitudes();
    expect(l.ok && l.valor.find((x) => x.id === 3)).toMatchObject({ payload: { account: "IDEA DONNA LLC" }, payload_original: { account: "IDEA DONNA" } });
    const ok = await a.aprobarSolicitud(3);
    expect(ok.ok).toBe(true);
    const clientes = await a.leer();
    expect(clientes.ok && clientes.valor.find((c) => c.account === "IDEA DONNA LLC")).toMatchObject({ store: "PHR", terms: "Net 30" });
    expect((await a.corregirSolicitud(3, { account: "X" })).ok).toBe(false);
  });
  it("una edición corregida mete en `before` el valor de hoy de cada campo nuevo", async () => {
    const a = almacenDemoNuevo(SOLICITUDES_DEMO);
    expect((await a.corregirSolicitud(2, { terms: "Net 15", credit_limit: 25000, notes: "ok" })).ok).toBe(true);
    const l = await a.solicitudes();
    expect(l.ok && l.valor.find((x) => x.id === 2)?.before).toMatchObject({ terms: "Net 30", notes: cliente1.notes ?? null });
    expect((await a.corregirSolicitud(2, {})).ok).toBe(false);
  });
});

describe("la 242", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/242_clientes_solicitudes_revision.sql"), "utf8");
  it("estado review, columnas, dos funciones nuevas solo admin, y las tres de decidir aceptan review", () => {
    expect(sql).toContain("check (status in ('pending', 'review', 'approved', 'rejected'))");
    expect(sql).toContain("add column if not exists payload_original jsonb");
    expect(sql).toContain("create or replace function erp.revisa_solicitud_de_cliente(p_id bigint, p_nota text)");
    expect(sql).toContain("create or replace function erp.corrige_solicitud_de_cliente(p_id bigint, p_payload jsonb)");
    expect(sql.match(/s\.status not in \('pending', 'review'\)/g)?.length).toBe(4);
    expect(sql).toContain("payload_original = coalesce(payload_original, payload)");
    expect(sql).not.toContain("grant update");
    // Después de la 241: la puerta es el admin de Clientes, y sin ella la 242 no corre.
    expect(sql).not.toContain("if not public.is_admin()");
    expect(sql.match(/if not erp\.es_admin_de_clientes\(\) then/g)?.length).toBe(5);
    expect(sql).toContain("aplica primero la 241");
    expect(sql).not.toContain("D-865");
    expect(sql).toContain("-- @ledger-below");
  });
});
